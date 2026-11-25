//! Native Windows Global SMTC Media Watcher with Zero-Fidget Drift-Proof Timeline Anchor.
//!
//! Directly uses Microsoft's official `windows::Media::Control` WinRT APIs:
//!   - Smart per-player automatic latency lead (55ms native desktop players, 180ms browsers)
//!   - Guards against stale pre-pause `LastUpdatedTime` on BOTH resume AND initial attach
//!   - Auto-refetches lyrics if a player reports `duration_ms` slightly after track title change
//!   - Supports instant provider switching (Auto / Boidu TTML / LRCLIB) & media controls

use crate::lyrics::{clean_track_metadata, LyricLine, LyricsEngine};
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use windows::Foundation::TimeSpan;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as SmtcSession,
    GlobalSystemMediaTransportControlsSessionManager as SmtcManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

const WINRT_TO_UNIX_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Debug, Clone, Serialize)]
pub struct MediaSnapshot {
    pub available: bool,
    pub has_session: bool,
    pub status: String,
    pub playback_rate: f64,
    pub title: String,
    pub artist: String,
    pub clean_title: String,
    pub clean_artist: String,
    pub album: String,
    pub source_app: String,
    pub recommended_lead_ms: i64,
    pub position_ms: i64,
    pub duration_ms: i64,
    pub lyrics_status: String,
    pub lyrics_source: String,
    pub lyrics_word_synced: bool,
    pub track_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LyricsPayload {
    pub track_key: String,
    pub found: bool,
    pub synced: bool,
    pub word_synced: bool,
    pub source: String,
    pub lines: Vec<LyricLine>,
}

struct SharedState {
    snapshot: MediaSnapshot,
    captured_at: Instant,
    lyrics: LyricsPayload,
}

enum MediaCmd {
    PlayPause,
    Play,
    Pause,
    Next,
    Prev,
    Seek(i64),
    RefetchLyrics,
}

pub struct MediaWatcher {
    lyrics_engine: Arc<LyricsEngine>,
    shared: Arc<Mutex<SharedState>>,
    cmd_queue: Arc<Mutex<VecDeque<MediaCmd>>>,
    stop_flag: Arc<AtomicBool>,
}

fn friendly_app_info(aumid: &str) -> (String, i64) {
    let low = aumid.to_lowercase();
    if low.contains("spotify") {
        ("Spotify".into(), 115)
    } else if low.contains("limusic") {
        ("LiMusic".into(), 115)
    } else if low.contains("chrome") {
        ("Chrome".into(), 165)
    } else if low.contains("msedge") || low.contains("edge") {
        ("Edge".into(), 165)
    } else if low.contains("brave") {
        ("Brave".into(), 165)
    } else if low.contains("firefox") {
        ("Firefox".into(), 150)
    } else if low.contains("opera") {
        ("Opera".into(), 165)
    } else if low.contains("vlc") {
        ("VLC".into(), 110)
    } else if low.contains("foobar") {
        ("foobar2000".into(), 105)
    } else if low.contains("apple") || low.contains("itunes") {
        ("Apple Music".into(), 115)
    } else if low.contains("tidal") {
        ("TIDAL".into(), 115)
    } else if low.contains("youtube") {
        ("YouTube".into(), 165)
    } else if low.contains("music") {
        ("Media Player".into(), 115)
    } else {
        let name: String = aumid
            .split('!')
            .next()
            .unwrap_or("Media")
            .split('.')
            .last()
            .unwrap_or("Media")
            .chars()
            .take(18)
            .collect();
        (name, 120)
    }
}

fn winrt_datetime_to_unix_sec(universal_time: i64) -> Option<f64> {
    if universal_time <= WINRT_TO_UNIX_TICKS {
        return None;
    }
    let unix_ticks = universal_time - WINRT_TO_UNIX_TICKS;
    let sec = unix_ticks as f64 / 10_000_000.0;
    if sec < 946_684_800.0 {
        return None;
    }
    Some(sec)
}

struct AnchorMachine {
    prev_status: String,
    prev_raw_pos_ms: i64,
    prev_lut_ticks: i64,
    anchor_pos_ms: f64,
    anchor_mono: Instant,
    anchor_rate: f64,
    has_attached_track: bool,
}

impl AnchorMachine {
    fn new() -> Self {
        Self {
            prev_status: "stopped".to_string(),
            prev_raw_pos_ms: -1,
            prev_lut_ticks: 0,
            anchor_pos_ms: 0.0,
            anchor_mono: Instant::now(),
            anchor_rate: 1.0,
            has_attached_track: false,
        }
    }

