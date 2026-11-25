/**
 * Authentic Astronomical Lyric-to-Constellation Mapper.
 *
 * Maps lyrics strictly to the 30 REAL IAU astronomical constellations —
 * ZERO fake or synthetic shapes. Uses poetic/mythological resonance when
 * keywords appear, and otherwise cycles gracefully through real night-sky
 * constellations based on the lyric's hash and mood.
 */

import { CONSTELLATIONS, CONSTELLATION_KEYS, PALETTES } from "./constellations.js";

// Keyword -> Real IAU Constellation ID
const KEYWORD_TO_CONSTELLATION = {
  // Orion (The Hunter)
  orion: "orion", hunter: "orion", star: "orion", stars: "orion", starlight: "orion",
  night: "orion", nights: "orion", midnight: "orion", dark: "orion", warrior: "orion",
  sword: "orion", blade: "orion", fight: "orion", battle: "orion", shield: "orion",
  // Ursa Minor (Polaris / North Star)
  north: "ursa_minor", polaris: "ursa_minor", compass: "ursa_minor", guide: "ursa_minor",
  lost: "ursa_minor", find: "ursa_minor", path: "ursa_minor", home: "ursa_minor", way: "ursa_minor",
  // Ursa Major (Great Bear / Big Dipper)
  bear: "ursa_major", sky: "ursa_major", skies: "ursa_major", moon: "ursa_major",
  moonlight: "ursa_major", forever: "ursa_major", endless: "ursa_major",
  // Cassiopeia (The Queen)
  queen: "cassiopeia", throne: "cassiopeia", royal: "cassiopeia", cassiopeia: "cassiopeia",
  // Corona Borealis (Northern Crown)
  crown: "corona_borealis", diamond: "corona_borealis", jewel: "corona_borealis",
  rose: "corona_borealis", flower: "corona_borealis", beauty: "corona_borealis", beautiful: "corona_borealis",
  // Cygnus (The Swan / Northern Cross)
  swan: "cygnus", wing: "cygnus", wings: "cygnus", angel: "cygnus", angels: "cygnus",
  feather: "cygnus", heaven: "cygnus", clouds: "cygnus", float: "cygnus",
  // Aquila (The Eagle)
  eagle: "aquila", fly: "aquila", flying: "aquila", soar: "aquila", high: "aquila",
  bird: "aquila", birds: "aquila", wind: "aquila", freedom: "aquila", free: "aquila",
  // Pegasus (Winged Horse)
  horse: "pegasus", run: "pegasus", running: "pegasus", race: "pegasus", fast: "pegasus",
  escape: "pegasus", chase: "pegasus", pegasus: "pegasus",
  // Lyra (Vega's Harp)
  music: "lyra", song: "lyra", sing: "lyra", singing: "lyra", melody: "lyra",
  voice: "lyra", harmony: "lyra", rhythm: "lyra", dance: "lyra", dancing: "lyra",
  echo: "lyra", sound: "lyra", lyra: "lyra", vega: "lyra",
  // Phoenix (Real Southern Constellation)
  phoenix: "phoenix", fire: "phoenix", flame: "phoenix", flames: "phoenix", burn: "phoenix",
  burning: "phoenix", ashes: "phoenix", rise: "phoenix", rising: "phoenix", reborn: "phoenix",
  ember: "phoenix", spark: "phoenix", alive: "phoenix",
  // Scorpius (Antares — Heart of the Scorpion)
  heart: "scorpius", hearts: "scorpius", heartbeat: "scorpius", blood: "scorpius",
  pain: "scorpius", sting: "scorpius", poison: "scorpius", red: "scorpius",
  crimson: "scorpius", passion: "scorpius", scorpio: "scorpius", antares: "scorpius",
  // Leo (The Lion / Regulus)
  lion: "leo", king: "leo", sun: "leo", sunlight: "leo", sunshine: "leo",
  gold: "leo", golden: "leo", glory: "leo", brave: "leo", roar: "leo", dawn: "leo",
  // Taurus (The Bull / Aldebaran)
  bull: "taurus", storm: "taurus", thunder: "taurus", lightning: "taurus", strong: "taurus",
  wild: "taurus", earth: "taurus", mountain: "taurus", mountains: "taurus",
  // Gemini (The Twins)
  love: "gemini", lover: "gemini", loved: "gemini", kiss: "gemini", together: "gemini",
  twin: "gemini", twins: "gemini", two: "gemini", soul: "gemini", baby: "gemini",
  darling: "gemini", hold: "gemini", embrace: "gemini",
  // Andromeda (The Chained Maiden / Galaxy)
  galaxy: "andromeda", universe: "andromeda", cosmos: "andromeda", space: "andromeda",
  dream: "andromeda", dreams: "andromeda", dreaming: "andromeda", infinite: "andromeda",
  andromeda: "andromeda",
  // Perseus (The Hero)
  hero: "perseus", save: "perseus", shadow: "perseus", shadows: "perseus",
  fear: "perseus", courage: "perseus", demon: "perseus",
  // Draco (The Dragon)
  dragon: "draco", serpent: "draco", dark: "draco", cold: "draco", ice: "draco",
  winter: "draco", snow: "draco", ancient: "draco", power: "draco",
  // Aquarius (The Water-Bearer)
  rain: "aquarius", raining: "aquarius", water: "aquarius", pour: "aquarius",
  tears: "aquarius", tear: "aquarius", cry: "aquarius", river: "aquarius", fall: "aquarius",
  // Pisces (The Fishes)
  ocean: "pisces", sea: "pisces", wave: "pisces", waves: "pisces", tide: "pisces",
  deep: "pisces", blue: "pisces", swim: "pisces", drown: "pisces", drift: "pisces",
  // Capricornus (Sea-Goat)
  climb: "capricornus", peak: "capricornus", world: "capricornus", shore: "capricornus",
  // Sagittarius (The Archer)
  arrow: "sagittarius", aim: "sagittarius", shoot: "sagittarius", target: "sagittarius",
  far: "sagittarius", horizon: "sagittarius", journey: "sagittarius", safar: "sagittarius",
  // Libra (The Scales)
  balance: "libra", truth: "libra", peace: "libra", calm: "libra", still: "libra",
  quiet: "libra", silence: "libra", justice: "libra",
  // Virgo (Spica)
  pure: "virgo", grace: "virgo", light: "virgo", hope: "virgo", gentle: "virgo",
  // Aries (The Ram)
  begin: "aries", start: "aries", spark: "aries", first: "aries", morning: "aries",
  // Cancer (Praesepe)
  memory: "cancer", memories: "cancer", past: "cancer", yesterday: "cancer",
  shelter: "cancer", safe: "cancer",
  // Crux (Southern Cross)
  cross: "crux", south: "crux", faith: "crux", prayer: "crux", pray: "crux",
  // Canis Major (Sirius — Brightest Star)
  bright: "canis_major", shine: "canis_major", shining: "canis_major", glow: "canis_major",
  radiant: "canis_major", sirius: "canis_major", flash: "canis_major",
  // Centaurus (Alpha Centauri)
  distant: "centaurus", beyond: "centaurus", miles: "centaurus", away: "centaurus",
  // Boötes (Arcturus)
  time: "bootes", wait: "bootes", waiting: "bootes", watch: "bootes", eyes: "bootes",
  // Auriga (Capella)
  road: "auriga", drive: "auriga", ride: "auriga", wheel: "auriga", speed: "auriga",
  // Additional IAU 88 Constellations!
  wolf: "lupus", wolves: "lupus", howl: "lupus",
  crow: "corvus", raven: "corvus", black: "corvus",
  dove: "columba", olive: "columba",
  dolphin: "delphinus", leap: "delphinus",
  river: "eridanus", flow: "eridanus", stream: "eridanus",
  sail: "vela", sails: "vela", ship: "carina", harbor: "pyxis", anchor: "carina",
  snake: "hydra", monster: "cetus", whale: "cetus", beast: "hydra",
  clock: "horologium", hours: "horologium", seconds: "horologium",
  unicorn: "monoceros", magic: "monoceros", wonder: "monoceros",
  cup: "crater", wine: "crater", drink: "crater",
  peacock: "pavo", paradise: "apus", crane: "grus",
  fox: "vulpecula", hare: "lepus", rabbit: "lepus", lynx: "lynx",
  altar: "ara", temple: "ara", sacred: "ara",
  hercules: "hercules", titan: "hercules", mighty: "hercules",
  king: "cepheus", monarch: "cepheus",
  triangle: "triangulum", pyramid: "triangulum",
  paint: "pictor", art: "sculptor", color: "chamaeleon",
  shield: "scutum", guard: "scutum", protect: "scutum",
  arrow: "sagitta", dart: "sagitta",
  ophiuchus: "ophiuchus", heal: "ophiuchus", cure: "ophiuchus",
  // Multilingual Poetic Resonance (Spanish, French, Hindi/Hinglish, Japanese, Korean, Chinese, German, Italian)
  // Spanish / Portuguese / Italian
  estrella: "orion", estrellas: "orion", noche: "orion", noches: "orion", luna: "ursa_major",
  cielo: "ursa_major", amor: "gemini", corazón: "scorpius", corazon: "scorpius", fuego: "phoenix",
  mar: "pisces", lluvia: "aquarius", lágrimas: "aquarius", lagrimas: "aquarius", sueño: "andromeda",
  sueno: "andromeda", sol: "leo", oro: "leo", alas: "cygnus", ángel: "cygnus", angel: "cygnus",
  viento: "aquila", música: "lyra", musica: "lyra", canción: "lyra", cancion: "lyra", tiempo: "bootes",
  stella: "orion", notte: "orion", cuore: "scorpius", amore: "gemini", fuoco: "phoenix",
  // French
  étoile: "orion", etoile: "orion", étoiles: "orion", nuit: "orion", lune: "ursa_major",
  amour: "gemini", cœur: "scorpius", coeur: "scorpius", rêve: "andromeda", reve: "andromeda",
  mer: "pisces", pluie: "aquarius", feu: "phoenix", soleil: "leo", ailes: "cygnus",
  // German
  stern: "orion", sterne: "orion", nacht: "orion", mond: "ursa_major", himmel: "ursa_major",
  liebe: "gemini", herz: "scorpius", traum: "andromeda", feuer: "phoenix", meer: "pisces", regen: "aquarius",
  // Hindi & Hinglish
  dil: "scorpius", pyaar: "gemini", pyar: "gemini", ishq: "gemini", mohabbat: "gemini",
  chaand: "ursa_major", chand: "ursa_major", chaandni: "ursa_major", taare: "orion", sitare: "orion",
  raat: "orion", asmaan: "ursa_major", aasmaan: "ursa_major", khwab: "andromeda", sapna: "andromeda",
  baarish: "aquarius", barish: "aquarius", aag: "phoenix", suraj: "leo", hawa: "aquila", samandar: "pisces",
  दिल: "scorpius", प्यार: "gemini", इश्क़: "gemini", इश्क: "gemini", चाँद: "ursa_major", चांद: "ursa_major",
  तारे: "orion", सितारे: "orion", रात: "orion", आसमान: "ursa_major", सपना: "andromeda", ख्वाब: "andromeda",
  बारिश: "aquarius", आग: "phoenix", सूरज: "leo", हवा: "aquila", समंदर: "pisces",
  // Japanese (Kanji/Kana + Romaji)
  hoshi: "orion", yoru: "orion", tsuki: "ursa_major", sora: "ursa_major", ai: "gemini",
  koi: "gemini", yume: "andromeda", umi: "pisces", ame: "aquarius", kaze: "aquila",
  hikari: "canis_major", honoo: "phoenix", kokoro: "scorpius", tsubasa: "cygnus",
  星: "orion", 夜: "orion", 夜空: "orion", 月: "ursa_major", 空: "ursa_major", 愛: "gemini",
  恋: "gemini", 夢: "andromeda", 海: "pisces", 雨: "aquarius", 風: "aquila", 光: "canis_major",
  炎: "phoenix", 火: "phoenix", 心: "scorpius", 翼: "cygnus", 花: "corona_borealis", 太陽: "leo",
  // Korean (Hangul + Romanized)
  sarang: "gemini", byeol: "orion", bam: "orion", dal: "ursa_major", haneul: "ursa_major",
  kkum: "andromeda", bada: "pisces", baram: "aquila", bit: "canis_major",
  사랑: "gemini", 별: "orion", 밤: "orion", 달: "ursa_major", 하늘: "ursa_major", 꿈: "andromeda",
  바다: "pisces", 비: "aquarius", 바람: "aquila", 빛: "canis_major", 불: "phoenix", 꽃: "corona_borealis", 마음: "scorpius",
};

