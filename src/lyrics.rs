//! Multi-Provider Synced Lyrics Engine:
//!   - Boidu Better Lyrics API (`https://lyrics-api.boidu.dev/getLyrics`) -> Apple Music word-by-word TTML!
//!   - LRCLIB (`https://lrclib.net`) -> Open synced/enhanced LRC database!
//!   - Smart Auto Selector -> Queries both in parallel and picks the best match per song
//!     based on true word-level timing AND exact duration alignment (eliminating offset fidgeting!).

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const USER_AGENT: &str = "AstralisVisualizer/1.1 (Desktop Constellation Lyric App)";
const PACING_VERSION: u32 = 9;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricWord {
    pub word: String,
    pub clean: String,
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricLine {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub instrumental: bool,
    pub words: Vec<LyricWord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricsResult {
    pub found: bool,
    pub synced: bool,
    #[serde(default)]
    pub word_synced: bool,
    #[serde(default)]
    pub pacing_v: u32,
    #[serde(default)]
    pub source: String, // "boidu" | "lrclib" | "lrclib_plain" | "none"
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub duration_ms: i64,
    #[serde(default)]
    pub lines: Vec<LyricLine>,
}

impl LyricsResult {
    pub fn empty(title: &str, artist: &str) -> Self {
        Self {
            found: false,
            synced: false,
            word_synced: false,
            pacing_v: PACING_VERSION,
            source: "none".to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            duration_ms: 0,
            lines: Vec::new(),
        }
    }
}

struct CleanerRegexes {
    bracket_noise: Regex,
    trailing_browser: Regex,
    trailing_noise: Regex,
    artist_noise: Regex,
    feat_re: Regex,
    multi_space: Regex,
    lrc_line_ts: Regex,
    enhanced_word_ts: Regex,
    vowel_groups: Regex,
    non_word: Regex,
    ttml_body_dur: Regex,
    ttml_p: Regex,
    ttml_span: Regex,
    ttml_attr_begin: Regex,
    ttml_attr_end: Regex,
    ttml_attr_key: Regex,
    ttml_translit_block: Regex,
    ttml_translit_text: Regex,
    xml_tags: Regex,
}

fn regexes() -> &'static CleanerRegexes {
    static RE: OnceLock<CleanerRegexes> = OnceLock::new();
    RE.get_or_init(|| CleanerRegexes {
        bracket_noise: Regex::new(
            r"(?i)[\(\[\{【（][^)\]\}\}】）]*(?:official|video|audio|lyric|lyrics|visualizer|hd|4k|uhd|mv|m/v|pv|remaster|remastered|live|acoustic|sped\s*up|slowed|reverb|bass\s*boosted|explicit|clean|radio\s*edit|topic|vevo|feat\.?|ft\.?|歌詞|公式|full\s*ver)[^)\]\}\}】）]*[\)\]\}】）]"
        ).unwrap(),
        trailing_browser: Regex::new(
            r"(?i)\s*[-|•–—｜]\s*(?:youtube(?:\s+music)?|spotify|soundcloud|apple\s+music|deezer|tidal|vlc(?:\s+media\s+player)?|brave|google\s+chrome|microsoft\s+edge|firefox).*$"
        ).unwrap(),
        trailing_noise: Regex::new(
            r"(?i)\s*[-|•｜]\s*(?:official\s+(?:music\s+)?video|official\s+audio|lyrics?|visualizer|hd|4k|mv|pv).*$"
        ).unwrap(),
        artist_noise: Regex::new(r"(?i)\s*-\s*topic$|\s*vevo$|\s*official$").unwrap(),
        feat_re: Regex::new(r"(?i)\s+(?:feat\.?|ft\.?|featuring)\s+.*$").unwrap(),
        multi_space: Regex::new(r"\s{2,}").unwrap(),
        lrc_line_ts: Regex::new(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]").unwrap(),
        enhanced_word_ts: Regex::new(r"<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>").unwrap(),
        vowel_groups: Regex::new(r"[aeiouyàáâãäåèéêëìíîïòóôõöøùúûüāēīōūаеёиоуыэюя]+").unwrap(),
        non_word: Regex::new(r"[^\p{L}\p{M}\p{N}']").unwrap(),
        ttml_body_dur: Regex::new(r#"<body[^>]*\bdur="([^"]+)""#).unwrap(),
        ttml_p: Regex::new(r"(?s)<p\b([^>]*)>(.*?)</p>").unwrap(),
        ttml_span: Regex::new(r"(?s)<span\b([^>]*)>([^<]*)</span>").unwrap(),
        ttml_attr_begin: Regex::new(r#"\bbegin="([^"]+)""#).unwrap(),
        ttml_attr_end: Regex::new(r#"\bend="([^"]+)""#).unwrap(),
        ttml_attr_key: Regex::new(r#"\bitunes:key="([^"]+)""#).unwrap(),
        ttml_translit_block: Regex::new(
            r#"(?s)<transliteration[^>]*xml:lang="[^"]*Latn[^"]*"[^>]*>(.*?)</transliteration>"#,
        )
        .unwrap(),
        ttml_translit_text: Regex::new(r#"(?s)<text[^>]*\bfor="([^"]+)"[^>]*>(.*?)</text>"#).unwrap(),
        xml_tags: Regex::new(r"<[^>]+>").unwrap(),
    })
}

/// Zero-dependency RFC 4648 Base64 decoder (used for KuGou synced LRC responses).
fn decode_base64(input: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity((input.len() * 3) / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in input.bytes() {
        let val = match b {
            b'A'..=b'Z' => (b - b'A') as u32,
            b'a'..=b'z' => (b - b'a' + 26) as u32,
            b'0'..=b'9' => (b - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => continue,
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    out
}

/// Returns fraction (0.0..1.0) of alphabetic characters in the lyrics that are Latin/Roman script
/// (used by Hinglish / Romanized mode to prefer readable Hinglish/Romaji over native scripts!).
fn latin_script_ratio(lines: &[LyricLine]) -> f64 {
    let mut latin = 0usize;
    let mut alpha = 0usize;
    for l in lines.iter().take(24) {
        for c in l.text.chars() {
            if c.is_alphabetic() {
                alpha += 1;
                if c.is_ascii_alphabetic() || matches!(c as u32, 0x00C0..=0x024F) {
                    latin += 1;
                }
            }
        }
    }
    if alpha == 0 {
        0.0
    } else {
        latin as f64 / alpha as f64
    }
}

fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x30FF   // Hiragana & Katakana
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified Ideographs
        | 0xF900..=0xFAFF // CJK Compatibility
    )
}

fn is_hangul_char(c: char) -> bool {
    matches!(c as u32, 0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F)
}

fn contains_cjk(s: &str) -> bool {
    s.chars().any(is_cjk_char)
}

/// Segment spaceless Japanese/Chinese lines into natural 2-4 char poetic chunks
/// so star-by-star lyric hopping flows just as gracefully as English!
fn segment_multilingual_tokens(text: &str) -> Vec<String> {
    let ws: Vec<&str> = text.split_whitespace().collect();
    if ws.len() > 1 || !contains_cjk(text) {
        return ws.into_iter().map(|s| s.to_string()).collect();
    }

    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 4 {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut cur_len = 0usize;

    for (idx, &ch) in chars.iter().enumerate() {
        let is_punct = matches!(ch, '、' | '。' | '，' | '！' | '？' | ',' | '.' | '!' | '?');
        if is_punct {
            cur.push(ch);
            if !cur.is_empty() {
                chunks.push(std::mem::take(&mut cur));
                cur_len = 0;
            }
            continue;
        }
        cur.push(ch);
        cur_len += 1;

        let next_ch = chars.get(idx + 1).copied();
        let script_break = match next_ch {
            Some(nc) => {
                let cur_kana = matches!(ch as u32, 0x3040..=0x309F);
                let next_kanji = matches!(nc as u32, 0x4E00..=0x9FFF);
                cur_kana && next_kanji && cur_len >= 2
            }
            None => false,
        };

        if script_break || cur_len >= 4 {
            chunks.push(std::mem::take(&mut cur));
            cur_len = 0;
        }
    }
    if !cur.is_empty() {
        if cur_len == 1 && !chunks.is_empty() {
            if let Some(last) = chunks.last_mut() {
                last.push_str(&cur);
            }
        } else {
            chunks.push(cur);
        }
    }
    chunks
}

fn unescape_xml(s: &str) -> String {
    s.replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Parse TTML timestamp strings such as "33.522", "1:06.334", "00:04:26.773", or "45s".
fn parse_ttml_time_ms(raw: &str) -> Option<i64> {
    let s = raw.trim().trim_end_matches('s');
    if s.is_empty() {
        return None;
    }
    let parts: Vec<&str> = s.split(':').collect();
    let total_sec: f64 = match parts.len() {
        1 => parts[0].parse().ok()?,
        2 => {
            let m: f64 = parts[0].parse().ok()?;
            let sec: f64 = parts[1].parse().ok()?;
            m * 60.0 + sec
        }
        3 => {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let sec: f64 = parts[2].parse().ok()?;
            h * 3600.0 + m * 60.0 + sec
        }
        _ => return None,
    };
    Some((total_sec * 1000.0).round() as i64)
}

/// Parse Apple Music / Boidu TTML into exact millisecond lines & merged word-level timestamps!
/// Intelligently merges syllable-split spans (e.g. `<span>e</span><span>nough</span>` -> `"enough"`).
#[allow(dead_code)]
pub fn parse_boidu_ttml(ttml: &str, fallback_dur_ms: i64) -> (Vec<LyricLine>, bool, i64) {
    let (lines, word_synced, dur, _) = parse_boidu_ttml_with_mode(ttml, fallback_dur_ms, false);
    (lines, word_synced, dur)
}

/// When `prefer_romanized` is true, automatically maps official Apple Music `<transliteration xml:lang="*-Latn">`
/// (Hinglish `hi-Latn`, Japanese Romaji `ja-Latn`, Korean `ko-Latn`, Pinyin `zh-Latn`) onto every line's
/// exact millisecond studio timestamps!
fn parse_boidu_ttml_with_mode(
    ttml: &str,
    fallback_dur_ms: i64,
    prefer_romanized: bool,
) -> (Vec<LyricLine>, bool, i64, bool) {
    let re = regexes();
    let body_dur_ms = re
        .ttml_body_dur
        .captures(ttml)
        .and_then(|c| c.get(1))
        .and_then(|m| parse_ttml_time_ms(m.as_str()))
        .unwrap_or(fallback_dur_ms);

    // Extract official Apple Music Latin transliteration map (key -> inner XML/text) when Hinglish/Romanized mode is requested!
    let mut translit_map: HashMap<String, String> = HashMap::new();
    if prefer_romanized {
        if let Some(tblock) = re.ttml_translit_block.captures(ttml).and_then(|c| c.get(1)) {
            for tcap in re.ttml_translit_text.captures_iter(tblock.as_str()) {
                if let (Some(k), Some(v)) = (tcap.get(1), tcap.get(2)) {
                    translit_map.insert(k.as_str().to_string(), v.as_str().to_string());
                }
            }
        }
    }
    let used_translit = !translit_map.is_empty();

    let mut lines: Vec<LyricLine> = Vec::new();
    let mut any_word_sync = false;

    for p_cap in re.ttml_p.captures_iter(ttml) {
        let p_attrs = p_cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let p_inner_raw = p_cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let p_key = re
            .ttml_attr_key
            .captures(p_attrs)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str());
        let p_inner = if let Some(k) = p_key {
            translit_map.get(k).map(|s| s.as_str()).unwrap_or(p_inner_raw)
        } else {
            p_inner_raw
        };

        let p_begin = re
            .ttml_attr_begin
            .captures(p_attrs)
            .and_then(|c| c.get(1))
            .and_then(|m| parse_ttml_time_ms(m.as_str()));
        let p_end = re
            .ttml_attr_end
            .captures(p_attrs)
            .and_then(|c| c.get(1))
            .and_then(|m| parse_ttml_time_ms(m.as_str()));

        // Collect all leaf <span> elements with timing, preserving inter-span whitespace so
        // syllable spans with NO gap between them merge cleanly into whole words!
        let mut words: Vec<LyricWord> = Vec::new();
        let mut prev_span_end_byte: Option<usize> = None;

        for sp_cap in re.ttml_span.captures_iter(p_inner) {
            let whole = sp_cap.get(0).unwrap();
            let sp_attrs = sp_cap.get(1).map(|m| m.as_str()).unwrap_or("");
            let sp_text_raw = sp_cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let sp_text = unescape_xml(sp_text_raw);
            let trimmed = sp_text.trim();
            if trimmed.is_empty() {
                continue;
            }

            let sp_begin = re
                .ttml_attr_begin
                .captures(sp_attrs)
                .and_then(|c| c.get(1))
                .and_then(|m| parse_ttml_time_ms(m.as_str()));
            let sp_end = re
                .ttml_attr_end
                .captures(sp_attrs)
                .and_then(|c| c.get(1))
                .and_then(|m| parse_ttml_time_ms(m.as_str()));

            let (Some(wb), Some(we)) = (sp_begin, sp_end) else {
                continue;
            };

            // Merge adjacent no-space spans ONLY for non-CJK alphabetic syllable splits
            // (e.g. "e"+"nough" -> "enough"), keeping Japanese/Chinese timed tokens distinct!
            let joined_no_space = if let Some(prev_end) = prev_span_end_byte {
                let between = &p_inner[prev_end..whole.start()];
                let prev_is_cjk = words.last().map(|w| contains_cjk(&w.word)).unwrap_or(false);
                !prev_is_cjk
                    && !contains_cjk(trimmed)
                    && !between.chars().any(|c| c.is_whitespace())
                    && !sp_text.starts_with(char::is_whitespace)
            } else {
                false
            };

            if joined_no_space && !words.is_empty() {
                if let Some(last) = words.last_mut() {
                    last.word.push_str(trimmed);
                    last.clean = re
                        .non_word
                        .replace_all(&last.word.to_lowercase(), "")
                        .to_string();
                    last.end_ms = last.end_ms.max(we);
                }
            } else {
                // Handle rare multi-word spans gracefully
                let sub: Vec<&str> = trimmed.split_whitespace().collect();
                if sub.len() <= 1 {
                    let clean = re
                        .non_word
                        .replace_all(&trimmed.to_lowercase(), "")
                        .to_string();
                    words.push(LyricWord {
                        word: trimmed.to_string(),
                        clean,
                        start_ms: wb,
                        end_ms: we.max(wb + 80),
                    });
                } else {
                    words.extend(build_words_for_line(trimmed, wb, we.max(wb + 200), None));
                }
            }
            prev_span_end_byte = Some(whole.end());
        }

        if !words.is_empty() {
            any_word_sync = true;
            let start_ms = p_begin.unwrap_or(words[0].start_ms);
            let end_ms = p_end.unwrap_or_else(|| words.last().map(|w| w.end_ms).unwrap_or(start_ms + 2000));
            let text = words
                .iter()
                .map(|w| w.word.as_str())
                .collect::<Vec<_>>()
                .join(" ");
            lines.push(LyricLine {
                start_ms,
                end_ms: end_ms.max(start_ms + 300),
                text,
                instrumental: false,
                words,
            });
        } else if let Some(start_ms) = p_begin {
            // Line-synced TTML fallback (no inner word <span> tags)
            let stripped = re.xml_tags.replace_all(p_inner, " ");
            let clean_text = re
                .multi_space
                .replace_all(&unescape_xml(&stripped), " ")
                .trim()
                .to_string();
            let has_exact_end = p_end.is_some();
            let end_ms = p_end.unwrap_or(start_ms + 3500);
            if !clean_text.is_empty() {
                let est_words = build_words_for_line_paced(&clean_text, start_ms, end_ms, None, has_exact_end);
                lines.push(LyricLine {
                    start_ms,
                    end_ms: end_ms.max(start_ms + 350),
                    text: clean_text,
                    instrumental: false,
                    words: est_words,
                });
            }
        }
    }

    lines.sort_by_key(|l| l.start_ms);
    (lines, any_word_sync, body_dur_ms, used_translit)
}

pub fn clean_track_metadata(raw_title: &str, raw_artist: &str) -> (String, String) {
    let re = regexes();
    let mut title = re.trailing_browser.replace_all(raw_title.trim(), "").to_string();
    // Deduplicate semicolon-repeated titles emitted by some desktop players (e.g. "Pompeii;Pompeii" -> "Pompeii")
    if let Some((first, rest)) = title.split_once(';') {
        let f = first.trim();
        let r = rest.trim();
        if !f.is_empty() && (r.eq_ignore_ascii_case(f) || r.to_lowercase().starts_with(&f.to_lowercase())) {
            title = f.to_string();
        }
    }
    let mut artist = re.artist_noise.replace_all(raw_artist.trim(), "").trim().to_string();

    let title_lower = title.to_lowercase();
    let artist_lower = artist.to_lowercase();

    if title.contains(" - ") || title.contains(" – ") || title.contains(" — ") {
        let sep = if title.contains(" - ") {
            " - "
        } else if title.contains(" – ") {
            " – "
        } else {
            " — "
        };
        if let Some((left, right)) = title.split_once(sep) {
            let left_clean = re.artist_noise.replace_all(left.trim(), "").trim().to_string();
            let right_clean = right.trim().to_string();
            let generic_artist = artist.is_empty()
                || matches!(
                    artist_lower.as_str(),
                    "youtube" | "youtube music" | "unknown" | "various artists"
                );
            if generic_artist && !left_clean.is_empty() && !right_clean.is_empty() {
                artist = left_clean;
                title = right_clean;
            } else if !artist_lower.is_empty() && title_lower.starts_with(&artist_lower) {
                title = right_clean;
            }
        }
    }

    title = re.bracket_noise.replace_all(&title, " ").to_string();
    title = re.trailing_noise.replace_all(&title, "").to_string();
    title = re.feat_re.replace_all(&title, "").to_string();
    title = re
        .multi_space
        .replace_all(&title, " ")
        .trim()
        .trim_matches(|c| c == '-' || c == '|' || c == ' ')
        .to_string();

    artist = re.feat_re.replace_all(&artist, "").to_string();
    artist = re.bracket_noise.replace_all(&artist, " ").to_string();
    artist = re
        .multi_space
        .replace_all(&artist, " ")
        .trim()
        .trim_matches(|c| c == '-' || c == '|' || c == ' ')
        .to_string();

    (title, artist)
}

fn ts_to_ms(minutes: &str, seconds: &str, frac: Option<&str>) -> i64 {
    let m: i64 = minutes.parse().unwrap_or(0);
    let s: i64 = seconds.parse().unwrap_or(0);
    let f: i64 = match frac {
        None | Some("") => 0,
        Some(v) if v.len() == 1 => v.parse::<i64>().unwrap_or(0) * 100,
        Some(v) if v.len() == 2 => v.parse::<i64>().unwrap_or(0) * 10,
        Some(v) => v[..3.min(v.len())].parse::<i64>().unwrap_or(0),
    };
    (m * 60 + s) * 1000 + f
}

fn estimate_syllables(word: &str) -> f64 {
    let re = regexes();
    let lower = word.to_lowercase();
    let clean = re.non_word.replace_all(&lower, "");
    if clean.is_empty() {
        return 1.0;
    }
    // CJK ideographs/kana & Korean Hangul blocks map ~1 syllable per character
    let cjk_hangul = clean
        .chars()
        .filter(|&c| is_cjk_char(c) || is_hangul_char(c))
        .count();
    if cjk_hangul > 0 {
        return cjk_hangul as f64 + 0.3;
    }
    // Latin / Cyrillic vowel groups; fallback to char-length weighting for Devanagari/Arabic/Thai
    let mut count = re.vowel_groups.find_iter(&clean).count() as f64;
    if count == 0.0 {
        let n_chars = clean.chars().count() as f64;
        return (n_chars * 0.45).max(1.0) + 0.35;
    }
    if clean.ends_with('e') && count > 1.0 {
        count -= 1.0;
    }
    count.max(1.0) + 0.35
}

pub fn build_words_for_line(
    text: &str,
    start_ms: i64,
    end_ms: i64,
    enhanced_raw: Option<&str>,
) -> Vec<LyricWord> {
    build_words_for_line_paced(text, start_ms, end_ms, enhanced_raw, false)
}

fn build_words_for_line_paced(
    text: &str,
    start_ms: i64,
    end_ms: i64,
    enhanced_raw: Option<&str>,
    has_exact_end: bool,
) -> Vec<LyricWord> {
    let re = regexes();

    if let Some(raw) = enhanced_raw {
        if re.enhanced_word_ts.is_match(raw) {
            let mut timed_chunks: Vec<(i64, String)> = Vec::new();
            let matches: Vec<_> = re.enhanced_word_ts.captures_iter(raw).collect();
            for (idx, cap) in matches.iter().enumerate() {
                let whole = cap.get(0).unwrap();
                let w_ms = ts_to_ms(
                    cap.get(1).map(|m| m.as_str()).unwrap_or("0"),
                    cap.get(2).map(|m| m.as_str()).unwrap_or("0"),
                    cap.get(3).map(|m| m.as_str()),
                );
                let next_start = if idx + 1 < matches.len() {
                    matches[idx + 1].get(0).unwrap().start()
                } else {
                    raw.len()
                };
                let w_txt = raw[whole.end()..next_start].trim();
                if !w_txt.is_empty() {
                    timed_chunks.push((w_ms, w_txt.to_string()));
                }
            }
            if !timed_chunks.is_empty() {
                let mut words = Vec::new();
                for (i, (w_ms, w_txt)) in timed_chunks.iter().enumerate() {
                    let nxt_ms = if i + 1 < timed_chunks.len() {
                        timed_chunks[i + 1].0
                    } else {
                        end_ms.max(*w_ms + 450)
                    };
                    let sub_words: Vec<&str> = w_txt.split_whitespace().collect();
                    if sub_words.len() == 1 {
                        let w = sub_words[0];
                        let clean = re.non_word.replace_all(&w.to_lowercase(), "").to_string();
                        words.push(LyricWord {
                            word: w.to_string(),
                            clean,
                            start_ms: *w_ms,
                            end_ms: (*w_ms + 120).max(nxt_ms),
                        });
                    } else {
                        words.extend(build_words_for_line(w_txt, *w_ms, nxt_ms, None));
                    }
                }
                return words;
            }
        }
    }

    let raw_words: Vec<String> = segment_multilingual_tokens(text);
    if raw_words.is_empty() {
        return Vec::new();
    }

    let raw_span = (end_ms - start_ms).max(320);
    let span = if has_exact_end {
        // Apple Music TTML <p end="..."> is the EXACT millisecond the singer finishes the phrase!
        // Use ~96% of the exact vocal span so words stay locked to the voice without rushing!
        ((raw_span as f64) * 0.96).max(280.0)
    } else {
        let phrased_span = if raw_span > 1300 {
            ((raw_span as f64) * 0.86) as i64
        } else {
            raw_span
        };
        let max_natural_span = (raw_words.len() as i64 * 560).max(1250);
        phrased_span.min(max_natural_span) as f64
    };

    let weights: Vec<f64> = raw_words.iter().map(|w| estimate_syllables(w)).collect();
    let total_w: f64 = weights.iter().sum::<f64>().max(1.0);

    let mut words = Vec::with_capacity(raw_words.len());
    let mut cursor = start_ms as f64;
    for (w, wt) in raw_words.iter().zip(weights.iter()) {
        let dur = (wt / total_w) * span;
        let w_start = cursor.round() as i64;
        cursor += dur;
        let w_end = cursor.round() as i64;
        let clean = re.non_word.replace_all(&w.to_lowercase(), "").to_string();
        words.push(LyricWord {
            word: w.clone(),
            clean,
            start_ms: w_start,
            end_ms: (w_start + 90).max(w_end),
        });
    }
    words
}

pub fn parse_lrc(lrc_text: &str, duration_ms: i64) -> Vec<LyricLine> {
    let re = regexes();
    let mut entries: Vec<(i64, String)> = Vec::new();

    for raw_line in lrc_text.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let caps: Vec<_> = re.lrc_line_ts.captures_iter(line).collect();
        if caps.is_empty() {
            continue;
        }
        let content = re.lrc_line_ts.replace_all(line, "").trim().to_string();
        for cap in caps {
            let ts = ts_to_ms(
                cap.get(1).map(|m| m.as_str()).unwrap_or("0"),
                cap.get(2).map(|m| m.as_str()).unwrap_or("0"),
                cap.get(3).map(|m| m.as_str()),
            );
            entries.push((ts, content.clone()));
        }
    }

    entries.sort_by_key(|(ts, _)| *ts);

    let mut lines = Vec::with_capacity(entries.len());
    for i in 0..entries.len() {
        let (ts, ref raw_content) = entries[i];
        let next_ts = if i + 1 < entries.len() {
            entries[i + 1].0
        } else if duration_ms > ts {
            duration_ms.max(ts + 4500)
        } else {
            ts + 4500
        };

        let no_enh = re.enhanced_word_ts.replace_all(raw_content, " ");
        let clean_text = re.multi_space.replace_all(&no_enh, " ").trim().to_string();

        if clean_text.is_empty() || matches!(clean_text.as_str(), "♪" | "♫" | "..." | "—") {
            lines.push(LyricLine {
                start_ms: ts,
                end_ms: (ts + 500).max(next_ts),
                text: String::new(),
                instrumental: true,
                words: Vec::new(),
            });
            continue;
        }

        let words = build_words_for_line(&clean_text, ts, next_ts, Some(raw_content));
        lines.push(LyricLine {
            start_ms: ts,
            end_ms: (ts + 400).max(next_ts),
            text: clean_text,
            instrumental: false,
            words,
        });
    }

    lines
}

pub fn parse_plain_lyrics(plain_text: &str, duration_ms: i64) -> Vec<LyricLine> {
    let raw_lines: Vec<&str> = plain_text
        .lines()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if raw_lines.is_empty() {
        return Vec::new();
    }
    let total_ms = if duration_ms > 15_000 {
        duration_ms
    } else {
        raw_lines.len() as i64 * 3500
    };
    let intro_ms = ((total_ms as f64) * 0.06).min(8000.0) as i64;
    let outro_ms = ((total_ms as f64) * 0.05).min(6000.0) as i64;
    let usable = (total_ms - intro_ms - outro_ms).max(4000) as f64;
    let step = usable / raw_lines.len() as f64;

    raw_lines
        .iter()
        .enumerate()
        .map(|(i, text)| {
            let start = intro_ms + (i as f64 * step).round() as i64;
            let end = intro_ms + ((i + 1) as f64 * step).round() as i64;
            let words = build_words_for_line(text, start, end, None);
            LyricLine {
                start_ms: start,
                end_ms: end.max(start + 400),
                text: (*text).to_string(),
                instrumental: false,
                words,
            }
        })
        .collect()
}

/// Cache key incorporates provider mode AND 2-second duration bucket so different song cuts
/// (e.g. YouTube MV vs studio album) never overwrite each other's synced timestamps!
fn cache_key_for(provider: &str, title: &str, artist: &str, duration_ms: i64) -> String {
    let dur_bucket = if duration_ms > 0 {
        ((duration_ms as f64 / 1000.0).round() as i64 / 2) * 2
    } else {
        0
    };
    let raw = format!(
        "v{}::{}::{}::{}::{}",
        PACING_VERSION,
        provider,
        artist.to_lowercase().trim(),
        title.to_lowercase().trim(),
        dur_bucket
    );
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in raw.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}", hash)
}

#[derive(Deserialize)]
struct LrclibItem {
    #[serde(rename = "trackName")]
    track_name: Option<String>,
    #[serde(rename = "artistName")]
    artist_name: Option<String>,
    duration: Option<f64>,
    #[serde(rename = "syncedLyrics")]
    synced_lyrics: Option<String>,
    #[serde(rename = "plainLyrics")]
    plain_lyrics: Option<String>,
}

#[derive(Deserialize)]
struct BoiduResp {
    ttml: Option<String>,
}

#[derive(Deserialize)]
struct UnisonResp {
    success: Option<bool>,
    data: Option<UnisonData>,
}

#[derive(Deserialize)]
struct UnisonData {
    song: Option<String>,
    artist: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
    lyrics: Option<String>,
}

#[derive(Deserialize)]
struct LyricsPlusResp {
    #[serde(rename = "type")]
    sync_type: Option<String>,
    lyrics: Option<Vec<LyricsPlusLine>>,
}

#[derive(Deserialize)]
struct LyricsPlusLine {
    time: Option<i64>,
    duration: Option<i64>,
    text: Option<String>,
    syllabus: Option<Vec<LyricsPlusSyllable>>,
}

#[derive(Deserialize)]
struct LyricsPlusSyllable {
    time: Option<i64>,
    duration: Option<i64>,
    text: Option<String>,
}

#[derive(Deserialize)]
struct KugouSearchResp {
    candidates: Option<Vec<KugouCandidate>>,
}

#[derive(Deserialize)]
struct KugouCandidate {
    id: Option<String>,
    accesskey: Option<String>,
    duration: Option<i64>,
    song: Option<String>,
    singer: Option<String>,
}

#[derive(Deserialize)]
struct KugouDownloadResp {
    content: Option<String>,
}

/// Strip opening songwriter/producer credit banners commonly injected into KuGou, QQ Music, and NetEase LRC files.
fn strip_lrc_credit_banners(lines: &mut Vec<LyricLine>, title: &str) {
    let title_low = title.to_lowercase();
    while let Some(first) = lines.first() {
        let low = first.text.trim().to_lowercase();
        let is_banner = first.start_ms <= 35_000
            && (low.starts_with("written by")
                || low.starts_with("lyrics by")
                || low.starts_with("composed by")
                || low.starts_with("produced by")
                || low.starts_with("arranged by")
                || low.starts_with("songwriter")
                || low.starts_with("作词")
                || low.starts_with("作曲")
                || low.starts_with("编曲")
                || low.starts_with("制作人")
                || low.starts_with("混音")
                || low.starts_with("母带")
                || low.starts_with("词：")
                || low.starts_with("曲：")
                || low.starts_with("词:")
                || low.starts_with("曲:")
                || (first.start_ms <= 6000
                    && (low.contains(" - ") || (!title_low.is_empty() && low.contains(&title_low)))));
        if is_banner {
            lines.remove(0);
        } else {
            break;
        }
    }
}

fn split_artist_candidates(artist: &str) -> Vec<String> {
    let mut artist_candidates: Vec<String> = Vec::new();
    for part in artist.split(|c| matches!(c, ',' | ';' | '&' | '/')) {
        let clean = part.trim();
        if !clean.is_empty()
            && !artist_candidates
                .iter()
                .any(|a| a.eq_ignore_ascii_case(clean))
        {
            artist_candidates.push(clean.to_string());
            if artist_candidates.len() >= 2 {
                break;
            }
        }
    }
    if !artist.trim().is_empty()
        && !artist_candidates
            .iter()
            .any(|a| a.eq_ignore_ascii_case(artist))
    {
        artist_candidates.push(artist.to_string());
    }
    artist_candidates
}

pub struct LyricsEngine {
    cache_dir: PathBuf,
    provider_mode: Mutex<String>, // "auto" | "hinglish" | "unison" | "boidu" | "lyricsplus" | "lrclib" | "netease" | "qqmusic" | "kugou"
    mem_cache: Mutex<HashMap<String, LyricsResult>>,
}

impl LyricsEngine {
    pub fn new(cache_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&cache_dir);
        Self {
            cache_dir,
            provider_mode: Mutex::new("auto".to_string()),
            mem_cache: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_provider_mode(&self, mode: &str) -> String {
        let clean = match mode {
            "hinglish" => "hinglish",
            "unison" => "unison",
            "boidu" => "boidu",
            "lyricsplus" => "lyricsplus",
            "lrclib" => "lrclib",
            "netease" => "netease",
            "qqmusic" => "qqmusic",
            "kugou" => "kugou",
            _ => "auto",
        };
        if let Ok(mut guard) = self.provider_mode.lock() {
            *guard = clean.to_string();
        }
        clean.to_string()
    }

    pub fn get_provider_mode(&self) -> String {
        self.provider_mode
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "auto".to_string())
    }

    pub fn fetch_lyrics(
        &self,
        raw_title: &str,
        raw_artist: &str,
        album: &str,
        duration_ms: i64,
    ) -> LyricsResult {
        let (title, artist) = clean_track_metadata(raw_title, raw_artist);
        if title.is_empty() {
            return LyricsResult::empty(raw_title, raw_artist);
        }

        let provider = self.get_provider_mode();
        let key = cache_key_for(&provider, &title, &artist, duration_ms);

        if let Ok(guard) = self.mem_cache.lock() {
            if let Some(hit) = guard.get(&key) {
                return hit.clone();
            }
        }

        let cache_file = self.cache_dir.join(format!("{}.json", key));
        if cache_file.exists() {
            if let Ok(text) = fs::read_to_string(&cache_file) {
                if let Ok(cached) = serde_json::from_str::<LyricsResult>(&text) {
                    if cached.found && cached.pacing_v == PACING_VERSION {
                        if let Ok(mut guard) = self.mem_cache.lock() {
                            guard.insert(key, cached.clone());
                        }
                        return cached;
                    }
                }
            }
        }

        let result = match provider.as_str() {
            "unison" => {
                let r = self.query_unison(&title, &artist, duration_ms, false);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "boidu" => {
                let r = self.query_boidu(&title, &artist, duration_ms, false);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "lyricsplus" => {
                let r = self.query_lyricsplus(&title, &artist, album, duration_ms);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "lrclib" => self.query_lrclib(&title, &artist, album, duration_ms),
            "netease" => {
                let r = self.query_netease(&title, &artist, duration_ms);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "qqmusic" => {
                let r = self.query_qqmusic(&title, &artist, duration_ms);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "kugou" => {
                let r = self.query_kugou(&title, &artist, duration_ms);
                if r.found && r.synced { r } else { self.fallback_or(r, &title, &artist, album, duration_ms) }
            }
            "hinglish" => self.query_hinglish_best(&title, &artist, album, duration_ms),
            _ => self.query_auto_best(&title, &artist, album, duration_ms),
        };

        if let Ok(mut guard) = self.mem_cache.lock() {
            guard.insert(key, result.clone());
        }
        if result.found {
            if let Ok(serialized) = serde_json::to_string(&result) {
                let _ = fs::write(&cache_file, serialized);
            }
        }
        result
    }

    fn fallback_or(
        &self,
        primary: LyricsResult,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
    ) -> LyricsResult {
        let lrc = self.query_lrclib(title, artist, album, duration_ms);
        if lrc.found { lrc } else { primary }
    }

    /// Sync-rated Auto selector (Unison > Boidu > LyricsPlus > LRCLIB > NetEase > QQ Music > KuGou):
    /// Queries Tier 1 (Unison + Boidu + LyricsPlus + LRCLIB) in parallel; only hits Tier 2
    /// (NetEase + QQ Music + KuGou) when Tier 1 has no synced match!
    fn query_auto_best(&self, title: &str, artist: &str, album: &str, duration_ms: i64) -> LyricsResult {
        let (unison_res, boidu_res, lplus_res, lrclib_res) = std::thread::scope(|s| {
            let h_u = s.spawn(|| self.query_unison(title, artist, duration_ms, false));
            let h_b = s.spawn(|| self.query_boidu(title, artist, duration_ms, false));
            let h_lp = s.spawn(|| self.query_lyricsplus(title, artist, album, duration_ms));
            let h_lrc = s.spawn(|| self.query_lrclib(title, artist, album, duration_ms));
            (
                h_u.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_b.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_lp.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_lrc.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
            )
        });

        let tier1_best = [unison_res, boidu_res, lplus_res, lrclib_res]
            .into_iter()
            .max_by(|a, b| {
                score_candidate(a, duration_ms, false)
                    .partial_cmp(&score_candidate(b, duration_ms, false))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_else(|| LyricsResult::empty(title, artist));

        if tier1_best.found && tier1_best.synced && score_candidate(&tier1_best, duration_ms, false) >= 100.0 {
            return tier1_best;
        }

        // Tier 2 parallel fallback: NetEase Cloud Music > QQ Music > KuGou
        let (ne_res, qq_res, kg_res) = std::thread::scope(|s| {
            let h_ne = s.spawn(|| self.query_netease(title, artist, duration_ms));
            let h_qq = s.spawn(|| self.query_qqmusic(title, artist, duration_ms));
            let h_kg = s.spawn(|| self.query_kugou(title, artist, duration_ms));
            (
                h_ne.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_qq.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_kg.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
            )
        });

        [tier1_best, ne_res, qq_res, kg_res]
            .into_iter()
            .max_by(|a, b| {
                score_candidate(a, duration_ms, false)
                    .partial_cmp(&score_candidate(b, duration_ms, false))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_else(|| LyricsResult::empty(title, artist))
    }

    /// Hinglish / Romanized Best Mode:
    /// Compares Unison & Boidu `*-Latn` studio transliterations, LyricsPlus word-synced Hinglish,
    /// LRCLIB, and KuGou in parallel, preferring word-synced Latin/Hinglish text!
    fn query_hinglish_best(&self, title: &str, artist: &str, album: &str, duration_ms: i64) -> LyricsResult {
        let (unison_res, boidu_res, lplus_res, lrclib_res, kugou_res) = std::thread::scope(|s| {
            let h_u = s.spawn(|| self.query_unison(title, artist, duration_ms, true));
            let h_b = s.spawn(|| self.query_boidu(title, artist, duration_ms, true));
            let h_lp = s.spawn(|| self.query_lyricsplus(title, artist, album, duration_ms));
            let h_lrc = s.spawn(|| self.query_lrclib(title, artist, album, duration_ms));
            let h_kg = s.spawn(|| self.query_kugou(title, artist, duration_ms));
            (
                h_u.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_b.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_lp.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_lrc.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
                h_kg.join().unwrap_or_else(|_| LyricsResult::empty(title, artist)),
            )
        });

        [unison_res, boidu_res, lplus_res, lrclib_res, kugou_res]
            .into_iter()
            .max_by(|a, b| {
                score_candidate(a, duration_ms, true)
                    .partial_cmp(&score_candidate(b, duration_ms, true))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_else(|| LyricsResult::empty(title, artist))
    }

    fn http_get_json(&self, url: &str, timeout_secs: u64) -> Option<serde_json::Value> {
        let resp = ureq::get(url)
            .set("User-Agent", USER_AGENT)
            .set("Accept", "application/json")
            .timeout(Duration::from_secs(timeout_secs))
            .call()
            .ok()?;
        resp.into_json::<serde_json::Value>().ok()
    }

    fn http_get_json_with_referer(
        &self,
        url: &str,
        referer: &str,
        timeout_secs: u64,
    ) -> Option<serde_json::Value> {
        let resp = ureq::get(url)
            .set(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            )
            .set("Referer", referer)
            .set("Accept", "application/json, text/plain, */*")
            .timeout(Duration::from_secs(timeout_secs))
            .call()
            .ok()?;
        let body = resp.into_string().ok()?;
        serde_json::from_str::<serde_json::Value>(&body).ok()
    }

    fn http_post_json_with_referer(
        &self,
        url: &str,
        referer: &str,
        timeout_secs: u64,
    ) -> Option<serde_json::Value> {
        let resp = ureq::post(url)
            .set(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
            )
            .set("Referer", referer)
            .set("Accept", "application/json, text/plain, */*")
            .timeout(Duration::from_secs(timeout_secs))
            .send_string("")
            .ok()?;
        let body = resp.into_string().ok()?;
        serde_json::from_str::<serde_json::Value>(&body).ok()
    }

    /// Query Unison (Better Lyrics community richsync TTML/LRC database — top-ranked sync!).
    fn query_unison(
        &self,
        title: &str,
        artist: &str,
        duration_ms: i64,
        prefer_romanized: bool,
    ) -> LyricsResult {
        if title.is_empty() || artist.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let artist_candidates = split_artist_candidates(artist);
        for cand in &artist_candidates {
            let url = format!(
                "https://unison.boidu.dev/lyrics?song={}&artist={}",
                urlencoding::encode(title),
                urlencoding::encode(cand)
            );
            let Some(val) = self.http_get_json(&url, 5) else {
                continue;
            };
            let Ok(resp) = serde_json::from_value::<UnisonResp>(val) else {
                continue;
            };
            if resp.success != Some(true) {
                continue;
            }
            let Some(data) = resp.data else {
                continue;
            };
            let Some(raw) = data.lyrics.filter(|s| !s.trim().is_empty()) else {
                continue;
            };
            let api_dur_ms = data
                .duration
                .map(|d| (d * 1000.0).round() as i64)
                .filter(|&d| d > 0)
                .unwrap_or(duration_ms);
            let fmt = data.format.as_deref().unwrap_or("").to_lowercase();

            if fmt == "ttml" || raw.contains("<p") {
                let (lines, word_synced, body_dur, used_translit) =
                    parse_boidu_ttml_with_mode(&raw, api_dur_ms, prefer_romanized);
                if !lines.is_empty() {
                    return LyricsResult {
                        found: true,
                        synced: true,
                        word_synced,
                        pacing_v: PACING_VERSION,
                        source: if used_translit {
                            "unison_hinglish".to_string()
                        } else {
                            "unison".to_string()
                        },
                        title: data.song.unwrap_or_else(|| title.to_string()),
                        artist: data.artist.unwrap_or_else(|| artist.to_string()),
                        duration_ms: body_dur,
                        lines,
                    };
                }
            } else if raw.contains('[') {
                let word_synced = regexes().enhanced_word_ts.is_match(&raw);
                let mut lines = parse_lrc(&raw, api_dur_ms);
                strip_lrc_credit_banners(&mut lines, title);
                if lines.len() >= 4 {
                    return LyricsResult {
                        found: true,
                        synced: true,
                        word_synced,
                        pacing_v: PACING_VERSION,
                        source: "unison".to_string(),
                        title: data.song.unwrap_or_else(|| title.to_string()),
                        artist: data.artist.unwrap_or_else(|| artist.to_string()),
                        duration_ms: api_dur_ms,
                        lines,
                    };
                }
            }
        }
        LyricsResult::empty(title, artist)
    }

    /// Query LyricsPlus v2 (`lyricsplus.prjktla.my.id`) — word-by-word millisecond JSON across Apple/Spotify/Musixmatch/YouTube!
    fn query_lyricsplus(
        &self,
        title: &str,
        artist: &str,
        album: &str,
        duration_ms: i64,
    ) -> LyricsResult {
        if title.is_empty() || artist.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let re = regexes();
        let dur_sec = if duration_ms > 0 {
            ((duration_ms as f64) / 1000.0).round() as i64
        } else {
            0
        };
        let artist_candidates = split_artist_candidates(artist);

        let mut urls = Vec::new();
        for cand in &artist_candidates {
            let mut u = format!(
                "https://lyricsplus.prjktla.my.id/v2/lyrics/get?title={}&artist={}",
                urlencoding::encode(title),
                urlencoding::encode(cand)
            );
            if !album.is_empty() {
                u.push_str(&format!("&album={}", urlencoding::encode(album)));
            }
            if dur_sec > 0 {
                u.push_str(&format!("&duration={}", dur_sec));
            }
            urls.push(u);
        }

        for url in urls {
            let Some(val) = self.http_get_json(&url, 5) else {
                continue;
            };
            let Ok(resp) = serde_json::from_value::<LyricsPlusResp>(val) else {
                continue;
            };
            let Some(raw_lines) = resp.lyrics else {
                continue;
            };
            if raw_lines.is_empty() {
                continue;
            }

            let is_word_type = resp
                .sync_type
                .as_deref()
                .map(|s| s.eq_ignore_ascii_case("word"))
                .unwrap_or(false);
            let mut lines: Vec<LyricLine> = Vec::with_capacity(raw_lines.len());
            let mut any_word_synced = false;

            for rl in &raw_lines {
                let start_ms = rl.time.unwrap_or(-1);
                if start_ms < 0 {
                    continue;
                }
                let dur = rl.duration.unwrap_or(0).max(0);
                let end_ms = if dur > 0 { start_ms + dur } else { start_ms + 3000 };
                let text = rl.text.as_deref().unwrap_or("").trim().to_string();
                if text.is_empty() {
                    continue;
                }

                // Merge syllable-level timing chunks into whole words using trailing space boundaries
                let mut words: Vec<LyricWord> = Vec::new();
                if let Some(syls) = rl.syllabus.as_ref().filter(|v| !v.is_empty()) {
                    let mut cur_word = String::new();
                    let mut cur_start: i64 = -1;
                    let mut cur_end: i64 = -1;

                    for syl in syls {
                        let s_txt = syl.text.as_deref().unwrap_or("");
                        let s_time = syl.time.unwrap_or(start_ms);
                        let s_dur = syl.duration.unwrap_or(180).max(40);
                        let s_end = s_time + s_dur;
                        let trimmed = s_txt.trim();
                        let ends_with_space = s_txt.chars().last().map(|c| c.is_whitespace()).unwrap_or(false);
                        let starts_with_space = s_txt.chars().next().map(|c| c.is_whitespace()).unwrap_or(false);

                        if starts_with_space && !cur_word.is_empty() {
                            let clean = re.non_word.replace_all(&cur_word.to_lowercase(), "").to_string();
                            words.push(LyricWord {
                                word: cur_word.clone(),
                                clean,
                                start_ms: cur_start,
                                end_ms: cur_end.max(cur_start + 80),
                            });
                            cur_word.clear();
                            cur_start = -1;
                        }

                        if !trimmed.is_empty() {
                            if cur_start < 0 {
                                cur_start = s_time;
                            }
                            cur_word.push_str(trimmed);
                            cur_end = s_end;
                        }

                        if ends_with_space && !cur_word.is_empty() {
                            let clean = re.non_word.replace_all(&cur_word.to_lowercase(), "").to_string();
                            words.push(LyricWord {
                                word: cur_word.clone(),
                                clean,
                                start_ms: cur_start,
                                end_ms: cur_end.max(cur_start + 80),
                            });
                            cur_word.clear();
                            cur_start = -1;
                        }
                    }
                    if !cur_word.is_empty() {
                        let clean = re.non_word.replace_all(&cur_word.to_lowercase(), "").to_string();
                        words.push(LyricWord {
                            word: cur_word,
                            clean,
                            start_ms: cur_start.max(start_ms),
                            end_ms: cur_end.max(cur_start + 80),
                        });
                    }
                    if !words.is_empty() {
                        any_word_synced = true;
                    }
                }

                if words.is_empty() {
                    words = build_words_for_line_paced(&text, start_ms, end_ms, None, dur > 0);
                }

                lines.push(LyricLine {
                    start_ms,
                    end_ms,
                    text,
                    instrumental: false,
                    words,
                });
            }

            if lines.len() >= 4 {
                lines.sort_by_key(|l| l.start_ms);
                let last_end = lines.last().map(|l| l.end_ms).unwrap_or(duration_ms);
                let out_dur = if duration_ms > 0 { duration_ms } else { last_end };
                return LyricsResult {
                    found: true,
                    synced: true,
                    word_synced: is_word_type || any_word_synced,
                    pacing_v: PACING_VERSION,
                    source: "lyricsplus".to_string(),
                    title: title.to_string(),
                    artist: artist.to_string(),
                    duration_ms: out_dur,
                    lines,
                };
            }
        }

        LyricsResult::empty(title, artist)
    }

    /// Query NetEase Cloud Music (`music.163.com`) synced LRC catalog.
    fn query_netease(&self, title: &str, artist: &str, duration_ms: i64) -> LyricsResult {
        if title.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let primary_artist = split_artist_candidates(artist)
            .into_iter()
            .next()
            .unwrap_or_default();
        let query = if primary_artist.is_empty() {
            title.to_string()
        } else {
            format!("{} {}", title, primary_artist)
        };
        let search_url = format!(
            "https://music.163.com/api/search/get?s={}&type=1&limit=5",
            urlencoding::encode(&query)
        );
        let Some(val) = self.http_post_json_with_referer(&search_url, "https://music.163.com/", 5) else {
            return LyricsResult::empty(title, artist);
        };
        let Some(songs) = val.pointer("/result/songs").and_then(|v| v.as_array()) else {
            return LyricsResult::empty(title, artist);
        };

        let mut cands: Vec<(i64, i64, String)> = songs
            .iter()
            .filter_map(|s| {
                let id = s.get("id")?.as_i64()?;
                let dur = s.get("duration").and_then(|d| d.as_i64()).unwrap_or(0);
                let name = s.get("name").and_then(|n| n.as_str()).unwrap_or(title).to_string();
                Some((id, dur, name))
            })
            .collect();
        if duration_ms > 0 {
            cands.sort_by_key(|(_, d, _)| if *d > 0 { (*d - duration_ms).abs() } else { 999_999 });
        }

        for (id, cand_dur, cand_title) in cands.into_iter().take(2) {
            let lyr_url = format!("https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1", id);
            let Some(lval) = self.http_get_json_with_referer(&lyr_url, "https://music.163.com/", 5) else {
                continue;
            };
            let Some(lrc_raw) = lval.pointer("/lrc/lyric").and_then(|v| v.as_str()) else {
                continue;
            };
            if !lrc_raw.contains('[') {
                continue;
            }
            let out_dur = if cand_dur > 0 { cand_dur } else { duration_ms };
            let mut lines = parse_lrc(lrc_raw, out_dur);
            strip_lrc_credit_banners(&mut lines, title);
            if lines.len() >= 4 {
                return LyricsResult {
                    found: true,
                    synced: true,
                    word_synced: false,
                    pacing_v: PACING_VERSION,
                    source: "netease".to_string(),
                    title: cand_title,
                    artist: artist.to_string(),
                    duration_ms: out_dur,
                    lines,
                };
            }
        }

        LyricsResult::empty(title, artist)
    }

    /// Query QQ Music (`c.y.qq.com`) synced LRC catalog.
    fn query_qqmusic(&self, title: &str, artist: &str, duration_ms: i64) -> LyricsResult {
        if title.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let primary_artist = split_artist_candidates(artist)
            .into_iter()
            .next()
            .unwrap_or_default();
        let query = if primary_artist.is_empty() {
            title.to_string()
        } else {
            format!("{} {}", title, primary_artist)
        };
        let search_url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&format=json&p=1&n=5",
            urlencoding::encode(&query)
        );
        let referer = "https://y.qq.com/portal/player.html";
        let Some(val) = self.http_get_json_with_referer(&search_url, referer, 5) else {
            return LyricsResult::empty(title, artist);
        };
        let Some(list) = val.pointer("/data/song/list").and_then(|v| v.as_array()) else {
            return LyricsResult::empty(title, artist);
        };

        let mut cands: Vec<(String, i64, String)> = list
            .iter()
            .filter_map(|s| {
                let mid = s.get("songmid")?.as_str()?.to_string();
                let dur = s.get("interval").and_then(|d| d.as_i64()).unwrap_or(0) * 1000;
                let name = s.get("songname").and_then(|n| n.as_str()).unwrap_or(title).to_string();
                Some((mid, dur, name))
            })
            .collect();
        if duration_ms > 0 {
            cands.sort_by_key(|(_, d, _)| if *d > 0 { (*d - duration_ms).abs() } else { 999_999 });
        }

        for (mid, cand_dur, cand_title) in cands.into_iter().take(2) {
            let lyr_url = format!(
                "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&format=json&nobase64=1&g_tk=5381",
                urlencoding::encode(&mid)
            );
            let Some(lval) = self.http_get_json_with_referer(&lyr_url, referer, 5) else {
                continue;
            };
            let Some(raw) = lval.get("lyric").and_then(|v| v.as_str()) else {
                continue;
            };
            if !raw.contains('[') {
                continue;
            }
            let decoded = unescape_xml(raw);
            let out_dur = if cand_dur > 0 { cand_dur } else { duration_ms };
            let mut lines = parse_lrc(&decoded, out_dur);
            strip_lrc_credit_banners(&mut lines, title);
            if lines.len() >= 4 {
                return LyricsResult {
                    found: true,
                    synced: true,
                    word_synced: false,
                    pacing_v: PACING_VERSION,
                    source: "qqmusic".to_string(),
                    title: cand_title,
                    artist: artist.to_string(),
                    duration_ms: out_dur,
                    lines,
                };
            }
        }

        LyricsResult::empty(title, artist)
    }

    fn query_boidu(
        &self,
        title: &str,
        artist: &str,
        duration_ms: i64,
        prefer_romanized: bool,
    ) -> LyricsResult {
        if title.is_empty() || artist.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let dur_sec = if duration_ms > 0 {
            ((duration_ms as f64) / 1000.0).round() as i64
        } else {
            0
        };
        let artist_candidates = split_artist_candidates(artist);

        let mut urls = Vec::new();
        if dur_sec > 0 {
            for cand in &artist_candidates {
                urls.push(format!(
                    "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}&d={}",
                    urlencoding::encode(title),
                    urlencoding::encode(cand),
                    dur_sec
                ));
            }
        }
        for cand in &artist_candidates {
            urls.push(format!(
                "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(title),
                urlencoding::encode(cand)
            ));
        }

        for url in urls {
            if let Some(val) = self.http_get_json(&url, 5) {
                if let Ok(resp) = serde_json::from_value::<BoiduResp>(val) {
                    if let Some(ttml) = resp.ttml.filter(|t| t.contains("<p")) {
                        let (lines, word_synced, body_dur_ms, used_translit) =
                            parse_boidu_ttml_with_mode(&ttml, duration_ms, prefer_romanized);
                        if !lines.is_empty() {
                            return LyricsResult {
                                found: true,
                                synced: true,
                                word_synced,
                                pacing_v: PACING_VERSION,
                                source: if used_translit {
                                    "boidu_hinglish".to_string()
                                } else {
                                    "boidu".to_string()
                                },
                                title: title.to_string(),
                                artist: artist.to_string(),
                                duration_ms: body_dur_ms,
                                lines,
                            };
                        }
                    }
                }
            }
        }

        LyricsResult::empty(title, artist)
    }

    /// Query KuGou synced LRC catalog (huge Bollywood/Hinglish, J-Pop, K-Pop & global catalog!).
    fn query_kugou(&self, title: &str, artist: &str, duration_ms: i64) -> LyricsResult {
        if title.is_empty() {
            return LyricsResult::empty(title, artist);
        }
        let primary_artist = artist
            .split(|c| matches!(c, ',' | ';' | '&' | '/'))
            .next()
            .map(|s| s.trim())
            .unwrap_or(artist);
        let keyword = if primary_artist.is_empty() {
            title.to_string()
        } else {
            format!("{} - {}", primary_artist, title)
        };
        let dur_param = if duration_ms > 0 {
            format!("&duration={}", duration_ms)
        } else {
            String::new()
        };
        let search_url = format!(
            "https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword={}{}",
            urlencoding::encode(&keyword),
            dur_param
        );

        let Some(val) = self.http_get_json(&search_url, 5) else {
            return LyricsResult::empty(title, artist);
        };
        let Ok(resp) = serde_json::from_value::<KugouSearchResp>(val) else {
            return LyricsResult::empty(title, artist);
        };
        let Some(mut candidates) = resp.candidates else {
            return LyricsResult::empty(title, artist);
        };
        if candidates.is_empty() {
            return LyricsResult::empty(title, artist);
        }

        // Pick candidate with closest duration to the live track!
        if duration_ms > 0 {
            candidates.sort_by_key(|c| {
                let d = c.duration.unwrap_or(0);
                if d > 0 {
                    (d - duration_ms).abs()
                } else {
                    999_999
                }
            });
        }

        for cand in candidates.into_iter().take(2) {
            let (Some(id), Some(key)) = (cand.id, cand.accesskey) else {
                continue;
            };
            let dl_url = format!(
                "https://krcs.kugou.com/download?ver=1&client=pc&id={}&accesskey={}&fmt=lrc&charset=utf8",
                urlencoding::encode(&id),
                urlencoding::encode(&key)
            );
            let Some(dl_val) = self.http_get_json(&dl_url, 5) else {
                continue;
            };
            let Ok(dl) = serde_json::from_value::<KugouDownloadResp>(dl_val) else {
                continue;
            };
            let Some(b64) = dl.content else {
                continue;
            };
            let bytes = decode_base64(&b64);
            let Ok(lrc_raw) = String::from_utf8(bytes) else {
                continue;
            };
            let cand_dur = cand.duration.filter(|&d| d > 0).unwrap_or(duration_ms);
            let mut lines = parse_lrc(&lrc_raw, cand_dur);
            strip_lrc_credit_banners(&mut lines, title);
            if lines.len() >= 4 {
                return LyricsResult {
                    found: true,
                    synced: true,
                    word_synced: false,
                    pacing_v: PACING_VERSION,
                    source: "kugou".to_string(),
                    title: cand.song.unwrap_or_else(|| title.to_string()),
                    artist: cand.singer.unwrap_or_else(|| artist.to_string()),
                    duration_ms: cand_dur,
                    lines,
                };
            }
        }

        LyricsResult::empty(title, artist)
    }

    fn query_lrclib(&self, title: &str, artist: &str, album: &str, duration_ms: i64) -> LyricsResult {
        let duration_sec = if duration_ms > 0 {
            ((duration_ms as f64) / 1000.0).round() as i64
        } else {
            0
        };

        // 1. Exact lookup when we have title, artist, and duration (highest accuracy!)
        if !title.is_empty() && !artist.is_empty() && duration_sec > 0 {
            let mut url = format!(
                "https://lrclib.net/api/get?track_name={}&artist_name={}&duration={}",
                urlencoding::encode(title),
                urlencoding::encode(artist),
                duration_sec
            );
            if !album.is_empty() {
                url.push_str(&format!("&album_name={}", urlencoding::encode(album)));
            }
            if let Some(val) = self.http_get_json(&url, 6) {
                if let Ok(item) = serde_json::from_value::<LrclibItem>(val) {
                    if item.synced_lyrics.as_deref().map(|s| !s.is_empty()).unwrap_or(false) {
                        return self.format_lrclib_hit(item, title, artist, duration_ms);
                    }
                }
            }
        }

        // 2. Search and strictly pick the closest-duration synced match (with primary-artist fallback for multi-artist collabs!)
        let primary_artist = artist
            .split(|c| matches!(c, ',' | ';' | '&' | '/'))
            .next()
            .map(|s| s.trim())
            .unwrap_or(artist);
        let mut search_urls = Vec::new();
        if !artist.is_empty() && !title.is_empty() {
            search_urls.push(format!(
                "https://lrclib.net/api/search?track_name={}&artist_name={}",
                urlencoding::encode(title),
                urlencoding::encode(artist)
            ));
            if !primary_artist.is_empty() && !primary_artist.eq_ignore_ascii_case(artist) {
                search_urls.push(format!(
                    "https://lrclib.net/api/search?track_name={}&artist_name={}",
                    urlencoding::encode(title),
                    urlencoding::encode(primary_artist)
                ));
            }
            let combined = format!("{} {}", primary_artist, title);
            search_urls.push(format!(
                "https://lrclib.net/api/search?q={}",
                urlencoding::encode(&combined)
            ));
        } else {
            search_urls.push(format!(
                "https://lrclib.net/api/search?q={}",
                urlencoding::encode(title)
            ));
        }

        for url in search_urls {
            if let Some(val) = self.http_get_json(&url, 6) {
                if let Ok(items) = serde_json::from_value::<Vec<LrclibItem>>(val) {
                    if let Some(best) = pick_best_lrclib_hit(items, duration_sec) {
                        return self.format_lrclib_hit(best, title, artist, duration_ms);
                    }
                }
            }
        }

        LyricsResult::empty(title, artist)
    }

    fn format_lrclib_hit(
        &self,
        hit: LrclibItem,
        clean_title: &str,
        clean_artist: &str,
        duration_ms: i64,
    ) -> LyricsResult {
        let hit_dur_ms = hit
            .duration
            .map(|d| (d * 1000.0).round() as i64)
            .filter(|&d| d > 0)
            .unwrap_or(duration_ms);
        let out_title = hit.track_name.unwrap_or_else(|| clean_title.to_string());
        let out_artist = hit.artist_name.unwrap_or_else(|| clean_artist.to_string());

        if let Some(synced) = hit.synced_lyrics.filter(|s| !s.trim().is_empty()) {
            let word_synced = regexes().enhanced_word_ts.is_match(&synced);
            let lines = parse_lrc(&synced, hit_dur_ms);
            return LyricsResult {
                found: !lines.is_empty(),
                synced: true,
                word_synced,
                pacing_v: PACING_VERSION,
                source: "lrclib".to_string(),
                title: out_title,
                artist: out_artist,
                duration_ms: hit_dur_ms,
                lines,
            };
        }

        let plain = hit.plain_lyrics.unwrap_or_default();
        let lines = parse_plain_lyrics(&plain, hit_dur_ms);
        LyricsResult {
            found: !lines.is_empty(),
            synced: false,
            word_synced: false,
            pacing_v: PACING_VERSION,
            source: "lrclib_plain".to_string(),
            title: out_title,
            artist: out_artist,
            duration_ms: hit_dur_ms,
            lines,
        }
    }
}

/// Score a candidate lyric result against the live track's exact duration, sync granularity,
/// and (when Hinglish/Romanized mode is active) readable Latin/Roman script preference!
fn score_candidate(res: &LyricsResult, target_dur_ms: i64, prefer_romanized: bool) -> f64 {
    if !res.found || res.lines.is_empty() {
        return -1000.0;
    }
    let mut score = if res.synced { 100.0 } else { 10.0 };
    if res.word_synced {
        score += 55.0; // Huge preference for true millisecond word-by-word timing!
    }
    // Sync-quality tier priority: Unison > Boidu > LyricsPlus > LRCLIB > NetEase > QQ Music > KuGou
    if res.synced {
        score += match res.source.as_str() {
            "unison" | "unison_hinglish" => 18.0,
            "boidu" | "boidu_hinglish" => 15.0,
            "lyricsplus" => 12.0,
            "lrclib" => 8.0,
            "netease" => 5.0,
            "qqmusic" => 3.0,
            "kugou" => 1.0,
            _ => 0.0,
        };
    }
    if prefer_romanized {
        let ratio = latin_script_ratio(&res.lines);
        if ratio >= 0.70 {
            score += 48.0; // Strongly prefer clean Hinglish / Romaji / Romanized lyrics!
        } else {
            score -= 32.0;
        }
        if res.source == "boidu_hinglish" || res.source == "unison_hinglish" {
            score += 14.0; // Studio-authored hi-Latn / ja-Latn / ko-Latn!
        }
    }
    if target_dur_ms > 0 && res.duration_ms > 0 {
        let diff_sec = (res.duration_ms - target_dur_ms).abs() as f64 / 1000.0;
        if diff_sec <= 1.5 {
            score += 45.0;
        } else if diff_sec <= 3.5 {
            score += 24.0;
        } else if diff_sec <= 6.0 {
            score += 4.0;
        } else {
            // Steep penalty for mismatched studio/MV cuts so exact-duration track wins automatically!
            score -= diff_sec * 5.5;
        }
    }
    score
}

fn pick_best_lrclib_hit(items: Vec<LrclibItem>, duration_sec: i64) -> Option<LrclibItem> {
    let re = regexes();
    let mut best: Option<(f64, LrclibItem)> = None;
    for item in items {
        let synced_str = item.synced_lyrics.as_deref().unwrap_or("");
        let has_synced = !synced_str.trim().is_empty();
        let has_plain = item.plain_lyrics.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        if !has_synced && !has_plain {
            continue;
        }
        let mut score = if has_synced { 100.0 } else { 10.0 };
        if has_synced && re.enhanced_word_ts.is_match(synced_str) {
            score += 40.0;
        }
        if duration_sec > 0 {
            if let Some(h_dur) = item.duration {
                if h_dur > 0.0 {
                    let diff = (h_dur - duration_sec as f64).abs();
                    if diff <= 1.5 {
                        score += 45.0;
                    } else if diff <= 3.5 {
                        score += 20.0;
                    } else {
                        score -= (diff * 4.5).min(85.0);
                    }
                }
            }
        }
        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
            best = Some((score, item));
        }
    }
    best.map(|(_, item)| item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boidu_ttml_syllable_merge_and_timestamps() {
        let sample = r#"<tt xmlns="http://www.w3.org/ns/ttml" itunes:timing="Word"><body dur="3:20.500"><div>
            <p begin="30.189" end="32.529"><span begin="30.189" end="30.396">I&apos;ve</span> <span begin="31.839" end="31.996">e</span><span begin="31.996" end="32.529">nough</span></p>
            <p begin="1:05.250" end="1:08.000"><span begin="1:05.250" end="1:06.100">Stars</span></p>
        </div></body></tt>"#;
        let (lines, word_synced, dur) = parse_boidu_ttml(sample, 0);
        assert!(word_synced);
        assert_eq!(dur, 200_500);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "I've enough");
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[0].word, "I've");
        assert_eq!(lines[0].words[1].word, "enough");
        assert_eq!(lines[0].words[1].start_ms, 31_839);
        assert_eq!(lines[0].words[1].end_ms, 32_529);
        assert_eq!(lines[1].start_ms, 65_250);

        // Verify Japanese / Korean / Hindi / Spanish multilingual segmentation & TTML preservation
        let jp = build_words_for_line("夜空に星が降るよ", 1000, 4000, None);
        assert!(jp.len() >= 2, "Expected Japanese line segmented into poetic chunks, got {:?}", jp);
        assert!(!jp[0].clean.is_empty(), "Expected Japanese characters preserved in clean token");

        let hi = build_words_for_line("तुम ही हो मेरी दुनिया", 1000, 4000, None);
        assert_eq!(hi.len(), 5);
        assert_eq!(hi[0].clean, "तुम");
    }

    #[test]
    fn test_auto_provider_picks_boidu_or_exact_lrclib() {
        let tmp = std::env::temp_dir().join("astralis_test_lyrics_cache");
        let _ = fs::remove_dir_all(&tmp);
        let engine = LyricsEngine::new(tmp);
        engine.set_provider_mode("auto");

        // Coldplay - Yellow (267s) has real word-by-word Unison / Boidu / LyricsPlus -> Auto should pick Unison!
        let yellow = engine.fetch_lyrics("Yellow", "Coldplay", "", 267_000);
        assert!(yellow.found && yellow.synced, "Yellow should find synced lyrics");
        println!(
            "Yellow (Auto) -> source={} word_synced={} lines={} dur={}ms first_ms={} first=\"{}\"",
            yellow.source,
            yellow.word_synced,
            yellow.lines.len(),
            yellow.duration_ms,
            yellow.lines.first().map(|l| l.start_ms).unwrap_or(0),
            yellow.lines.first().map(|l| l.text.as_str()).unwrap_or("")
        );
        assert!(matches!(yellow.source.as_str(), "unison" | "boidu" | "lyricsplus"));
        assert!(yellow.word_synced);

        // Verify ALL 7 providers individually & compare their actual sync timestamps on Coldplay - Yellow!
        for prov in ["unison", "boidu", "lyricsplus", "lrclib", "netease", "qqmusic", "kugou"] {
            engine.set_provider_mode(prov);
            let r = engine.fetch_lyrics("Yellow", "Coldplay", "", 267_000);
            println!(
                "  [{prov:10}] found={} source={:10} word={} lines={:2} first_ms={:6} first=\"{}\"",
                r.found,
                r.source,
                r.word_synced,
                r.lines.len(),
                r.lines.first().map(|l| l.start_ms).unwrap_or(0),
                r.lines.first().map(|l| l.text.as_str()).unwrap_or("")
            );
            assert!(r.found && r.synced, "Provider {prov} should return synced lyrics for Yellow");
        }
        engine.set_provider_mode("auto");

        // Anson Seabra - Welcome to Wonderland (199.1s) -> Auto should fallback cleanly to LRCLIB exact 199s cut (first_ms ~15070, NOT 16130)!
        let wonder = engine.fetch_lyrics("Welcome to Wonderland", "Anson Seabra", "", 199_141);
        assert!(wonder.found && wonder.synced, "Wonderland should find synced lyrics");
        println!(
            "Wonderland -> source={} word_synced={} lines={} dur={}ms first_ms={}",
            wonder.source,
            wonder.word_synced,
            wonder.lines.len(),
            wonder.duration_ms,
            wonder.lines.first().map(|l| l.start_ms).unwrap_or(0)
        );
        assert!(
            (wonder.lines[0].start_ms - 15_070).abs() <= 400,
            "Expected exact 199s cut starting ~15070ms, got {}ms",
            wonder.lines[0].start_ms
        );

        // Multi-artist Hindi track (Arijit Singh, Pritam, Amitabh Bhattacharya) -> should now hit official Apple Music Boidu TTML!
        let (clean_p, _) = clean_track_metadata("Pompeii;Pompeii", "Bastille");
        assert_eq!(clean_p, "Pompeii");
        let raabta = engine.fetch_lyrics(
            "Raabta",
            "Arijit Singh, Pritam, Amitabh Bhattacharya",
            "",
            244_000,
        );
        assert!(raabta.found && raabta.synced, "Raabta should find synced lyrics");
        println!(
            "Raabta -> source={} word_synced={} lines={} dur={}ms first_ms={}",
            raabta.source,
            raabta.word_synced,
            raabta.lines.len(),
            raabta.duration_ms,
            raabta.lines.first().map(|l| l.start_ms).unwrap_or(0)
        );
        assert!(matches!(raabta.source.as_str(), "unison" | "boidu" | "lyricsplus"));

        // Hinglish / Romanized mode on Raabta -> official Apple Music hi-Latn Hinglish!
        engine.set_provider_mode("hinglish");
        let raabta_hi = engine.fetch_lyrics(
            "Raabta",
            "Arijit Singh, Pritam, Amitabh Bhattacharya",
            "",
            244_000,
        );
        assert!(raabta_hi.found && raabta_hi.synced);
        println!(
            "Raabta (Hinglish) -> source={} first=\"{}\" latin={:.2}",
            raabta_hi.source,
            raabta_hi.lines.first().map(|l| l.text.as_str()).unwrap_or(""),
            latin_script_ratio(&raabta_hi.lines)
        );
        assert!(latin_script_ratio(&raabta_hi.lines) >= 0.85, "Expected Hinglish Latin script!");

        // KuGou provider direct check on Raabta
        engine.set_provider_mode("kugou");
        let raabta_kg = engine.fetch_lyrics("Raabta", "Arijit Singh", "", 244_000);
        assert!(raabta_kg.found && raabta_kg.synced);
        println!(
            "Raabta (KuGou) -> source={} lines={} first=\"{}\"",
            raabta_kg.source,
            raabta_kg.lines.len(),
            raabta_kg.lines.first().map(|l| l.text.as_str()).unwrap_or("")
        );
    }
}