    fn force_seek(&mut self, pos_ms: i64) {
        self.anchor_pos_ms = pos_ms.max(0) as f64;
        self.anchor_mono = Instant::now();
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve(
        &mut self,
        status: &str,
        rate: f64,
        raw_pos_ms: i64,
        dur_ms: i64,
        lut_ticks: i64,
        now_unix_sec: f64,
        now_mono: Instant,
        track_changed: bool,
    ) -> i64 {
        let tl_updated = raw_pos_ms != self.prev_raw_pos_ms || lut_ticks != self.prev_lut_ticks;
        let resumed = self.prev_status != "playing" && status == "playing";
        let paused_now = self.prev_status == "playing" && status != "playing";

        let drift_sec: Option<f64> = winrt_datetime_to_unix_sec(lut_ticks).and_then(|lut_sec| {
            let d = now_unix_sec - lut_sec;
            if (-1.5..=7200.0).contains(&d) {
                Some(d.max(0.0))
            } else {
                None
            }
        });

        if track_changed {
            if !self.has_attached_track {
                // First attach: guard against stale pre-pause lut (> 12s old) so we never jump minutes ahead!
                let mut pos = raw_pos_ms as f64;
                if status == "playing" && rate > 0.0 {
                    if let Some(d) = drift_sec {
                        if d <= 12.0 || (raw_pos_ms == 0 && d <= 240.0) {
                            let extrap = raw_pos_ms as f64 + d * 1000.0 * rate;
                            if dur_ms <= 0 || extrap <= dur_ms as f64 + 1500.0 {
                                pos = extrap;
                            }
                        }
                    }
                }
                self.anchor_pos_ms = pos;
                self.anchor_mono = now_mono;
                self.has_attached_track = true;
            } else {
                // Track changed while running (e.g. YouTube/LiMusic auto-next)
                if !tl_updated && raw_pos_ms > 5000 {
                    self.anchor_pos_ms = 0.0;
                } else if status == "playing" && rate > 0.0 {
                    if let Some(d) = drift_sec {
                        if d <= 3.0 {
                            self.anchor_pos_ms = raw_pos_ms as f64 + d * 1000.0 * rate;
                        } else {
                            self.anchor_pos_ms = raw_pos_ms as f64;
                        }
                    } else {
                        self.anchor_pos_ms = raw_pos_ms as f64;
                    }
                } else {
                    self.anchor_pos_ms = raw_pos_ms as f64;
                }
                self.anchor_mono = now_mono;
            }
        } else if status != "playing" {
            if tl_updated {
                self.anchor_pos_ms = raw_pos_ms as f64;
            } else if paused_now && self.anchor_rate > 0.0 {
                let elapsed_ms =
                    now_mono.saturating_duration_since(self.anchor_mono).as_secs_f64() * 1000.0;
                self.anchor_pos_ms += elapsed_ms * self.anchor_rate;
            }
            self.anchor_mono = now_mono;
        } else if resumed {
            if tl_updated && rate > 0.0 {
                if let Some(d) = drift_sec {
                    if d <= 2.5 {
                        self.anchor_pos_ms = raw_pos_ms as f64 + d * 1000.0 * rate;
                    } else {
                        self.anchor_pos_ms = raw_pos_ms as f64;
                    }
                } else {
                    self.anchor_pos_ms = raw_pos_ms as f64;
                }
            } else {
                // Player kept stale lut from before pause — resume cleanly from raw_pos_ms
                self.anchor_pos_ms = raw_pos_ms as f64;
            }
            self.anchor_mono = now_mono;
        } else if tl_updated {
            // Fresh timeline sync packet or user seek!
            if rate > 0.0 {
                if let Some(d) = drift_sec {
                    if d <= 2.5 {
                        self.anchor_pos_ms = raw_pos_ms as f64 + d * 1000.0 * rate;
                    } else {
                        self.anchor_pos_ms = raw_pos_ms as f64;
                    }
                } else {
                    self.anchor_pos_ms = raw_pos_ms as f64;
                }
            } else {
                self.anchor_pos_ms = raw_pos_ms as f64;
            }
            self.anchor_mono = now_mono;
        } else {
            // Steady playback between SMTC packets: advance on exact monotonic clock
            if rate > 0.0 {
                let elapsed_ms =
                    now_mono.saturating_duration_since(self.anchor_mono).as_secs_f64() * 1000.0;
                self.anchor_pos_ms += elapsed_ms * rate;
            }
            self.anchor_mono = now_mono;
        }

        if dur_ms > 0 {
            self.anchor_pos_ms = self.anchor_pos_ms.clamp(0.0, dur_ms as f64);
        } else {
            self.anchor_pos_ms = self.anchor_pos_ms.max(0.0);
        }

        self.prev_status = status.to_string();
        self.prev_raw_pos_ms = raw_pos_ms;
        self.prev_lut_ticks = lut_ticks;
        self.anchor_rate = if status == "playing" { rate } else { 0.0 };

        self.anchor_pos_ms.round() as i64
    }
}

fn pick_best_session(mgr: &SmtcManager, preferred_aumid: &str) -> Option<SmtcSession> {
    let mut preferred_match: Option<SmtcSession> = None;
    if let Ok(sessions) = mgr.GetSessions() {
        let n = sessions.Size().unwrap_or(0);
        for i in 0..n {
            if let Ok(s) = sessions.GetAt(i) {
                if let Ok(pb) = s.GetPlaybackInfo() {
                    if pb.PlaybackStatus().ok() == Some(PlaybackStatus::Playing) {
                        return Some(s);
                    }
                }
                if !preferred_aumid.is_empty() && preferred_match.is_none() {
                    if let Ok(aumid) = s.SourceAppUserModelId() {
                        if aumid.to_string() == preferred_aumid {
                            preferred_match = Some(s);
                        }
                    }
                }
            }
        }
    }
    // Keep the user's recently-paused active player instead of jumping to a random other paused tab!
    if let Some(s) = preferred_match {
        return Some(s);
    }
    if let Ok(cur) = mgr.GetCurrentSession() {
        return Some(cur);
    }
    if let Ok(sessions) = mgr.GetSessions() {
        if sessions.Size().unwrap_or(0) > 0 {
            return sessions.GetAt(0).ok();
        }
    }
    None
}

impl MediaWatcher {
    pub fn new(lyrics_engine: Arc<LyricsEngine>) -> Self {
        let initial = SharedState {
            snapshot: MediaSnapshot {
                available: true,
                has_session: false,
                status: "stopped".into(),
                playback_rate: 1.0,
                title: String::new(),
                artist: String::new(),
                clean_title: String::new(),
                clean_artist: String::new(),
                album: String::new(),
                source_app: String::new(),
                recommended_lead_ms: 80,
                position_ms: 0,
                duration_ms: 0,
                lyrics_status: "idle".into(),
                lyrics_source: "none".into(),
                lyrics_word_synced: false,
                track_key: String::new(),
            },
            captured_at: Instant::now(),
            lyrics: LyricsPayload {
                track_key: String::new(),
                found: false,
                synced: false,
                word_synced: false,
                source: "none".into(),
                lines: Vec::new(),
            },
        };
        Self {
            lyrics_engine,
            shared: Arc::new(Mutex::new(initial)),
            cmd_queue: Arc::new(Mutex::new(VecDeque::new())),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self) {
        let shared = Arc::clone(&self.shared);
        let cmd_queue = Arc::clone(&self.cmd_queue);
        let lyrics_engine = Arc::clone(&self.lyrics_engine);
        let stop_flag = Arc::clone(&self.stop_flag);

        thread::Builder::new()
            .name("AstralisMediaWatcher".into())
            .spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                run_smtc_loop(shared, cmd_queue, lyrics_engine, stop_flag);
                unsafe {
                    CoUninitialize();
                }
            })
            .ok();
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }

    pub fn force_refetch_lyrics(&self) {
        if let Ok(mut q) = self.cmd_queue.lock() {
            q.push_back(MediaCmd::RefetchLyrics);
        }
    }

    pub fn get_snapshot(&self) -> MediaSnapshot {
        let guard = self.shared.lock().unwrap();
        let mut snap = guard.snapshot.clone();
        if snap.status == "playing" && snap.has_session && snap.playback_rate > 0.0 {
            let elapsed_ms =
                guard.captured_at.elapsed().as_secs_f64() * 1000.0 * snap.playback_rate;
            let mut pos = (snap.position_ms as f64 + elapsed_ms).round() as i64;
            if snap.duration_ms > 0 {
                pos = pos.min(snap.duration_ms);
            }
            snap.position_ms = pos.max(0);
        }
        snap
    }

    pub fn get_lyrics(&self) -> LyricsPayload {
        self.shared.lock().unwrap().lyrics.clone()
    }

    pub fn send_command(&self, action: &str, position_ms: Option<i64>) -> bool {
        let cmd = match action {
            "play_pause" => MediaCmd::PlayPause,
            "play" => MediaCmd::Play,
            "pause" => MediaCmd::Pause,
            "next" => MediaCmd::Next,
            "prev" => MediaCmd::Prev,
            "seek" => MediaCmd::Seek(position_ms.unwrap_or(0)),
            _ => return false,
        };
        if let Ok(mut q) = self.cmd_queue.lock() {
            q.push_back(cmd);
            return true;
        }
        false
    }
}

fn spawn_lyrics_fetch(
    lyrics_engine: Arc<LyricsEngine>,
    shared: Arc<Mutex<SharedState>>,
    t_key: String,
    r_title: String,
    r_artist: String,
    r_album: String,
    dur_ms: i64,
) {
    thread::Builder::new()
        .name("AstralisLyricsFetch".into())
        .spawn(move || {
            let res = lyrics_engine.fetch_lyrics(&r_title, &r_artist, &r_album, dur_ms);
            if let Ok(mut st) = shared.lock() {
                if st.snapshot.track_key != t_key {
                    return;
                }
                if res.found && !res.lines.is_empty() {
                    st.snapshot.lyrics_status =
                        if res.synced { "synced".into() } else { "plain".into() };
                    st.snapshot.lyrics_source = res.source.clone();
                    st.snapshot.lyrics_word_synced = res.word_synced;
                    st.lyrics = LyricsPayload {
                        track_key: t_key,
                        found: true,
                        synced: res.synced,
                        word_synced: res.word_synced,
                        source: res.source,
                        lines: res.lines,
                    };
                } else {
                    st.snapshot.lyrics_status = "not_found".into();
                    st.snapshot.lyrics_source = "none".into();
                    st.snapshot.lyrics_word_synced = false;
                }
            }
        })
        .ok();
}

fn run_smtc_loop(
    shared: Arc<Mutex<SharedState>>,
    cmd_queue: Arc<Mutex<VecDeque<MediaCmd>>>,
    lyrics_engine: Arc<LyricsEngine>,
    stop_flag: Arc<AtomicBool>,
) {
    let mut manager: Option<SmtcManager> = None;
    let mut anchor = AnchorMachine::new();
    let mut track_key = String::new();
    let mut fetched_dur_ms: i64 = 0;
    let mut last_sess_id = String::new();
    let mut cached_title = String::new();
    let mut cached_artist = String::new();
    let mut cached_album = String::new();
    let mut meta_tick: u32 = 0;
    let mut force_meta = true;

    while !stop_flag.load(Ordering::Relaxed) {
        if manager.is_none() {
            manager = SmtcManager::RequestAsync().ok().and_then(|op| op.get().ok());
        }
        let Some(ref mgr) = manager else {
            thread::sleep(Duration::from_millis(800));
            continue;
        };

        let Some(session) = pick_best_session(mgr, &last_sess_id) else {
            if let Ok(mut st) = shared.lock() {
                st.snapshot.has_session = false;
                st.snapshot.status = "stopped".into();
                st.captured_at = Instant::now();
            }
            thread::sleep(Duration::from_millis(650));
            continue;
        };

        let mut trigger_refetch = false;
        loop {
            let next_cmd = cmd_queue.lock().ok().and_then(|mut q| q.pop_front());
            let Some(cmd) = next_cmd else { break };
            match cmd {
                MediaCmd::PlayPause => {
                    // Explicit TryPauseAsync/TryPlayAsync works reliably on Chromium, Electron/LiMusic, & Spotify
                    // where TryTogglePlayPauseAsync is often ignored!
                    let is_playing = session
                        .GetPlaybackInfo()
                        .ok()
                        .and_then(|p| p.PlaybackStatus().ok())
                        == Some(PlaybackStatus::Playing);
                    let ok = if is_playing {
                        session.TryPauseAsync().and_then(|op| op.get()).unwrap_or(false)
                    } else {
                        session.TryPlayAsync().and_then(|op| op.get()).unwrap_or(false)
                    };
                    if !ok {
                        let _ = session.TryTogglePlayPauseAsync().and_then(|op| op.get());
                    }
                }
                MediaCmd::Play => {
                    let ok = session.TryPlayAsync().and_then(|op| op.get()).unwrap_or(false);
                    if !ok {
                        let _ = session.TryTogglePlayPauseAsync().and_then(|op| op.get());
                    }
                }
                MediaCmd::Pause => {
                    let ok = session.TryPauseAsync().and_then(|op| op.get()).unwrap_or(false);
                    if !ok {
                        let _ = session.TryTogglePlayPauseAsync().and_then(|op| op.get());
                    }
                }
                MediaCmd::Next => {
                    let _ = session.TrySkipNextAsync().and_then(|op| op.get());
                    force_meta = true;
                }
                MediaCmd::Prev => {
                    let _ = session.TrySkipPreviousAsync().and_then(|op| op.get());
                    force_meta = true;
                }
                MediaCmd::Seek(pos_ms) => {
                    let ticks = pos_ms.max(0) * 10_000;
                    let _ = session.TryChangePlaybackPositionAsync(ticks).and_then(|op| op.get());
                    anchor.force_seek(pos_ms);
                }
                MediaCmd::RefetchLyrics => {
                    trigger_refetch = true;
                }
            }
        }

        let sess_id = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
        let pb = session.GetPlaybackInfo().ok();
        let tl = session.GetTimelineProperties().ok();

        let status = match pb.as_ref().and_then(|p| p.PlaybackStatus().ok()) {
            Some(PlaybackStatus::Playing) => "playing",
            Some(PlaybackStatus::Paused) => "paused",
            _ => "stopped",
        };

        let rate = if status != "playing" {
            0.0
        } else {
            pb.as_ref()
                .and_then(|p| p.PlaybackRate().ok())
                .and_then(|r| r.GetDouble().ok())
                .filter(|&v| (0.25..=4.0).contains(&v))
                .unwrap_or(1.0)
        };

        let raw_pos_ms = tl
            .as_ref()
            .and_then(|t| t.Position().ok())
            .map(|ts: TimeSpan| (ts.Duration / 10_000).max(0))
            .unwrap_or(0);
        let dur_ms = tl
            .as_ref()
            .and_then(|t| t.EndTime().ok())
            .map(|ts: TimeSpan| (ts.Duration / 10_000).max(0))
            .unwrap_or(0);
        let lut_ticks = tl
            .as_ref()
            .and_then(|t| t.LastUpdatedTime().ok())
            .map(|dt| dt.UniversalTime)
            .unwrap_or(0);

        // Immediately refresh track metadata on timeline reset/change OR every 2 ticks (~160ms)
        // so auto-next track transitions never lag behind the audio!
        meta_tick = meta_tick.wrapping_add(1);
        let pos_reset = raw_pos_ms < 2500 && dur_ms != fetched_dur_ms;
        if force_meta || pos_reset || sess_id != last_sess_id || meta_tick % 2 == 0 {
            if let Ok(op) = session.TryGetMediaPropertiesAsync() {
                if let Ok(props) = op.get() {
                    cached_title = props
                        .Title()
                        .map(|s| s.to_string())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    cached_artist = props
                        .Artist()
                        .map(|s| s.to_string())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    cached_album = props
                        .AlbumTitle()
                        .map(|s| s.to_string())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                }
            }
            last_sess_id = sess_id.clone();
            force_meta = false;
        }

        let now_mono = Instant::now();
        let now_unix_sec = chrono::Utc::now().timestamp_millis() as f64 / 1000.0;
        let (clean_title, clean_artist) = clean_track_metadata(&cached_title, &cached_artist);
        let new_key = format!("{}::{}", clean_artist.to_lowercase(), clean_title.to_lowercase());
        let track_changed = !cached_title.is_empty() && new_key != track_key;

        // If the player reported dur_ms=0 on track change and now delivers the real track duration,
        // automatically re-fetch lyrics so exact-duration matching picks the right song cut!
        let dur_arrived = !track_changed
            && !cached_title.is_empty()
            && dur_ms > 15_000
            && (fetched_dur_ms == 0 || (dur_ms - fetched_dur_ms).abs() > 2500);

        let live_pos_ms = anchor.resolve(
            status,
            rate,
            raw_pos_ms,
            dur_ms,
            lut_ticks,
            now_unix_sec,
            now_mono,
            track_changed,
        );

        let (source_app, recommended_lead_ms) = friendly_app_info(&sess_id);

        let should_fetch = track_changed || dur_arrived || (trigger_refetch && !cached_title.is_empty());

        if let Ok(mut st) = shared.lock() {
            if should_fetch {
                track_key = new_key.clone();
                fetched_dur_ms = dur_ms;
                st.snapshot.lyrics_status = "loading".into();
                st.snapshot.lyrics_source = "none".into();
                st.snapshot.lyrics_word_synced = false;
                st.lyrics = LyricsPayload {
                    track_key: new_key.clone(),
                    found: false,
                    synced: false,
                    word_synced: false,
                    source: "none".into(),
                    lines: Vec::new(),
                };
            }
            st.snapshot.available = true;
            st.snapshot.has_session = !cached_title.is_empty();
            st.snapshot.status = status.into();
            st.snapshot.playback_rate = rate;
            st.snapshot.title = cached_title.clone();
            st.snapshot.artist = cached_artist.clone();
            st.snapshot.clean_title = clean_title.clone();
            st.snapshot.clean_artist = clean_artist.clone();
            st.snapshot.album = cached_album.clone();
            st.snapshot.source_app = source_app;
            st.snapshot.recommended_lead_ms = recommended_lead_ms;
            st.snapshot.position_ms = live_pos_ms;
            st.snapshot.duration_ms = dur_ms;
            st.snapshot.track_key = new_key.clone();
            st.captured_at = now_mono;
        }

        if should_fetch {
            spawn_lyrics_fetch(
                Arc::clone(&lyrics_engine),
                Arc::clone(&shared),
                new_key,
                cached_title.clone(),
                cached_artist.clone(),
                cached_album.clone(),
                dur_ms,
            );
        }

        thread::sleep(Duration::from_millis(if status == "playing" { 80 } else { 250 }));
    }
}