// Spaceless CJK/Hangul/Devanagari substrings for poetic constellation & mood detection
const SUBSTRING_CONSTELLATION_HINTS = [
  ["夜空", "orion"], ["星", "orion"], ["夜", "orion"], ["月", "ursa_major"], ["空", "ursa_major"],
  ["愛", "gemini"], ["恋", "gemini"], ["夢", "andromeda"], ["海", "pisces"], ["雨", "aquarius"],
  ["風", "aquila"], ["光", "canis_major"], ["炎", "phoenix"], ["火", "phoenix"], ["心", "scorpius"],
  ["翼", "cygnus"], ["花", "corona_borealis"], ["太陽", "leo"], ["涙", "aquarius"], ["雪", "draco"],
  ["사랑", "gemini"], ["별", "orion"], ["달", "ursa_major"], ["하늘", "ursa_major"], ["꿈", "andromeda"],
  ["바다", "pisces"], ["바람", "aquila"], ["눈물", "aquarius"], ["태양", "leo"], ["날개", "cygnus"],
];

const MOOD_KEYWORDS = {
  solar: ["sun", "gold", "golden", "bright", "morning", "dawn", "warm", "shine", "crown", "glory", "happy", "smile", "sol", "soleil", "suraj", "सूरज", "太陽", "태양", "光", "빛"],
  rose: ["love", "heart", "kiss", "rose", "baby", "darling", "sweet", "tender", "bloom", "pink", "beautiful", "romance", "amor", "amour", "liebe", "pyaar", "ishq", "प्यार", "इश्क़", "愛", "恋", "花", "사랑", "꽃"],
  ember: ["fire", "flame", "burn", "burning", "red", "blood", "rage", "wild", "phoenix", "ashes", "heat", "passion", "fuego", "feu", "feuer", "aag", "आग", "炎", "火", "불"],
  ocean: ["ocean", "sea", "wave", "waves", "water", "rain", "tears", "blue", "drown", "river", "deep", "tide", "mar", "lluvia", "mer", "pluie", "baarish", "बारिश", "海", "雨", "涙", "바다", "눈물"],
  aurora: ["aurora", "magic", "forest", "emerald", "forever", "infinite", "diamond", "crystal", "ice", "snow", "free", "雪", "風", "바람"],
  violet: ["dream", "dreams", "purple", "violet", "midnight", "echo", "music", "melody", "eye", "eyes", "galaxy", "sueño", "rêve", "traum", "khwab", "सपना", "夢", "꿈"],
  lunar: ["moon", "silver", "night", "shadow", "ghost", "silence", "quiet", "peace", "alone", "cold", "winter", "luna", "noche", "lune", "nuit", "mond", "nacht", "chaand", "raat", "चाँद", "रात", "月", "夜", "달", "밤"],
  astral: ["star", "stars", "sky", "space", "universe", "wings", "angel", "heaven", "lightning", "fly", "orbit", "estrella", "étoile", "stern", "taare", "asmaan", "तारे", "आसमान", "星", "空", "翼", "별", "하늘"],
};

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class LyricMapper {
  constructor() {
    this.lastConstellationId = "";
    this.recentIds = [];
    this.songVisited = new Set();
    this.lastMorphTime = 0;
    this.lastPalette = PALETTES.astral;
    this.lineCount = 0;
  }

  resetForNewSong() {
    this.songVisited.clear();
    this.recentIds.length = 0;
    this.lineCount = 0;
  }

  _remember(cid) {
    this.lastConstellationId = cid;
    this.recentIds.push(cid);
    if (this.recentIds.length > 14) this.recentIds.shift();
    this.songVisited.add(cid);
    // Only recycle visited history if a super-long track has already toured 72+ unique constellations!
    if (this.songVisited.size >= 72) {
      this.songVisited = new Set(this.recentIds);
    }
  }

  hasStrongKeyword(lineText) {
    const cleanText = (lineText || "").trim();
    if (!cleanText) return false;
    const tokens = cleanText.split(/\s+/).map((w) => this._cleanWord(w)).filter(Boolean);
    for (const tok of tokens) {
      const cid = KEYWORD_TO_CONSTELLATION[tok];
      if (cid && CONSTELLATIONS[cid] && !this.songVisited.has(cid)) return true;
    }
    for (const [needle, cid] of SUBSTRING_CONSTELLATION_HINTS) {
      if (cleanText.includes(needle) && CONSTELLATIONS[cid] && !this.songVisited.has(cid)) return true;
    }
    return false;
  }

  _cleanWord(w) {
    // Unicode-aware (including combining marks \p{M} for Devanagari/Hindi matras, Arabic, Thai, accents!)
    return (w || "").toLowerCase().replace(/[^\p{L}\p{M}\p{N}']/gu, "");
  }

  detectPalette(text) {
    const low = (text || "").toLowerCase();
    const words = low.split(/\s+/).map((w) => this._cleanWord(w)).filter(Boolean);
    let bestMood = null;
    let bestHits = 0;
    for (const [mood, list] of Object.entries(MOOD_KEYWORDS)) {
      let hits = 0;
      for (const kw of list) {
        if (kw.length <= 2 && /[^\x00-\x7f]/.test(kw)) {
          if (low.includes(kw)) hits++;
        } else if (words.includes(kw)) {
          hits++;
        }
      }
      if (hits > bestHits) {
        bestHits = hits;
        bestMood = mood;
      }
    }
    if (bestMood && PALETTES[bestMood]) {
      this.lastPalette = PALETTES[bestMood];
      return this.lastPalette;
    }
    return null;
  }

  /**
   * Resolve a REAL IAU constellation for a lyric line (works seamlessly in ANY language!).
   * - Normal / comfortable gap (`preferNearby: false`): full 88-constellation freedom across the whole sky!
   * - Quick / tight transition (`preferNearby: true` + `nearbyIds`): prefers a nearby constellation so
   *   fast lyric changes glide swiftly without whipping across the opposite side of the dome!
   */
  resolveForLine(lineText, opts = {}) {
    this.lineCount++;
    const cleanText = (lineText || "").trim();
    const palette = this.detectPalette(cleanText);
    const nearbyIds = Array.isArray(opts.nearbyIds) && opts.nearbyIds.length > 0 ? opts.nearbyIds : null;
    const expandedNearbyIds = Array.isArray(opts.expandedNearbyIds) && opts.expandedNearbyIds.length > 0 ? opts.expandedNearbyIds : null;
    const preferNearby = Boolean(opts.preferNearby && nearbyIds);

    let keywordCid = "";
    if (cleanText) {
      const tokens = cleanText.split(/\s+/).map((w) => this._cleanWord(w)).filter(Boolean);
      for (const tok of tokens) {
        const cid = KEYWORD_TO_CONSTELLATION[tok];
        if (cid && CONSTELLATIONS[cid] && !this.songVisited.has(cid)) {
          keywordCid = cid;
          break;
        }
      }
      // Substring check for spaceless CJK / Hangul poetic lines
      if (!keywordCid) {
        for (const [needle, cid] of SUBSTRING_CONSTELLATION_HINTS) {
          if (cleanText.includes(needle) && CONSTELLATIONS[cid] && !this.songVisited.has(cid)) {
            keywordCid = cid;
            break;
          }
        }
      }
    }

    // 1. Unvisited poetic keyword match wins (respecting nearbyIds if quick-constrained)!
    if (keywordCid && (!preferNearby || nearbyIds.includes(keywordCid))) {
      this._remember(keywordCid);
      return {
        id: keywordCid,
        constellation: CONSTELLATIONS[keywordCid],
        isIconic: true,
      };
    }

    // 2. Quick-switch mode: pick an UNVISITED nearby constellation (preserving its own vivid palette unless mood matched!)
    if (preferNearby) {
      const freshNear = nearbyIds.filter((id) => CONSTELLATIONS[id] && !this.songVisited.has(id));
      const freshExpanded = (!freshNear.length && expandedNearbyIds)
        ? expandedNearbyIds.filter((id) => CONSTELLATIONS[id] && !this.songVisited.has(id))
        : [];
      const pool = freshNear.length > 0 ? freshNear : freshExpanded;
      if (pool.length > 0) {
        const h = hashString(`${cleanText.toLowerCase()}#${this.lineCount}`);
        const pickId = pool[h % pool.length];
        this._remember(pickId);
        const baseConst = CONSTELLATIONS[pickId];
        return {
          id: pickId,
          constellation: palette ? { ...baseConst, palette } : baseConst,
          isIconic: Boolean(keywordCid),
        };
      }
    }

    // 3. Full-sky mode: ALWAYS pick an UNVISITED constellation (keeping its own rich color palette!)
    const unvisited = CONSTELLATION_KEYS.filter((id) => !this.songVisited.has(id));
    const pool = unvisited.length > 0
      ? unvisited
      : CONSTELLATION_KEYS.filter((id) => id !== this.lastConstellationId);
    const h = hashString(`${cleanText.toLowerCase()}#${this.lineCount}`);
    const pickId = pool[h % pool.length];
    this._remember(pickId);
    const baseConst = CONSTELLATIONS[pickId];
    return {
      id: pickId,
      constellation: palette ? { ...baseConst, palette } : baseConst,
      isIconic: true,
    };
  }

  /**
   * Optional mid-line constellation morph when a strong unvisited keyword appears.
   */
  resolveForWord(word, nowSec) {
    const cw = this._cleanWord(word);
    if (!cw || cw.length < 1) return null;
    let cid = KEYWORD_TO_CONSTELLATION[cw];
    if (!cid) {
      for (const [needle, cand] of SUBSTRING_CONSTELLATION_HINTS) {
        if (cw.includes(needle)) {
          cid = cand;
          break;
        }
      }
    }
    if (!cid || !CONSTELLATIONS[cid] || this.songVisited.has(cid)) return null;
    if (nowSec - this.lastMorphTime < 1.5) return null;

    this._remember(cid);
    this.lastMorphTime = nowSec;
    return {
      id: cid,
      constellation: CONSTELLATIONS[cid],
      isIconic: true,
    };
  }

  markMorph(nowSec) {
    this.lastMorphTime = nowSec;
  }
}
