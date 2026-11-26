/**
 * Astralis Main Application Orchestrator.
 *
 * Features:
 *  - Individual stars glow along with the music (per-star audio frequency bands)
 *  - Active lyric words appear right beside the currently glowing star, with a
 *    luminous star-to-star transition beam gliding between consecutive stars
 *  - Smooth curved-orbital constellation morph transitions after each phrase
 *  - Darker velvet midnight ambience (customizable in Settings)
 *  - Visual Constellations Gallery (all 28 SVG star-maps) + full Settings Menu
 */

import { StarPhysics } from "./star_physics.js";
import { HemisphereEngine } from "./hemisphere_engine.js";
import { WebGLConstellationEngine } from "./webgl_engine.js";
import { CONSTELLATIONS, CONSTELLATION_KEYS, PALETTES } from "./constellations.js";
import { getConstellationFunFact } from "./astronomy_facts.js";
import { LyricMapper } from "./lyric_mapper.js";

const STORAGE_KEY = "astralis_settings_v2";

const canvas = document.getElementById("sky-canvas");
const morphPhysics = new StarPhysics();
const hemiPhysics = new HemisphereEngine();
let physics = morphPhysics; // Active simulation engine (switches cleanly between Morph & Hemisphere!)
const engine = new WebGLConstellationEngine(canvas);
const mapper = new LyricMapper();

// DOM references
const elHoverRing = document.getElementById("hover-ring");
const elSkyTooltip = document.getElementById("sky-tooltip");
const elTipName = document.getElementById("tip-name");
const elTipDesig = document.getElementById("tip-desig");
const elTipConst = document.getElementById("tip-const");
const elTipSub = document.getElementById("tip-sub");
const elTipFact = document.getElementById("tip-fact");
const elTrackingPill = document.getElementById("tracking-pill");
const elTrackingLabel = document.getElementById("tracking-label");
const elBtnTrackingRelease = document.getElementById("btn-tracking-release");
const elSkyLabelsLayer = document.getElementById("sky-labels-layer");
const elStarLabelsLayer = document.getElementById("star-labels-layer");
const elStarLyricLayer = document.getElementById("star-lyric-layer");
const elSourceBadge = document.getElementById("source-badge");
const elTrackTitle = document.getElementById("track-title");
const elTrackArtist = document.getElementById("track-artist");
const elHudClock = document.getElementById("hud-clock");
const elLyricsPill = document.getElementById("lyrics-pill");
const elConstellationTag = document.getElementById("constellation-tag");
const elConstellationFact = document.getElementById("constellation-fact");
const elLyricCurrent = document.getElementById("lyric-current");
const elLyricNext = document.getElementById("lyric-next");
const elOffsetLabel = document.getElementById("offset-label");
const elLocalBar = document.getElementById("local-bar");
const elSeekSlider = document.getElementById("seek-slider");
const elTimeLabel = document.getElementById("time-label");
const elDurLabel = document.getElementById("dur-label");
const elBtnPrev = document.getElementById("btn-prev");
const elBtnPlayPause = document.getElementById("btn-playpause");
const elBtnNext = document.getElementById("btn-next");
const elBtnBackLive = document.getElementById("btn-back-live");
const elBtnPlayerMin = document.getElementById("btn-player-min");
const elBtnPlayerRestore = document.getElementById("btn-player-restore");
const elBtnView = document.getElementById("btn-view");
const elRngLead = document.getElementById("rng-lead");
const elValLead = document.getElementById("val-lead");

// Menu & Settings DOM
const elMainMenu = document.getElementById("main-menu");
const elTabConstellations = document.getElementById("tab-constellations");
const elTabObjects = document.getElementById("tab-objects");
const elTabSettings = document.getElementById("tab-settings");
const elPanelConstellations = document.getElementById("panel-constellations");
const elPanelObjects = document.getElementById("panel-objects");
const elPanelSettings = document.getElementById("panel-settings");
const elAtlasGrid = document.getElementById("atlas-grid");
const elLiveObjectsList = document.getElementById("live-objects-list");
const elObjectSearch = document.getElementById("object-search");
const elWordSandbox = document.getElementById("word-sandbox");
const elChkLock = document.getElementById("chk-lock-constellation");
const elRngAmbience = document.getElementById("rng-ambience");
const elValAmbience = document.getElementById("val-ambience");
const elRngStarGlow = document.getElementById("rng-starglow");
const elValStarGlow = document.getElementById("val-starglow");
const elRngSpeed = document.getElementById("rng-speed");
const elValSpeed = document.getElementById("val-speed");
const elRngFontSize = document.getElementById("rng-fontsize");
const elValFontSize = document.getElementById("val-fontsize");
const elRngOffset = document.getElementById("rng-offset");
const elOffsetLiveClock = document.getElementById("offset-live-clock");
const elSyncLinesList = document.getElementById("sync-lines-list");
const elPaletteGrid = document.getElementById("palette-grid");
const elFontGrid = document.getElementById("font-grid");
const elChkDeepSky = document.getElementById("chk-deep-sky");
const elChkPlanetsSats = document.getElementById("chk-planets-sats");
const elChkEcliptic = document.getElementById("chk-ecliptic");
const elChkSkyLabels = document.getElementById("chk-sky-labels");
const elChkStarLabels = document.getElementById("chk-star-labels");
const elChkConstFacts = document.getElementById("chk-const-facts");
const elChkAudioReactive = document.getElementById("chk-audio-reactive");
const elChkShowTag = document.getElementById("chk-show-tag");
const elSelLyricsProvider = document.getElementById("sel-lyrics-provider");
const elPerfReadout = document.getElementById("perf-readout");
const elDropOverlay = document.getElementById("drop-overlay");
const elFileInput = document.getElementById("file-input");
const elAudio = document.getElementById("local-audio");

// Persistent User Settings
const UNICODE_FONT_FALLBACK = ', "Yu Gothic UI", "Malgun Gothic", "Microsoft YaHei UI", "Nirmala UI", "Segoe UI", sans-serif';

const LYRIC_FONTS = {
  sans: {
    label: "Celestial Sans",
    sample: "Starlight",
    family: '"Segoe UI Variable Display", "Segoe UI", system-ui' + UNICODE_FONT_FALLBACK,
    style: "normal",
    weight: "300",
    tracking: "0.08em",
    transform: "none",
    scaleMul: 1.0,
  },
  serif: {
    label: "Editorial Serif",
    sample: "Starlight",
    family: '"Georgia", "Palatino Linotype", "Book Antiqua", "Yu Mincho", "Batang", serif',
    style: "normal",
    weight: "400",
    tracking: "0.04em",
    transform: "none",
    scaleMul: 1.0,
  },
  italic: {
    label: "Astral Italic",
    sample: "Starlight",
    family: '"Palatino Linotype", "Georgia", "Yu Mincho", serif',
    style: "italic",
    weight: "400",
    tracking: "0.05em",
    transform: "none",
    scaleMul: 1.04,
  },
  script: {
    label: "Starlight Script",
    sample: "Starlight",
    family: '"Gabriola", "Segoe Script", "Brush Script MT", "Yu Mincho", cursive',
    style: "normal",
    weight: "400",
    tracking: "0.03em",
    transform: "none",
    scaleMul: 1.32,
  },
  mono: {
    label: "Observatory Mono",
    sample: "Starlight",
    family: '"Cascadia Mono", "Consolas", "Courier New", monospace' + UNICODE_FONT_FALLBACK,
    style: "normal",
    weight: "300",
    tracking: "0.06em",
    transform: "none",
    scaleMul: 0.94,
  },
  caps: {
    label: "Geometric Caps",
    sample: "STARLIGHT",
    family: '"Bahnschrift", "Calibri"' + UNICODE_FONT_FALLBACK,
    style: "normal",
    weight: "300",
    tracking: "0.18em",
    transform: "uppercase",
    scaleMul: 0.92,
  },
};

const defaultSettings = {
  visualMode: "morph",   // "morph" | "hemisphere"
  ambience: 45,          // 0..120 (45% = deep velvet dark midnight)
  starGlow: 115,         // 0..180 (per-star music glow intensity)
  speed: 100,            // 50..250 (transition speed %)
  fontSize: 100,         // 60..180 (lyric font scale %)
  lyricFont: "sans",     // key in LYRIC_FONTS
  lyricMode: "star",     // "star" | "both" | "bottom" | "off"
  switchMode: "phrase",  // "phrase" | "song" | "keyword" | "locked"
  paletteOverride: "auto",
  perfProfile: "adaptive",
  audioReactive: true,
  showDeepSky: true,
  showPlanetsAndSats: true,
  showEcliptic: true,
  showSkyLabels: true,
  showStarLabels: true,
  showConstFacts: true,
  showTag: true,
  playerMinimized: false, // Allows collapsing the music control bar into a tiny pill!
  lyricsProvider: "auto", // "auto" | "boidu" | "lrclib"
  autoLeadV2: true,       // Uses smart per-player recommended_lead_ms so browserLeadMs stays 0 fine-trim!
  browserLeadMs: 0,       // Extra fine sync trim on top of automatic per-app detection
  offsetMs: 0,
  trackOffsets: {},       // Per-track saved sync offsets keyed by track_key
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = { ...defaultSettings, ...parsed };
      // One-time migration: reset legacy global 300/400ms browser lead now that backend auto-detects per-app lead!
      if (!parsed.autoLeadV2) {
        merged.browserLeadMs = 0;
        merged.autoLeadV2 = true;
      }
      return merged;
    }
  } catch {}
  return { ...defaultSettings };
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

const settings = loadSettings();

// App runtime state
const state = {
  sourceMode: "viewing", // "viewing" | "system" | "local"
  windowMode: "borderless",
  isFocused: true,
  isMinimized: false,
  currentConstellationId: "orion",

  // Active lyrics & clock
  lines: [],
  activeLineIdx: -1,
  activeWordIdx: -1,
  preGlidedLineIdx: -1,
  lastConstellationSwitchMs: -999999,
  lastWordShownMs: -999999,
  activeStarSlot: null,
  activeWordClusterCount: 0,

  // System media mirror
  sysPlaying: false,
  sysRate: 1.0,
  sysPosMs: 0,
  sysDurMs: 0,
  sysAutoLeadMs: 80,
  sysCmdLockUntil: 0,
  sysSnapTime: performance.now(),
  sysTrackKey: "",
  sysLyricsKey: "",

  // Viewing Mode (Observatory Pattern Explorer — replaces Demo!)
  userPinnedViewing: false,

  // Live audio metrics
  audio: { sub: 0, bass: 0, mid: 0, high: 0, energy: 0, beat: 0, kick: 0, snare: 0, beat_seq: 0, beat_kind: 0, active: 0 },
  localAudioCtx: null,
  localAnalyser: null,
  localFreqBins: null,
  localPrevBass: 0,
  localPrevSnare: 0,
  localLastBeatMs: 0,
  noLyricsMorphTimer: 0,
  instrumentalHopCooldown: 0,
  instrumentalLastBeatSeq: 0,
  instrumentalBeatCount: 0,
  instrumentalMorphTimer: 0,
  inInstrumentalBreak: false,
  isSeekingSlider: false,
};

const API_AVAILABLE =
  (window.location.protocol === "http:" || window.location.protocol === "https:") &&
  (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost");
if (!API_AVAILABLE) {
  document.body.classList.add("web-preview");
}

async function apiGet(path) {
  if (!API_AVAILABLE) return null;
  const resp = await fetch(path, { cache: "no-store" });
  if (!resp.ok) return null;
  return resp.json();
}

async function apiPost(path, payload = {}) {
  if (!API_AVAILABLE) return null;
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!resp.ok) return null;
  return resp.json();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// Pooled 3D Astronomical Constellation Name Labels (Zero-Reflow Overlay!)
// ---------------------------------------------------------------------------
const MAX_SKY_LABELS = 52;
const skyLabelPool = [];
if (elSkyLabelsLayer) {
  for (let i = 0; i < MAX_SKY_LABELS; i++) {
    const el = document.createElement("div");
    el.className = "sky-const-label";
    el.innerHTML = `<span class="sky-const-name"></span><span class="sky-const-sub"></span>`;
    elSkyLabelsLayer.appendChild(el);
    skyLabelPool.push({
      el,
      nameEl: el.querySelector(".sky-const-name"),
      subEl: el.querySelector(".sky-const-sub"),
      lastCid: "",
      lastSub: "",
      lastFocused: false,
      visible: false,
    });
  }
}

function updateSkyConstellationLabels() {
  if (!elSkyLabelsLayer) return;
  const show = settings.showSkyLabels !== false;
  const labels = show ? (physics.constellationLabels || []) : [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = engine.aspect || (vw / Math.max(1, vh));
  const n = Math.min(labels.length, MAX_SKY_LABELS);

  for (let i = 0; i < n; i++) {
    const lb = labels[i];
    const slot = skyLabelPool[i];
    const px = ((lb.x / aspect) * 0.5 + 0.5) * vw;
    const py = (0.5 - lb.y * 0.5) * vh;

    // Keep labels cleanly inside the viewport margins (avoid overlapping top HUD / bottom tag)
    if (px < 36 || px > vw - 36 || py < 66 || py > vh - 58 || lb.alpha <= 0.03) {
      if (slot.visible) {
        slot.el.style.opacity = "0";
        slot.visible = false;
      }
      continue;
    }

    if (slot.lastCid !== lb.cid) {
      slot.lastCid = lb.cid;
      slot.nameEl.textContent = lb.name;
    }
    const subTxt = lb.sub || "";
    if (slot.lastSub !== subTxt) {
      slot.lastSub = subTxt;
      slot.subEl.textContent = subTxt;
      slot.subEl.style.display = subTxt ? "" : "none";
    }
    if (slot.lastFocused !== lb.isFocused) {
      slot.lastFocused = lb.isFocused;
      slot.el.classList.toggle("is-focused", lb.isFocused);
    }

    slot.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
    slot.el.style.opacity = lb.alpha.toFixed(2);
    slot.visible = true;
  }

  for (let i = n; i < MAX_SKY_LABELS; i++) {
    const slot = skyLabelPool[i];
    if (slot.visible) {
      slot.el.style.opacity = "0";
      slot.visible = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Pooled Toggleable Bright Star Name Labels (Collision-Free, Zero-Reflow!)
// ---------------------------------------------------------------------------
const MAX_STAR_LABELS = 24;
const starLabelPool = [];
if (elStarLabelsLayer) {
  for (let i = 0; i < MAX_STAR_LABELS; i++) {
    const el = document.createElement("div");
    el.className = "sky-star-label";
    elStarLabelsLayer.appendChild(el);
    starLabelPool.push({
      el,
      lastId: "",
      lastFocused: false,
      visible: false,
    });
  }
}

const _placedStarLblX = new Float32Array(MAX_STAR_LABELS);
const _placedStarLblY = new Float32Array(MAX_STAR_LABELS);

function updateSkyStarLabels() {
  if (!elStarLabelsLayer) return;
  const show = settings.showStarLabels !== false;
  const labels = show ? (physics.starNameLabels || []) : [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = engine.aspect || (vw / Math.max(1, vh));

  let placed = 0;
  for (let i = 0; i < labels.length && placed < MAX_STAR_LABELS; i++) {
    const lb = labels[i];
    if (lb.alpha <= 0.05) continue;
    const px = ((lb.x / aspect) * 0.5 + 0.5) * vw + 9;
    const py = (0.5 - lb.y * 0.5) * vh - 11;
    if (px < 24 || px > vw - 84 || py < 62 || py > vh - 68) continue;

    // Collision avoidance so nearby star names never overlap!
    let overlaps = false;
    for (let k = 0; k < placed; k++) {
      if (Math.abs(px - _placedStarLblX[k]) < 68 && Math.abs(py - _placedStarLblY[k]) < 16) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    const slot = starLabelPool[placed];
    if (slot.lastId !== lb.id) {
      slot.lastId = lb.id;
      slot.el.textContent = lb.name;
    }
    if (slot.lastFocused !== lb.isFocused) {
      slot.lastFocused = lb.isFocused;
      slot.el.classList.toggle("is-focused", lb.isFocused);
    }
    slot.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    slot.el.style.opacity = lb.alpha.toFixed(2);
    slot.visible = true;
    _placedStarLblX[placed] = px;
    _placedStarLblY[placed] = py;
    placed++;
  }

  for (let i = placed; i < MAX_STAR_LABELS; i++) {
    const slot = starLabelPool[i];
    if (slot.visible) {
      slot.el.style.opacity = "0";
      slot.visible = false;
    }
  }
}

let _lastFactCid = "";
function updateConstellationFactDisplay(cid) {
  if (!elConstellationFact) return;
  const show = settings.showConstFacts !== false;
  if (!show || !cid) {
    elConstellationFact.classList.add("hidden");
    return;
  }
  const fact = getConstellationFunFact(cid);
  if (!fact) {
    elConstellationFact.classList.add("hidden");
    return;
  }
  if (_lastFactCid !== cid) {
    _lastFactCid = cid;
    elConstellationFact.textContent = fact;
  }
  elConstellationFact.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Star-Adjacent Floating Word Labels (Positioned beside each glowing star!)
// ---------------------------------------------------------------------------
const MAX_STAR_WORDS = 4;
const starWordPool = [];

for (let i = 0; i < MAX_STAR_WORDS; i++) {
  const el = document.createElement("div");
  el.className = "star-word-tag";
  el.innerHTML = `<span class="star-word-tick"></span><span class="star-word-text"></span>`;
  elStarLyricLayer.appendChild(el);
  starWordPool.push({
    el,
    textEl: el.querySelector(".star-word-text"),
    starIdx: -1,
    active: false,
    isCurrent: false,
    bornAt: 0,
    side: "right",
    w: 120,
    h: 28,
  });
}

let starWordCursor = 0;

function clearStarWords() {
  for (const slot of starWordPool) {
    slot.active = false;
    slot.isCurrent = false;
    slot.starIdx = -1;
    slot.el.className = "star-word-tag";
  }
  state.activeStarSlot = null;
  state.activeWordClusterCount = 0;
}

function softFadeStarWords() {
  const now = physics.time;
  for (const slot of starWordPool) {
    if (!slot.active) continue;
    if (slot.isCurrent) {
      slot.isCurrent = false;
      slot.el.classList.remove("is-active");
      slot.el.classList.add("is-echo");
      // Fade cleanly over ~0.6s instead of hard-wiping the final word of a line!
      slot.bornAt = Math.min(slot.bornAt, now - 1.40);
    } else {
      slot.bornAt = Math.min(slot.bornAt, now - 1.65);
    }
  }
  state.activeStarSlot = null;
  state.activeWordClusterCount = 0;
}

function showWordNextToStar(word, starIdx) {
  if (settings.lyricMode !== "star" && settings.lyricMode !== "both") return;
  if (!word || starIdx < 0) return;

  for (const slot of starWordPool) {
    if (slot.isCurrent) {
      slot.isCurrent = false;
      slot.el.classList.remove("is-active");
      slot.el.classList.add("is-echo");
    }
    if (slot.active && slot.starIdx === starIdx) {
      slot.active = false;
      slot.el.className = "star-word-tag";
    }
  }

  const slot = starWordPool[starWordCursor % MAX_STAR_WORDS];
  starWordCursor++;

  const aspect = engine.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
  const pos = physics.getLyricAnchorPosition
    ? physics.getLyricAnchorPosition(starIdx, aspect)
    : physics.getStarPosition(starIdx);
  const side = pos && pos.x < -0.05 ? "left" : "right";

  slot.starIdx = starIdx;
  slot.active = true;
  slot.isCurrent = true;
  slot.bornAt = physics.time;
  slot.side = side;
  slot.textEl.textContent = word;
  slot.el.className = `star-word-tag side-${side} is-active`;
  // Measure ONCE on word change (ZERO layout reflow inside requestAnimationFrame!)
  slot.w = slot.el.offsetWidth || 120;
  slot.h = slot.el.offsetHeight || 28;
  state.activeStarSlot = slot;
}

function updateStarWordPositions() {
  const showStarWords = settings.lyricMode === "star" || settings.lyricMode === "both";
  if (!showStarWords) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = engine.aspect || (vw / Math.max(1, vh));
  const now = physics.time;

  for (const slot of starWordPool) {
    if (!slot.active || slot.starIdx < 0) continue;

    const age = now - slot.bornAt;
    if (!slot.isCurrent && age > 2.0) {
      slot.active = false;
      slot.el.className = "star-word-tag";
      continue;
    }

    // Active word uses zero-drop anchor so it NEVER goes invisible while the dome is turning!
    // Past echo words hide cleanly once their old star rotates behind the horizon.
    const pos = slot.isCurrent && physics.getLyricAnchorPosition
      ? physics.getLyricAnchorPosition(slot.starIdx, aspect)
      : physics.getStarPosition(slot.starIdx);
    if (!pos) {
      slot.el.style.opacity = "0";
      continue;
    }
    slot.el.style.opacity = "";

    const sx = pos.x;
    const sy = pos.y;
    const px = ((sx / aspect) * 0.5 + 0.5) * vw;
    const py = (0.5 - sy * 0.5) * vh;

    const tagW = slot.w;
    const tagH = slot.h;
    const gap = 16;

    let tx = slot.side === "right" ? (px + gap) : (px - tagW - gap);
    let ty = py - tagH * 0.5;

    const padX = 24;
    const padTop = 74;
    const padBot = 52;
    tx = Math.max(padX, Math.min(vw - tagW - padX, tx));
    ty = Math.max(padTop, Math.min(vh - tagH - padBot, ty));

    slot.el.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
  }
}

// ---------------------------------------------------------------------------
// Constellation Morph & Lyric Stage Rendering
// ---------------------------------------------------------------------------
function getActivePalette(defaultPal) {
  if (settings.paletteOverride !== "auto" && PALETTES[settings.paletteOverride]) {
    return PALETTES[settings.paletteOverride];
  }
  return defaultPal;
}

function applyConstellation(constellation, id = "", opts = {}) {
  const pal = getActivePalette(constellation.palette);
  const targetId = id || state.currentConstellationId || "orion";
  if (settings.visualMode === "hemisphere") {
    hemiPhysics.focusConstellation(targetId, { ...opts, keepPalette: settings.paletteOverride !== "auto" });
    if (pal) hemiPhysics.setPalette(pal);
  } else {
    morphPhysics.morphTo({ ...constellation, palette: pal }, opts);
  }
  mapper.markMorph(physics.time);
  if (targetId) {
    state.currentConstellationId = targetId;
    highlightActiveAtlasCard();
  }
  if (constellation.title) {
    elConstellationTag.textContent = `✦ ${constellation.title}`;
  }
  updateConstellationFactDisplay(targetId);
}

function setVisualMode(mode, opts = {}) {
  const target = mode === "hemisphere" ? "hemisphere" : "morph";
  settings.visualMode = target;
  physics = target === "hemisphere" ? hemiPhysics : morphPhysics;

  document.body.classList.toggle("mode-hemisphere", target === "hemisphere");
  hideSkyTooltip();
  if (target !== "hemisphere") {
    hemiPhysics.trackedTarget = null;
    updateTrackingPill();
  }
  document.querySelectorAll("[data-vismode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vismode === target);
  });

  clearStarWords();
  if (!opts.skipFocus) {
    const cid = CONSTELLATIONS[state.currentConstellationId] ? state.currentConstellationId : "orion";
    applyConstellation(CONSTELLATIONS[cid], cid, { speedScale: 1.0, meteor: true });
  }
  applySettingsToEngine();
  saveSettings();
}

function focusConstellationForSong(songTitle, songArtist) {
  mapper.resetForNewSong();
  if (settings.switchMode === "locked") return;
  const seed = `${songTitle || ""} ${songArtist || ""}`.trim();
  const res = mapper.resolveForLine(seed || "orion");
  applyConstellation(res.constellation, res.id, { speedScale: 0.95, meteor: true });
}

function renderBottomLyricLine(lineObj, nextLineObj, activeWordIdx) {
  const showBottom = settings.lyricMode === "bottom" || settings.lyricMode === "both";
  elLyricCurrent.classList.toggle("hidden", !showBottom);
  elLyricNext.classList.toggle("hidden", !showBottom);
  if (!showBottom) return;

  if (!lineObj || lineObj.instrumental || !lineObj.text) {
    elLyricCurrent.innerHTML = "";
    elLyricNext.textContent = nextLineObj && nextLineObj.text ? nextLineObj.text : "";
    return;
  }

  const words = lineObj.words && lineObj.words.length > 0
    ? lineObj.words
    : lineObj.text.split(/\s+/).map((w) => ({ word: w }));

  const lineKey = `${lineObj.start_ms}:${lineObj.text}`;
  if (elLyricCurrent.dataset.lineKey !== lineKey) {
    elLyricCurrent.dataset.lineKey = lineKey;
    elLyricCurrent.innerHTML = words
      .map((w, idx) => `<span class="lyric-word" data-w="${idx}">${escapeHtml(w.word)}</span>`)
      .join(" ");
  }

  const spans = elLyricCurrent.children;
  for (let i = 0; i < spans.length; i++) {
    const cls = i < activeWordIdx ? "lyric-word past"
      : i === activeWordIdx ? "lyric-word active"
      : "lyric-word";
    if (spans[i].className !== cls) spans[i].className = cls;
  }

  elLyricNext.textContent = nextLineObj && nextLineObj.text ? nextLineObj.text : "";
}

function getEffectiveOffsetMs() {
  const autoLead = state.sourceMode === "system" ? (state.sysAutoLeadMs || 0) : 0;
  const fineTrim = state.sourceMode === "system" ? (settings.browserLeadMs || 0) : 0;
  return (settings.offsetMs || 0) + autoLead + fineTrim;
}

/**
 * Tempo-adaptive constellation selector:
 * - Comfortable gap / lookahead (`preferNearby = false`): full 88-constellation freedom across the whole sky!
 * - Quick / tight switch (`preferNearby = true`): glides smoothly to a nearby constellation in Dome Mode
 *   (or a crisp fast morph in Morph Mode) so it arrives right on beat without missing lyrics!
 */
function pickConstellationAdaptive(lineText, { preferNearby = false, arrivalSec = 0.9 } = {}) {
  const isHemi = settings.visualMode === "hemisphere";
  const nearbyIds = (isHemi && preferNearby)
    ? hemiPhysics.getNearbyConstellations(state.currentConstellationId, 16, 68)
    : null;
  const expandedNearbyIds = (isHemi && preferNearby)
    ? hemiPhysics.getNearbyConstellations(state.currentConstellationId, 68, 115)
    : null;
  const res = mapper.resolveForLine(lineText, {
    preferNearby: Boolean(preferNearby && isHemi),
    nearbyIds,
    expandedNearbyIds,
  });
  const switched = res.id !== state.currentConstellationId;
  const speedScale = preferNearby ? 1.24 : 1.0;
  applyConstellation(res.constellation, res.id, {
    speedScale,
    arrivalSec,
    meteor: res.isIconic && !preferNearby,
  });
  return { res, switched };
}

function shouldSwitchConstellationForLine(lineText, sinceLastSwitchMs, gapMs) {
  if (sinceLastSwitchMs < 0) return true; // Fresh song / seek
  if (gapMs >= 1450) return true;         // Clear musical breath/pause -> always welcome a fresh constellation!
  if (mapper.hasStrongKeyword(lineText) && sinceLastSwitchMs >= 2600) return true;
  return sinceLastSwitchMs >= 4200;       // Give constellations natural breathing room on rapid-fire lines!
}

function getLineSpokenEndMs(line, nextLine) {
  const hardEnd = nextLine ? nextLine.start_ms : (line.end_ms || line.start_ms + 3200);
  const words = line.words || [];
  if (words.length > 0) {
    const lastW = words[words.length - 1];
    const wEnd = lastW.end_ms || (lastW.start_ms + 450);
    return Math.min(hardEnd, wEnd);
  }
  return Math.min(hardEnd, line.end_ms || hardEnd);
}

function updateLyricsAtTime(posMs) {
  const lines = state.lines;
  if (!lines || lines.length === 0) return;

  const tMs = Math.max(0, posMs + getEffectiveOffsetMs());
  const isPlayingNow =
    (state.sourceMode === "local" && !elAudio.paused) ||
    (state.sourceMode === "system" && state.sysPlaying);

  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].start_ms <= tMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (found < 0) {
    if (state.activeLineIdx !== -1) {
      state.activeLineIdx = -1;
      state.activeWordIdx = -1;
      state.preGlidedLineIdx = -1;
      clearStarWords();
      renderBottomLyricLine(null, lines[0], -1);
    }
    return;
  }

  const line = lines[found];
  const nextLine = found + 1 < lines.length ? lines[found + 1] : null;
  const shouldSwitchMode =
    settings.switchMode === "phrase" || settings.switchMode === "keyword";

  let wordIdx = -1;
  const words = line.words || [];
  for (let i = 0; i < words.length; i++) {
    if (tMs >= words[i].start_ms) wordIdx = i;
    else break;
  }

  // 1. Phrase / Line changed -> land cleanly on the new line (using pre-glided constellation if ready!)
  if (found !== state.activeLineIdx) {
    const prevLineIdx = state.activeLineIdx;
    const isSequential = prevLineIdx >= 0 && found === prevLineIdx + 1;
    const prevLine = isSequential ? lines[prevLineIdx] : null;
    const gapMs = prevLine ? Math.max(0, line.start_ms - getLineSpokenEndMs(prevLine, line)) : 1200;

    state.activeLineIdx = found;
    state.activeWordIdx = wordIdx;
    if (isSequential) softFadeStarWords();
    else clearStarWords();

    let switchedConstellation = false;
    if (shouldSwitchMode && !line.instrumental) {
      if (state.preGlidedLineIdx === found) {
        // Already pre-glided ahead of the beat — constellation is right in front of us!
        switchedConstellation = true;
      } else {
        const sinceLast = isSequential ? (tMs - state.lastConstellationSwitchMs) : -1;
        if (shouldSwitchConstellationForLine(line.text, sinceLast, gapMs)) {
          const needQuick = isSequential && gapMs < 750;
          const arrivalSec = needQuick ? 0.50 : 0.88;
          const { switched } = pickConstellationAdaptive(line.text, { preferNearby: needQuick, arrivalSec });
          switchedConstellation = switched;
          state.lastConstellationSwitchMs = tMs;
          state.preGlidedLineIdx = found;
        }
      }
    }

    if (wordIdx >= 0 && words[wordIdx]) {
      const text = words[wordIdx].word;
      const starIdx = physics.advanceWordStar(text, 1.05, switchedConstellation);
      showWordNextToStar(text, starIdx);
      state.lastWordShownMs = tMs;
    }
    renderBottomLyricLine(line, nextLine, wordIdx);
    return;
  }

  // 2. Word changed within the current phrase -> crisp 1-word-per-star spotlight glide right on the beat!
  if (wordIdx !== state.activeWordIdx && wordIdx >= 0 && words[wordIdx]) {
    state.activeWordIdx = wordIdx;
    const wObj = words[wordIdx];

    let morphedMidLine = false;
    if (settings.switchMode === "keyword" && (tMs - state.lastConstellationSwitchMs) >= 3200) {
      const midLineMorph = mapper.resolveForWord(wObj.clean || wObj.word, physics.time);
      if (midLineMorph) {
        applyConstellation(midLineMorph.constellation, midLineMorph.id, { speedScale: 1.2, arrivalSec: 0.6 });
        state.lastConstellationSwitchMs = tMs;
        morphedMidLine = true;
      }
    }

    const starIdx = physics.advanceWordStar(wObj.word, 1.05, morphedMidLine);
    showWordNextToStar(wObj.word, starIdx);
    state.lastWordShownMs = tMs;
    renderBottomLyricLine(line, nextLine, wordIdx);
  }

  // 3. Lookahead Pre-Glide: begin turning/morphing BEFORE the next line starts so we arrive ON beat 1!
  if (isPlayingNow && shouldSwitchMode && nextLine && !nextLine.instrumental && state.preGlidedLineIdx !== found + 1) {
    const msUntilNext = nextLine.start_ms - tMs;
    if (msUntilNext > 40 && msUntilNext <= 960) {
      const spokenEndMs = getLineSpokenEndMs(line, nextLine);
      const gapMs = Math.max(0, nextLine.start_ms - spokenEndMs);
      const sinceLast = nextLine.start_ms - state.lastConstellationSwitchMs;

      if (shouldSwitchConstellationForLine(nextLine.text, sinceLast, gapMs)) {
        // Choose lookahead lead based on available musical breath:
        // - Big/normal breath (>=950ms): start gliding ~850ms early with FULL 88-constellation freedom!
        // - Medium breath (420..950ms): start gliding right after current line finishes speaking!
        // - Tight back-to-back (<420ms): start a quick nearby glide ~220ms before beat 1!
        const leadMs = gapMs >= 950
          ? 850
          : (gapMs >= 420 ? Math.min(gapMs * 0.88, 700) : 220);

        if (msUntilNext <= leadMs) {
          const preferNearby = gapMs < 720;
          const arrivalSec = Math.max(0.42, Math.min(0.95, (msUntilNext + 80) / 1000));
          pickConstellationAdaptive(nextLine.text, { preferNearby, arrivalSec });
          state.preGlidedLineIdx = found + 1;
          state.lastConstellationSwitchMs = nextLine.start_ms;
        }
      }
    }
  }
}

/**
 * Keeps constellations alive during instrumental songs, long musical intros,
 * guitar solos, drops, and instrumental bridges between lyric lines!
 * - Hops spotlight stars smoothly to the music (gentle on calm music, brisk on rock beats).
 * - Occasionally glides to a fresh unvisited constellation every ~7.5s when vocals are resting.
 */
function stepInstrumentalReactivity(dt, posMs) {
  const lines = state.lines || [];
  const tMs = Math.max(0, posMs + getEffectiveOffsetMs());

  let isInstrumentalNow = false;
  let msUntilNextVocals = Infinity;

  if (lines.length === 0) {
    isInstrumentalNow = true;
  } else {
    const idx = state.activeLineIdx;
    if (idx < 0) {
      // Musical intro before line 0
      msUntilNextVocals = Math.max(0, lines[0].start_ms - tMs);
      isInstrumentalNow = msUntilNextVocals > 1800;
    } else {
      const cur = lines[idx];
      const nxt = idx + 1 < lines.length ? lines[idx + 1] : null;
      if (nxt) msUntilNextVocals = Math.max(0, nxt.start_ms - tMs);
      if (cur && cur.instrumental) {
        isInstrumentalNow = msUntilNextVocals > 1500;
      } else if (cur) {
        const spokenEnd = getLineSpokenEndMs(cur, nxt);
        // Active instrumental break / solo between lines (or outro after the final line)
        isInstrumentalNow = (tMs > spokenEnd + 1650) && (msUntilNextVocals > 1800);
      }
    }
  }

  if (!isInstrumentalNow) {
    state.inInstrumentalBreak = false;
    state.instrumentalMorphTimer = 0;
    state.instrumentalHopCooldown = 0;
    return;
  }

  if (!state.inInstrumentalBreak) {
    state.inInstrumentalBreak = true;
    state.instrumentalMorphTimer = 0;
    state.instrumentalHopCooldown = 0.35;
    if (lines.length > 0) softFadeStarWords();
  }

  const beat = state.audio.beat || 0;
  const energy = state.audio.energy || 0;
  const beatSeq = state.audio.beat_seq || 0;
  const intensity = physics.songIntensity || 0;

  // 1. Deterministic BEAT-LOCKED star dancing (zero randomness — locked 1:1 to real kicks & snares!)
  state.instrumentalHopCooldown -= dt;
  const activeSound = energy > 0.03 || beat > 0.20;
  const gotRealBeat = beatSeq > 0 && beatSeq !== state.instrumentalLastBeatSeq;
  if (gotRealBeat) {
    state.instrumentalLastBeatSeq = beatSeq;
    state.instrumentalBeatCount++;
    if (state.instrumentalHopCooldown <= 0) {
      physics.advanceWordStar("", 1.0 + beat * 0.35, false);
      // Lock cleanly to the main pulse (allows crisp 110-145 BPM 1:1 beat-locked hopping!)
      state.instrumentalHopCooldown = 0.21;
    }
  } else if (activeSound && state.instrumentalHopCooldown <= -1.65) {
    // Pure ambient/piano/strings without sharp drum hits -> gentle calm star glide
    physics.advanceWordStar("", 0.72, false);
    state.instrumentalHopCooldown = 0.60;
  }

  // 2. Occasionally voyage to a fresh unvisited constellation on a real downbeat (or ~8.5s on calm ambient)!
  const allowSwitch = settings.switchMode === "phrase" || settings.switchMode === "keyword";
  if (allowSwitch && msUntilNextVocals > 2500) {
    state.instrumentalMorphTimer += dt;
    const hitBeatSwitch = gotRealBeat && state.instrumentalBeatCount >= 16 && state.instrumentalMorphTimer >= 5.5;
    const hitCalmSwitch = state.instrumentalMorphTimer >= 8.5;
    if (hitBeatSwitch || hitCalmSwitch) {
      state.instrumentalMorphTimer = 0;
      state.instrumentalBeatCount = 0;
      pickConstellationAdaptive("instrumental", { preferNearby: false, arrivalSec: 0.95 });
      state.lastConstellationSwitchMs = tMs;
    }
  }
}

function syncPlayerBarVisibility() {
  const inMusic = state.sourceMode === "system" || state.sourceMode === "local";
  if (!inMusic) {
    elLocalBar.classList.add("hidden");
    if (elBtnPlayerRestore) elBtnPlayerRestore.classList.add("hidden");
    return;
  }
  const minimized = Boolean(settings.playerMinimized);
  elLocalBar.classList.toggle("hidden", minimized);
  if (elBtnPlayerRestore) elBtnPlayerRestore.classList.toggle("hidden", !minimized);
}

// ---------------------------------------------------------------------------
// Viewing Mode (Clean Observatory Pattern Mode — replaces Demo!)
// ---------------------------------------------------------------------------
function enterViewingMode(userPinned = false) {
  state.sourceMode = "viewing";
  state.userPinnedViewing = userPinned;
  state.activeLineIdx = -1;
  state.activeWordIdx = -1;
  hemiPhysics.viewingMode = true;

  clearStarWords();
  renderBottomLyricLine(null, null, -1);

  if (!elAudio.paused) elAudio.pause();

  elSourceBadge.textContent = "VIEWING";
  elTrackTitle.textContent = "Live Celestial Observatory";
  elTrackArtist.textContent = "88 IAU Constellations · Real-Time Sky Pattern";
  elHudClock.textContent = "LIVE";
  setLyricsPill("PATTERN", "synced");

  syncPlayerBarVisibility();
  elBtnBackLive.classList.toggle("hidden", !userPinned);
  if (elBtnView) {
    elBtnView.classList.toggle("active", userPinned);
    elBtnView.textContent = userPinned ? "🔭 Viewing" : "🔭 View";
  }

  // When user explicitly toggles Viewing Mode on, switch to Hemisphere Dome so they see the full 88-constellation pattern!
  if (userPinned && settings.visualMode !== "hemisphere") {
    setVisualMode("hemisphere");
  }
}

function exitViewingModeToMusic() {
  state.userPinnedViewing = false;
  hemiPhysics.viewingMode = false;
  if (elBtnView) {
    elBtnView.classList.remove("active");
    elBtnView.textContent = "🔭 View";
  }
  state.sourceMode = "system";
  state.lines = [];
  state.sysLyricsKey = "";
  clearStarWords();
  elBtnBackLive.classList.add("hidden");
  pollBackend();
}

// ---------------------------------------------------------------------------
// Local Audio & .LRC Drag-and-Drop Mode
// ---------------------------------------------------------------------------
function ensureLocalAudioAnalyser() {
  if (state.localAnalyser) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    state.localAudioCtx = new AC();
    const src = state.localAudioCtx.createMediaElementSource(elAudio);
    state.localAnalyser = state.localAudioCtx.createAnalyser();
    state.localAnalyser.fftSize = 512;
    state.localAnalyser.smoothingTimeConstant = 0.72;
    src.connect(state.localAnalyser);
    state.localAnalyser.connect(state.localAudioCtx.destination);
    state.localFreqBins = new Uint8Array(state.localAnalyser.frequencyBinCount);
  } catch {}
}

function sampleLocalAudioFFT() {
  if (!state.localAnalyser || elAudio.paused) return;
  state.localAnalyser.getByteFrequencyData(state.localFreqBins);
  const bins = state.localFreqBins;
  const avg = (a, b) => {
    let sum = 0;
    for (let i = a; i < b && i < bins.length; i++) sum += bins[i];
    return sum / Math.max(1, (b - a) * 255);
  };
  const sub = avg(1, 4);
  const bass = avg(4, 14);
  const mid = avg(14, 70);
  const high = avg(70, 180);
  const energy = sub * 0.25 + bass * 0.35 + mid * 0.25 + high * 0.15;
  const kickLvl = Math.min(1.0, sub * 0.62 + bass * 0.52);
  const snareLvl = Math.min(1.0, mid * 0.60 + high * 0.45);
  const kickFlux = Math.max(0, kickLvl - state.localPrevBass);
  const snareFlux = Math.max(0, snareLvl - state.localPrevSnare);
  state.localPrevBass = state.localPrevBass * 0.35 + kickLvl * 0.65;
  state.localPrevSnare = state.localPrevSnare * 0.35 + snareLvl * 0.65;

  const kickHit = kickFlux > 0.045 ? Math.min(1.0, kickFlux * 5.2) : 0;
  const snareHit = snareFlux > 0.055 ? Math.min(1.0, snareFlux * 4.5) : 0;
  const hit = Math.max(kickHit, snareHit * 0.92);
  const nowPerf = performance.now();
  if (hit > 0.25 && nowPerf - state.localLastBeatMs >= 135) {
    state.audio.beat_seq = (state.audio.beat_seq || 0) + 1;
    state.audio.beat_kind = kickHit >= snareHit * 0.9 ? 1 : 2;
    state.localLastBeatMs = nowPerf;
  }

  state.audio.sub = sub;
  state.audio.bass = bass;
  state.audio.mid = mid;
  state.audio.high = high;
  state.audio.energy = energy;
  state.audio.kick = Math.max(kickHit, (state.audio.kick || 0) * 0.65);
  state.audio.snare = Math.max(snareHit, (state.audio.snare || 0) * 0.65);
  state.audio.beat = Math.max(hit, (state.audio.beat || 0) * 0.68);
  state.audio.active = energy > 0.01 ? 1.0 : 0.0;
}

async function handleDroppedFiles(fileList) {
  let audioFile = null;
  let lrcFile = null;
  for (const f of fileList) {
    const name = f.name.toLowerCase();
    if (name.endsWith(".lrc") || name.endsWith(".txt")) lrcFile = f;
    else if (f.type.startsWith("audio/") || /\.(mp3|wav|flac|ogg|m4a|opus)$/i.test(name)) audioFile = f;
  }

  if (lrcFile) {
    const lrcText = await lrcFile.text();
    let parsedLines = [];
    try {
      const res = await apiPost("/api/parse_lrc", {
        lrc_text: lrcText,
        duration_ms: Math.round((elAudio.duration || 0) * 1000),
      });
      parsedLines = (res && res.lines) ? res.lines : simpleClientLrcParse(lrcText);
    } catch {
      parsedLines = simpleClientLrcParse(lrcText);
    }
    if (parsedLines && parsedLines.length > 0) {
      state.lines = parsedLines;
      state.activeLineIdx = -1;
      state.activeWordIdx = -1;
      setLyricsPill("LOCAL LRC", "synced");
    }
  }

  if (audioFile) {
    state.userPinnedViewing = false;
    hemiPhysics.viewingMode = false;
    if (elBtnView) {
      elBtnView.classList.remove("active");
      elBtnView.textContent = "🔭 View";
    }
    state.sourceMode = "local";
    const url = URL.createObjectURL(audioFile);
    elAudio.src = url;
    ensureLocalAudioAnalyser();
    if (state.localAudioCtx && state.localAudioCtx.state === "suspended") {
      state.localAudioCtx.resume();
    }
    elAudio.play().catch(() => {});

    const rawName = audioFile.name.replace(/\.[^.]+$/, "");
    let artist = "Local Audio";
    let title = rawName;
    if (rawName.includes(" - ")) {
      const parts = rawName.split(" - ");
      artist = parts[0].trim();
      title = parts.slice(1).join(" - ").trim();
    }

    elSourceBadge.textContent = "LOCAL";
    elTrackTitle.textContent = title;
    elTrackArtist.textContent = artist;
    syncPlayerBarVisibility();
    elBtnBackLive.classList.remove("hidden");
    elBtnPlayPause.textContent = "⏸";
    focusConstellationForSong(title, artist);

    if (!lrcFile && API_AVAILABLE) {
      state.lines = [];
      setLyricsPill("FINDING…", "loading");
      const res = await apiPost("/api/search_lyrics", { title, artist });
      if (state.sourceMode === "local") {
        if (res && res.found && res.lines && res.lines.length) {
          state.lines = res.lines;
          state.activeLineIdx = -1;
          setLyricsPill(res.synced ? "SYNCED" : "PLAIN", "synced");
        } else {
          setLyricsPill("AUDIO ONLY", "missing");
        }
      }
    }
  }
}

function simpleClientLrcParse(text) {
  const re = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(re, "").trim();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const frac = m[3] ? (m[3].length === 2 ? Number(m[3]) * 10 : Number(m[3])) : 0;
      const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000 + frac;
      rows.push({ ms, clean });
    }
  }
  rows.sort((a, b) => a.ms - b.ms);
  return rows.map((r, i) => {
    const endMs = i + 1 < rows.length ? rows[i + 1].ms : r.ms + 4000;
    const rawWords = r.clean.split(/\s+/).filter(Boolean);
    const step = Math.min(endMs - r.ms, Math.max(1500, rawWords.length * 550)) / Math.max(1, rawWords.length);
    return {
      start_ms: r.ms,
      end_ms: endMs,
      text: r.clean,
      instrumental: !r.clean,
      words: rawWords.map((w, wi) => ({
        word: w,
        clean: w.toLowerCase().replace(/[^a-z0-9']/g, ""),
        start_ms: Math.round(r.ms + wi * step),
        end_ms: Math.round(r.ms + (wi + 1) * step),
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Python Backend Polling (Windows SMTC + WASAPI Audio + Window Focus)
// ---------------------------------------------------------------------------
function setLyricsPill(text, kind) {
  elLyricsPill.textContent = text;
  elLyricsPill.className = "lyrics-pill";
  if (kind === "loading") elLyricsPill.classList.add("loading");
  else if (kind === "missing") elLyricsPill.classList.add("missing");
}

let _pollTimer = null;
let _polling = false;
let _audioPollTimer = null;
let _audioPolling = false;

function scheduleNextPoll(delayMs = null) {
  if (_pollTimer) clearTimeout(_pollTimer);
  // Keep tight 160ms sync polling whenever music is actively playing (even in Background/Wallpaper!)
  const ms = delayMs !== null
    ? delayMs
    : (state.sysPlaying ? 160 : 450);
  _pollTimer = setTimeout(pollBackend, ms);
}

// Ultra-light 30Hz (32ms) dedicated audio beat poller -> razor-tight kick/snare lock!
function scheduleFastAudioPoll() {
  if (_audioPollTimer) clearTimeout(_audioPollTimer);
  const active =
    API_AVAILABLE &&
    settings.audioReactive &&
    state.sourceMode !== "local" &&
    !state.isMinimized &&
    !document.hidden &&
    (state.sysPlaying || state.sourceMode === "viewing");
  _audioPollTimer = setTimeout(pollAudioFast, active ? 32 : 350);
}

async function pollAudioFast() {
  if (_audioPolling) return;
  if (!API_AVAILABLE || !settings.audioReactive || state.sourceMode === "local" || state.isMinimized || document.hidden) {
    scheduleFastAudioPoll();
    return;
  }
  _audioPolling = true;
  try {
    const a = await apiGet("/api/audio");
    if (a && state.sourceMode !== "local") {
      state.audio = a;
    }
  } catch {} finally {
    _audioPolling = false;
    scheduleFastAudioPoll();
  }
}
scheduleFastAudioPoll();

async function pollBackend() {
  if (_polling) return;
  if (!API_AVAILABLE) return;
  _polling = true;
  try {
    const reqStart = performance.now();
    const snap = await apiGet("/api/state");
    const reqEnd = performance.now();
    if (!snap) return;
    const halfRtt = Math.min(80, (reqEnd - reqStart) * 0.5);

    state.isFocused = Boolean(snap.window.focused);
    state.isMinimized = Boolean(snap.window.minimized);
    if (snap.window.mode && snap.window.mode !== state.windowMode) {
      state.windowMode = snap.window.mode;
      syncModeButtons();
    }

    if (state.sourceMode !== "local" && snap.audio) {
      state.audio = snap.audio;
    }

    const media = snap.media;
    if (!media) return;

    if (state.sourceMode === "viewing" && !state.userPinnedViewing && media.has_session && media.status === "playing") {
      hemiPhysics.viewingMode = false;
      state.sourceMode = "system";
      syncPlayerBarVisibility();
      elBtnBackLive.classList.add("hidden");
    }

    if (state.sourceMode === "system") {
      const nowMs = reqEnd;
      const inCmdGrace = nowMs < state.sysCmdLockUntil;
      const incomingRate = typeof media.playback_rate === "number" ? media.playback_rate : 1.0;
      const isNowPlaying = media.status === "playing";
      const incomingPos = (media.position_ms || 0) + (isNowPlaying ? halfRtt * incomingRate : 0);
      const wasPlaying = state.sysPlaying;

      state.sysDurMs = media.duration_ms || 0;
      if (typeof media.recommended_lead_ms === "number") {
        state.sysAutoLeadMs = media.recommended_lead_ms;
      }
      syncPlayerBarVisibility();
      elBtnBackLive.classList.add("hidden");

      // Respect brief 600ms command grace window right after clicking Play/Pause/Seek so UI never flickers back!
      if (!inCmdGrace) {
        state.sysPlaying = isNowPlaying;
        state.sysRate = state.sysPlaying ? (incomingRate > 0 ? incomingRate : 1.0) : 0.0;
        elBtnPlayPause.textContent = state.sysPlaying ? "⏸" : "▶";

        // Exact lock to MediaWatcher's drift-proof anchor: snap on pause/resume/seek (>400ms),
        // briskly converge tiny network/poll jitter (>35ms) so words stay razor-synced!
        if (!wasPlaying || !state.sysPlaying || media.track_key !== state.sysTrackKey) {
          state.sysPosMs = incomingPos;
          state.sysSnapTime = nowMs;
        } else {
          const predicted = state.sysPosMs + Math.max(0, nowMs - state.sysSnapTime) * state.sysRate;
          const drift = incomingPos - predicted;
          if (Math.abs(drift) > 400) {
            state.sysPosMs = incomingPos;
            state.sysSnapTime = nowMs;
            // External seek detected -> reset lookahead & cooldown so lyrics/constellations snap cleanly!
            state.preGlidedLineIdx = -1;
            state.lastConstellationSwitchMs = -999999;
            state.lastWordShownMs = -999999;
          } else if (Math.abs(drift) > 35) {
            state.sysPosMs = predicted + drift * 0.72;
            state.sysSnapTime = nowMs;
          }
        }
      }

      elSourceBadge.textContent = (media.source_app || "LIVE").toUpperCase();
      elTrackTitle.textContent = media.clean_title || media.title || "Waiting for Music…";
      elTrackArtist.textContent = media.clean_artist || media.artist || "Play Spotify, YouTube, or any player";

      if (media.lyrics_status === "loading") {
        setLyricsPill("SYNCING…", "loading");
      } else if (media.lyrics_status === "synced") {
        const src = (media.lyrics_source || "").toLowerCase();
        const badge = src === "boidu_hinglish"
          ? "BOIDU · HINGLISH"
          : src === "boidu"
          ? (media.lyrics_word_synced ? "BOIDU · WORD" : "BOIDU · SYNC")
          : src === "kugou"
          ? "KUGOU · SYNC"
          : (media.lyrics_word_synced ? "LRCLIB · WORD" : "LRCLIB · SYNC");
        setLyricsPill(badge, "synced");
      } else if (media.lyrics_status === "plain") {
        setLyricsPill("ESTIMATED", "synced");
      } else if (media.lyrics_status === "not_found") {
        setLyricsPill("AUDIO MODE", "missing");
      } else {
        setLyricsPill("IDLE", "missing");
      }

      const lyrSig = `${media.track_key}|${media.lyrics_status}|${media.lyrics_source || ""}|${media.lyrics_word_synced ? 1 : 0}`;
      if (lyrSig !== state.sysLyricsKey) {
        state.sysLyricsKey = lyrSig;
        if (media.track_key !== state.sysTrackKey) {
          state.sysTrackKey = media.track_key;
          state.lines = [];
          state.activeLineIdx = -1;
          state.activeWordIdx = -1;
          state.preGlidedLineIdx = -1;
          state.lastConstellationSwitchMs = -999999;
          state.lastWordShownMs = -999999;
          // Load saved per-song offset (defaults to 0ms for fresh songs!)
          const savedOff = (settings.trackOffsets && media.track_key in settings.trackOffsets)
            ? settings.trackOffsets[media.track_key]
            : 0;
          settings.offsetMs = savedOff;
          applySettingsToEngine();
          clearStarWords();
          renderBottomLyricLine(null, null, -1);
          renderSyncLinesList();
          // Rotate hemisphere / switch constellation cleanly whenever a new song begins!
          focusConstellationForSong(media.clean_title || media.title, media.clean_artist || media.artist);
        }
        if (media.lyrics_status === "synced" || media.lyrics_status === "plain") {
          const lyr = await apiGet("/api/lyrics");
          if (lyr && lyr.lines && lyr.lines.length > 0) {
            state.lines = lyr.lines;
            state.activeLineIdx = -1;
            state.activeWordIdx = -1;
            renderSyncLinesList();
            updateLyricsAtTime(getCurrentPlaybackMs());
          }
        }
      }
    }
  } catch {} finally {
    _polling = false;
    scheduleNextPoll();
  }
}

scheduleNextPoll(200);

// ---------------------------------------------------------------------------
// Adaptive Frame-Paced Main Render Loop (Wallpaper & Browser-Friendly!)
// ---------------------------------------------------------------------------
let lastFrameTime = performance.now();
let lastRenderTime = performance.now();
let fpsFrames = 0;
let fpsLastCheck = performance.now();
let appliedProfileKey = "";

function getRenderBudget() {
  if (state.isMinimized || document.hidden) {
    return { fps: 0, maxDpr: 1.0, nebulaScale: 0.2, nebulaSkip: 4 };
  }
  if (settings.perfProfile === "eco") {
    return { fps: 28, maxDpr: 1.0, nebulaScale: 0.20, nebulaSkip: 4 };
  }
  if (settings.perfProfile === "ultra") {
    return { fps: 60, maxDpr: 1.75, nebulaScale: 0.35, nebulaSkip: 2 };
  }
  // Adaptive profile: ultra-light in Wallpaper & Background so browser video never lags!
  const isPlaying =
    (state.sourceMode === "system" && state.sysPlaying) ||
    (state.sourceMode === "local" && !elAudio.paused) ||
    (state.sourceMode === "viewing" && (state.audio.active > 0.05 || Boolean(hemiPhysics.trackedTarget)));

  if (state.windowMode === "wallpaper") {
    return isPlaying
      ? { fps: 24, maxDpr: 1.0, nebulaScale: 0.20, nebulaSkip: 4 }
      : { fps: 10, maxDpr: 1.0, nebulaScale: 0.18, nebulaSkip: 6 };
  }
  const isBg = state.windowMode === "background" || !state.isFocused;
  if (isBg) {
    return isPlaying
      ? { fps: 30, maxDpr: 1.0, nebulaScale: 0.22, nebulaSkip: 4 }
      : { fps: 12, maxDpr: 1.0, nebulaScale: 0.20, nebulaSkip: 5 };
  }
  return { fps: 60, maxDpr: 1.25, nebulaScale: 0.24, nebulaSkip: 3 };
}

function getCurrentPlaybackMs(now = performance.now()) {
  if (state.sourceMode === "viewing") return 0;
  if (state.sourceMode === "local") return (elAudio.currentTime || 0) * 1000;
  let livePos = state.sysPosMs;
  if (state.sysPlaying) {
    livePos += Math.max(0, now - state.sysSnapTime) * (state.sysRate || 1.0);
    if (state.sysDurMs > 0) livePos = Math.min(livePos, state.sysDurMs);
  }
  return livePos;
}

function formatMs(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function formatMsDec(ms) {
  const safe = Math.max(0, ms);
  const s = Math.floor(safe / 1000);
  const d = Math.floor((safe % 1000) / 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${d}`;
}

function frameLoop(now) {
  requestAnimationFrame(frameLoop);

  const budget = getRenderBudget();
  if (budget.fps === 0) {
    lastFrameTime = now;
    return;
  }

  const minInterval = 1000 / budget.fps;
  if (now - lastRenderTime < minInterval - 1.2) return;

  const dt = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;
  lastRenderTime = now;

  const profKey = `${budget.maxDpr}|${budget.nebulaScale}|${budget.nebulaSkip}`;
  if (profKey !== appliedProfileKey) {
    appliedProfileKey = profKey;
    engine.nebulaUpdateInterval = budget.nebulaSkip;
    engine.resize(budget.maxDpr, budget.nebulaScale);
  }

  if (state.sourceMode === "viewing") {
    // Pure Observatory Viewing Mode: real sky patterns, live solar system & NORAD satellites,
    // still reacting gently to live system WASAPI beats if music plays in the background!
  } else if (state.sourceMode === "local") {
    sampleLocalAudioFFT();
    const curMs = (elAudio.currentTime || 0) * 1000;
    const durMs = Math.max(1, (elAudio.duration || 1) * 1000);
    if (!state.isSeekingSlider) {
      elSeekSlider.value = Math.round((curMs / durMs) * 1000);
    }
    elTimeLabel.textContent = formatMs(curMs);
    elDurLabel.textContent = formatMs(durMs);
    if (state.lines.length > 0) updateLyricsAtTime(curMs);
    if (!elAudio.paused) stepInstrumentalReactivity(dt, curMs);
  } else if (state.sourceMode === "system") {
    const livePos = getCurrentPlaybackMs(now);
    const durMs = Math.max(1, state.sysDurMs || 1);
    if (!state.isSeekingSlider && state.sysDurMs > 0) {
      elSeekSlider.value = Math.round((livePos / durMs) * 1000);
    }
    elTimeLabel.textContent = formatMs(livePos);
    elDurLabel.textContent = state.sysDurMs > 0 ? formatMs(state.sysDurMs) : "--:--";
    if (state.lines.length > 0) updateLyricsAtTime(livePos);
    if (state.sysPlaying) stepInstrumentalReactivity(dt, livePos);
  }

  const isMusicPaused =
    (state.sourceMode === "system" && !state.sysPlaying) ||
    (state.sourceMode === "local" && elAudio.paused);

  physics.step(dt, isMusicPaused ? null : state.audio, isMusicPaused);
  engine.render(physics, isMusicPaused ? null : state.audio);
  updateSkyConstellationLabels();
  updateSkyStarLabels();
  updateStarWordPositions();
  if (hoverInsideCanvas && !skyDragging) updateSkyHover();

  // While exploring or tracking in Hemisphere dome, show whichever real constellation/object is centered!
  if (settings.visualMode === "hemisphere") {
    if (hemiPhysics.trackedTarget) {
      const t = hemiPhysics.trackedTarget;
      const label = `✦ ${t.name.toUpperCase()} · ${hemiPhysics.zoom.toFixed(1)}×`;
      if (elConstellationTag.textContent !== label) {
        elConstellationTag.textContent = label;
      }
      if (elConstellationFact) elConstellationFact.classList.add("hidden");
    } else if (hemiPhysics.freeLook || hemiPhysics.viewingMode) {
      const lookedAt = hemiPhysics.hoveredCenterId;
      if (lookedAt && CONSTELLATIONS[lookedAt]) {
        const label = `✦ ${CONSTELLATIONS[lookedAt].title} · ${hemiPhysics.zoom.toFixed(1)}×`;
        if (elConstellationTag.textContent !== label) {
          elConstellationTag.textContent = label;
        }
        updateConstellationFactDisplay(lookedAt);
      }
    }
  }

  fpsFrames++;
  if (now - fpsLastCheck >= 500) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLastCheck));
    fpsFrames = 0;
    fpsLastCheck = now;
    elPerfReadout.textContent = `${fps} FPS · ${settings.perfProfile.toUpperCase()}`;

    const rawMs = getCurrentPlaybackMs(now);
    if (elHudClock) {
      if (state.sourceMode === "viewing") {
        const d = new Date();
        elHudClock.textContent = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")} UTC`;
      } else {
        const dur = state.sourceMode === "system" ? state.sysDurMs
          : (elAudio.duration || 0) * 1000;
        elHudClock.textContent = dur > 0 ? `${formatMs(rawMs)} / ${formatMs(dur)}` : formatMs(rawMs);
      }
    }
    if (elOffsetLiveClock && !elPanelSettings.classList.contains("hidden")) {
      const effMs = Math.max(0, rawMs + getEffectiveOffsetMs());
      elOffsetLiveClock.textContent = `Track ${formatMsDec(rawMs)} → Lyrics ${formatMsDec(effMs)}`;
      highlightActiveSyncLine();
    }
  }
}

// ---------------------------------------------------------------------------
// Visual SVG Constellation Cards Menu & Settings Wiring
// ---------------------------------------------------------------------------
function makeConstellationSvg(data) {
  const pts = data.points || [];
  const edges = data.edges || [];
  const rgb = data.palette?.lineTint || [0.55, 0.8, 1.0];
  const stroke = `rgba(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)}, 0.58)`;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const spanX = Math.max(0.2, maxX - minX);
  const spanY = Math.max(0.2, maxY - minY);
  const scale = Math.min(64 / spanX, 42 / spanY);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const mapX = (x) => (39 + (x - cx) * scale).toFixed(1);
  const mapY = (y) => (27 - (y - cy) * scale).toFixed(1);

  let svg = `<svg class="atlas-svg" viewBox="0 0 78 54" xmlns="http://www.w3.org/2000/svg">`;
  for (const [a, b] of edges) {
    if (!pts[a] || !pts[b]) continue;
    svg += `<line x1="${mapX(pts[a].x)}" y1="${mapY(pts[a].y)}" x2="${mapX(pts[b].x)}" y2="${mapY(pts[b].y)}" stroke="${stroke}" stroke-width="1" stroke-linecap="round"/>`;
  }
  for (const p of pts) {
    const r = p.primary ? 2.1 : 1.15;
    const fill = p.primary ? "#ffffff" : "rgba(215,232,255,0.82)";
    svg += `<circle cx="${mapX(p.x)}" cy="${mapY(p.y)}" r="${r}" fill="${fill}"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function buildAtlasCards(filter = "") {
  const q = filter.trim().toLowerCase();
  elAtlasGrid.innerHTML = "";

  Object.entries(CONSTELLATIONS).forEach(([key, data]) => {
    const label = data.title || key;
    const iau = (data.iau || "").toLowerCase();
    const en = (data.en || "").toLowerCase();
    if (q && !key.includes(q) && !label.toLowerCase().includes(q) && !iau.includes(q) && !en.includes(q)) return;

    const card = document.createElement("button");
    card.className = "atlas-card";
    card.dataset.cid = key;
    if (key === state.currentConstellationId) card.classList.add("active");

    const sub = data.en || (label.includes("·") ? label.split("·")[1].trim() : label);
    const niceName = data.name || key.replace(/_/g, " ");
    card.innerHTML = `
      ${makeConstellationSvg(data)}
      <span class="atlas-card-name">${escapeHtml(niceName)}</span>
      <span class="atlas-card-sub">${escapeHtml(sub)}</span>
    `;
    card.addEventListener("click", () => {
      applyConstellation(data, key, { speedScale: 1.0, meteor: true });
      const sIdx = physics.advanceWordStar(niceName, 1.15, true);
      showWordNextToStar(niceName, sIdx);
    });
    elAtlasGrid.appendChild(card);
  });
}

function highlightActiveAtlasCard() {
  elAtlasGrid.querySelectorAll(".atlas-card").forEach((el) => {
    el.classList.toggle("active", el.dataset.cid === state.currentConstellationId);
  });
}

function buildFontChips() {
  if (!elFontGrid) return;
  elFontGrid.innerHTML = "";
  const cur = settings.lyricFont || "sans";
  for (const [key, f] of Object.entries(LYRIC_FONTS)) {
    const btn = document.createElement("button");
    btn.className = "font-chip" + (cur === key ? " active" : "");
    btn.dataset.font = key;
    const sampleStyle = `font-family:${f.family};font-style:${f.style};font-weight:${f.weight};letter-spacing:${f.tracking};text-transform:${f.transform}`;
    btn.innerHTML = `<span class="font-chip-sample" style="${sampleStyle}">${escapeHtml(f.sample)}</span><span class="font-chip-label">${escapeHtml(f.label)}</span>`;
    btn.addEventListener("click", () => {
      settings.lyricFont = key;
      applySettingsToEngine();
      saveSettings();
      elFontGrid.querySelectorAll(".font-chip").forEach((c) =>
        c.classList.toggle("active", c.dataset.font === key)
      );
    });
    elFontGrid.appendChild(btn);
  }
}

function buildPaletteChips() {
  elPaletteGrid.innerHTML = "";
  const entries = [["auto", { name: "Auto Mood", c: [0.55, 0.78, 1.0] }], ...Object.entries(PALETTES)];
  for (const [key, pal] of entries) {
    const btn = document.createElement("button");
    btn.className = "palette-chip" + (settings.paletteOverride === key ? " active" : "");
    btn.dataset.pal = key;
    const dotCol = `rgb(${Math.round(pal.c[0] * 255)}, ${Math.round(pal.c[1] * 255)}, ${Math.round(pal.c[2] * 255)})`;
    btn.innerHTML = `<span class="palette-dot" style="background:${dotCol};box-shadow:0 0 6px ${dotCol}"></span><span>${escapeHtml(pal.name.split(" ")[0])}</span>`;
    btn.addEventListener("click", () => {
      settings.paletteOverride = key;
      applySettingsToEngine();
      saveSettings();
      elPaletteGrid.querySelectorAll(".palette-chip").forEach((c) =>
        c.classList.toggle("active", c.dataset.pal === key)
      );
      if (key !== "auto" && PALETTES[key]) {
        morphPhysics.setPalette(PALETTES[key]);
        hemiPhysics.setPalette(PALETTES[key]);
      }
    });
    elPaletteGrid.appendChild(btn);
  }
}

function iconForObject(item) {
  const k = item.subkind || item.kind;
  if (k === "sun") return "☀";
  if (k === "moon") return "☾";
  if (k === "planet" || k === "solar") return "🪐";
  if (k === "satellite") return "🛰";
  if (k === "galaxy") return "🌀";
  if (k === "nebula") return "☁";
  if (k === "cluster") return "✧";
  return "✦";
}

function updateTrackingPill() {
  if (!elTrackingPill) return;
  const t = hemiPhysics.trackedTarget;
  if (!t || settings.visualMode !== "hemisphere") {
    elTrackingPill.classList.add("hidden");
    return;
  }
  const verb = t.kind === "satellite" ? "Tracking" : "Focused on";
  elTrackingLabel.textContent = `${iconForObject(t)} ${verb} ${t.name}${t.subtitle ? ` · ${t.subtitle.split("·")[0].trim()}` : ""}`;
  elTrackingPill.classList.remove("hidden");
}

function flyToLiveObject(item) {
  if (!item) return;
  if (settings.visualMode !== "hemisphere") {
    setVisualMode("hemisphere", { skipFocus: true });
  }
  const ok = hemiPhysics.flyToTarget(item);
  if (ok) {
    // Sync checkboxes if layer was auto-enabled
    settings.showPlanetsAndSats = hemiPhysics.showPlanetsAndSats;
    settings.showDeepSky = hemiPhysics.showDeepSky;
    if (elChkPlanetsSats) elChkPlanetsSats.checked = settings.showPlanetsAndSats;
    if (elChkDeepSky) elChkDeepSky.checked = settings.showDeepSky;
    updateTrackingPill();
    buildLiveObjectsList(elObjectSearch ? elObjectSearch.value : "");
    elConstellationTag.textContent = `✦ ${item.name.toUpperCase()} · ${hemiPhysics.targetZoom.toFixed(1)}×`;
  }
}

function buildLiveObjectsList(filter = "") {
  if (!elLiveObjectsList) return;
  const q = filter.trim().toLowerCase();
  const cat = hemiPhysics.getLiveCatalog();
  const activeId = hemiPhysics.trackedTarget?.id || "";

  const sections = [
    { title: "☀ Solar System (Real-Time J2000)", items: cat.solar, badge: "LIVE" },
    { title: "🛰 Active Satellites (NORAD GP)", items: cat.satellites, badge: "TRACK" },
    { title: "☁ Nebulae, Galaxies & Clusters (21)", items: cat.deepSky, badge: "FLY TO" },
  ];

  elLiveObjectsList.innerHTML = "";
  let totalShown = 0;

  for (const sec of sections) {
    const matched = sec.items.filter((it) => {
      if (!q) return true;
      const hay = `${it.name} ${it.desig || ""} ${it.subtitle || ""} ${it.id || ""}`.toLowerCase();
      return hay.includes(q);
    });
    if (matched.length === 0) continue;
    totalShown += matched.length;

    const grp = document.createElement("div");
    grp.className = "sky-obj-group";
    const h = document.createElement("div");
    h.className = "sky-obj-group-title";
    h.textContent = sec.title;
    grp.appendChild(h);

    const grid = document.createElement("div");
    grid.className = "sky-obj-grid";

    for (const item of matched) {
      const btn = document.createElement("button");
      btn.className = "sky-obj-item" + (item.id === activeId ? " active" : "");
      const isLiveBadge = item.kind === "solar" || (item.kind === "satellite" && item.live);
      const badgeTxt = item.id === activeId ? "LOCKED" : (item.kind === "satellite" ? (item.live ? "LIVE" : "ORBIT") : sec.badge);
      btn.innerHTML = `
        <div class="sky-obj-main">
          <span class="sky-obj-name">${iconForObject(item)} ${escapeHtml(item.name)}${item.desig ? ` <span style="opacity:.58;font-weight:400">${escapeHtml(item.desig)}</span>` : ""}</span>
          <span class="sky-obj-sub">${escapeHtml(item.subtitle || item.coord || "")}</span>
        </div>
        <span class="sky-obj-badge${isLiveBadge ? " live" : ""}">${badgeTxt}</span>
      `;
      btn.addEventListener("click", () => flyToLiveObject(item));
      grid.appendChild(btn);
    }

    grp.appendChild(grid);
    elLiveObjectsList.appendChild(grp);
  }

  if (totalShown === 0) {
    elLiveObjectsList.innerHTML = `<div class="sync-line-ts" style="padding:10px;text-align:center">No matching sky objects.</div>`;
  }
}

function applySettingsToEngine() {
  // Ambience darkness & star music glow (synced to BOTH Morph & Hemisphere engines!)
  engine.ambienceIntensity = settings.ambience / 100;
  morphPhysics.musicGlowStrength = settings.starGlow / 100;
  morphPhysics.transitionSpeedMul = settings.speed / 100;
  hemiPhysics.musicGlowStrength = settings.starGlow / 100;
  hemiPhysics.transitionSpeedMul = settings.speed / 100;
  hemiPhysics.showPlanetsAndSats = settings.showPlanetsAndSats !== false;
  hemiPhysics.showDeepSky = settings.showDeepSky !== false;
  hemiPhysics.showEcliptic = settings.showEcliptic !== false;

  document.body.classList.toggle("mode-hemisphere", settings.visualMode === "hemisphere");
  if (elChkDeepSky) elChkDeepSky.checked = settings.showDeepSky !== false;
  if (elChkPlanetsSats) elChkPlanetsSats.checked = settings.showPlanetsAndSats !== false;
  if (elChkEcliptic) elChkEcliptic.checked = settings.showEcliptic !== false;
  if (elChkSkyLabels) elChkSkyLabels.checked = settings.showSkyLabels !== false;
  if (elSkyLabelsLayer) elSkyLabelsLayer.classList.toggle("hidden", settings.showSkyLabels === false);
  if (elChkStarLabels) elChkStarLabels.checked = settings.showStarLabels !== false;
  if (elStarLabelsLayer) elStarLabelsLayer.classList.toggle("hidden", settings.showStarLabels === false);
  if (elChkConstFacts) elChkConstFacts.checked = settings.showConstFacts !== false;
  updateConstellationFactDisplay(
    settings.visualMode === "hemisphere" && (hemiPhysics.freeLook || hemiPhysics.viewingMode)
      ? hemiPhysics.hoveredCenterId
      : state.currentConstellationId
  );
  document.querySelectorAll("[data-vismode]").forEach((b) =>
    b.classList.toggle("active", b.dataset.vismode === settings.visualMode)
  );

  elRngAmbience.value = settings.ambience;
  elValAmbience.textContent = `${settings.ambience}%`;
  elRngStarGlow.value = settings.starGlow;
  elValStarGlow.textContent = `${settings.starGlow}%`;
  elRngSpeed.value = settings.speed;
  elValSpeed.textContent = `${(settings.speed / 100).toFixed(1)}×`;

  // Lyric font family + size scaling (updates CSS variables & cached tag sizes)
  const fontSpec = LYRIC_FONTS[settings.lyricFont] || LYRIC_FONTS.sans;
  const scale = ((settings.fontSize || 100) / 100) * (fontSpec.scaleMul || 1.0);
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--lyric-scale", String(scale));
  rootStyle.setProperty("--lyric-font", fontSpec.family);
  rootStyle.setProperty("--lyric-style", fontSpec.style);
  rootStyle.setProperty("--lyric-weight", fontSpec.weight);
  rootStyle.setProperty("--lyric-tracking", fontSpec.tracking);
  rootStyle.setProperty("--lyric-transform", fontSpec.transform);
  elRngFontSize.value = settings.fontSize || 100;
  elValFontSize.textContent = `${settings.fontSize || 100}%`;
  for (const slot of starWordPool) {
    if (slot.active) {
      slot.w = slot.el.offsetWidth || slot.w;
      slot.h = slot.el.offsetHeight || slot.h;
    }
  }

  // Lyric display mode
  const showStar = settings.lyricMode === "star" || settings.lyricMode === "both";
  elStarLyricLayer.classList.toggle("hidden", !showStar);
  if (!showStar) clearStarWords();

  const showBottom = settings.lyricMode === "bottom" || settings.lyricMode === "both";
  elLyricCurrent.classList.toggle("hidden", !showBottom);
  elLyricNext.classList.toggle("hidden", !showBottom);
  elConstellationTag.classList.toggle("hidden", !settings.showTag);

  document.querySelectorAll("#seg-lyric-mode .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.lyricmode === settings.lyricMode)
  );
  document.querySelectorAll("#seg-switch-mode .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.switchmode === settings.switchMode)
  );
  document.querySelectorAll("#seg-perf .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.perf === settings.perfProfile)
  );
  if (elSelLyricsProvider) {
    elSelLyricsProvider.value = settings.lyricsProvider || "auto";
  }

  elChkLock.checked = settings.switchMode === "locked";
  elChkAudioReactive.checked = settings.audioReactive;
  elChkShowTag.checked = settings.showTag;

  const leadMs = settings.browserLeadMs ?? 0;
  if (elRngLead) elRngLead.value = leadMs;
  if (elValLead) elValLead.textContent = `${leadMs > 0 ? "+" : ""}${(leadMs / 1000).toFixed(2)}s`;

  const sec = (settings.offsetMs / 1000).toFixed(2);
  elOffsetLabel.textContent = `${settings.offsetMs > 0 ? "+" : ""}${sec}s`;
  if (elRngOffset) elRngOffset.value = settings.offsetMs;
  if (elOffsetLiveClock) {
    const rawMs = getCurrentPlaybackMs();
    const effMs = Math.max(0, rawMs + getEffectiveOffsetMs());
    elOffsetLiveClock.textContent = `Track ${formatMsDec(rawMs)} → Lyrics ${formatMsDec(effMs)}`;
  }

  if (settings.paletteOverride !== "auto" && PALETTES[settings.paletteOverride]) {
    morphPhysics.setPalette(PALETTES[settings.paletteOverride]);
    hemiPhysics.setPalette(PALETTES[settings.paletteOverride]);
  }
}

// Menu Open / Tab Switch Helpers (3 Tabs: 88 Constellations, Live Sky Objects, Settings)
function selectMenuTab(tab) {
  const showC = tab === "constellations";
  const showO = tab === "objects";
  const showS = tab === "settings";
  elPanelConstellations.classList.toggle("hidden", !showC);
  elPanelObjects.classList.toggle("hidden", !showO);
  elPanelSettings.classList.toggle("hidden", !showS);
  elTabConstellations.classList.toggle("active", showC);
  elTabObjects.classList.toggle("active", showO);
  elTabSettings.classList.toggle("active", showS);
  if (showO) buildLiveObjectsList(elObjectSearch ? elObjectSearch.value : "");
}

function openMenuTab(tab) {
  const isAlreadyOpen = !elMainMenu.classList.contains("hidden");
  const isSameTab =
    (tab === "constellations" && !elPanelConstellations.classList.contains("hidden")) ||
    (tab === "objects" && !elPanelObjects.classList.contains("hidden")) ||
    (tab === "settings" && !elPanelSettings.classList.contains("hidden"));

  if (isAlreadyOpen && isSameTab) {
    elMainMenu.classList.add("hidden");
    return;
  }

  elMainMenu.classList.remove("hidden");
  selectMenuTab(tab);
  wakeHud();
}

document.getElementById("btn-menu-constellations").addEventListener("click", () => openMenuTab("constellations"));
document.getElementById("btn-menu-objects").addEventListener("click", () => openMenuTab("objects"));
document.getElementById("btn-menu-settings").addEventListener("click", () => openMenuTab("settings"));
elTabConstellations.addEventListener("click", () => selectMenuTab("constellations"));
elTabObjects.addEventListener("click", () => selectMenuTab("objects"));
elTabSettings.addEventListener("click", () => selectMenuTab("settings"));
document.getElementById("btn-menu-close").addEventListener("click", () => elMainMenu.classList.add("hidden"));

if (elObjectSearch) {
  elObjectSearch.addEventListener("input", () => buildLiveObjectsList(elObjectSearch.value));
}
document.getElementById("btn-objects-reset")?.addEventListener("click", () => {
  hemiPhysics.resetView();
  updateTrackingPill();
  buildLiveObjectsList(elObjectSearch ? elObjectSearch.value : "");
});
if (elBtnTrackingRelease) {
  elBtnTrackingRelease.addEventListener("click", () => {
    hemiPhysics.releaseTracking();
    updateTrackingPill();
    buildLiveObjectsList(elObjectSearch ? elObjectSearch.value : "");
  });
}

// Settings input bindings
elRngAmbience.addEventListener("input", () => {
  settings.ambience = Number(elRngAmbience.value);
  applySettingsToEngine();
  saveSettings();
});
elRngStarGlow.addEventListener("input", () => {
  settings.starGlow = Number(elRngStarGlow.value);
  applySettingsToEngine();
  saveSettings();
});
elRngSpeed.addEventListener("input", () => {
  settings.speed = Number(elRngSpeed.value);
  applySettingsToEngine();
  saveSettings();
});
elRngFontSize.addEventListener("input", () => {
  settings.fontSize = Number(elRngFontSize.value);
  applySettingsToEngine();
  saveSettings();
});

document.querySelectorAll("#seg-lyric-mode .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    settings.lyricMode = btn.dataset.lyricmode;
    applySettingsToEngine();
    saveSettings();
  });
});

document.querySelectorAll("#seg-switch-mode .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    settings.switchMode = btn.dataset.switchmode;
    applySettingsToEngine();
    saveSettings();
  });
});

document.querySelectorAll("#seg-perf .seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    settings.perfProfile = btn.dataset.perf;
    applySettingsToEngine();
    saveSettings();
  });
});

if (elSelLyricsProvider) {
  elSelLyricsProvider.addEventListener("change", () => {
    settings.lyricsProvider = elSelLyricsProvider.value || "auto";
    applySettingsToEngine();
    saveSettings();
    state.sysLyricsKey = "";
    apiPost("/api/lyrics_provider", { provider: settings.lyricsProvider }).catch(() => {});
  });
}
// Sync saved lyrics provider choice to Rust backend right on startup!
if (API_AVAILABLE && settings.lyricsProvider && settings.lyricsProvider !== "auto") {
  apiPost("/api/lyrics_provider", { provider: settings.lyricsProvider }).catch(() => {});
}

elChkLock.addEventListener("change", () => {
  settings.switchMode = elChkLock.checked ? "locked" : "phrase";
  applySettingsToEngine();
  saveSettings();
});

elChkShowTag.addEventListener("change", () => {
  settings.showTag = elChkShowTag.checked;
  applySettingsToEngine();
  saveSettings();
});

if (elChkDeepSky) {
  elChkDeepSky.addEventListener("change", () => {
    settings.showDeepSky = elChkDeepSky.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

if (elChkPlanetsSats) {
  elChkPlanetsSats.addEventListener("change", () => {
    settings.showPlanetsAndSats = elChkPlanetsSats.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

if (elChkEcliptic) {
  elChkEcliptic.addEventListener("change", () => {
    settings.showEcliptic = elChkEcliptic.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

if (elChkSkyLabels) {
  elChkSkyLabels.addEventListener("change", () => {
    settings.showSkyLabels = elChkSkyLabels.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

if (elChkStarLabels) {
  elChkStarLabels.addEventListener("change", () => {
    settings.showStarLabels = elChkStarLabels.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

if (elChkConstFacts) {
  elChkConstFacts.addEventListener("change", () => {
    settings.showConstFacts = elChkConstFacts.checked;
    applySettingsToEngine();
    saveSettings();
  });
}

elChkAudioReactive.addEventListener("change", () => {
  settings.audioReactive = elChkAudioReactive.checked;
  saveSettings();
  apiPost("/api/audio_reactive", { enabled: settings.audioReactive }).catch(() => {});
});

function renderSyncLinesList() {
  if (!elSyncLinesList) return;
  const lines = state.lines || [];
  if (!lines.length) {
    elSyncLinesList.innerHTML = `<div class="sync-line-ts" style="padding:6px">No synced lyrics loaded for this track yet.</div>`;
    return;
  }
  elSyncLinesList.innerHTML = "";
  lines.forEach((ln, idx) => {
    if (!ln.text) return;
    const btn = document.createElement("button");
    btn.className = "sync-line-btn" + (idx === state.activeLineIdx ? " active" : "");
    btn.dataset.lidx = String(idx);
    btn.innerHTML = `<span class="sync-line-ts">${formatMs(ln.start_ms)}</span><span class="sync-line-txt">${escapeHtml(ln.text)}</span>`;
    btn.addEventListener("click", () => {
      // Snap sync immediately so THIS lyric line starts RIGHT NOW!
      const rawNow = getCurrentPlaybackMs();
      const autoLead = state.sourceMode === "system" ? (state.sysAutoLeadMs || 0) : 0;
      const fineTrim = state.sourceMode === "system" ? (settings.browserLeadMs || 0) : 0;
      setOffsetMs(ln.start_ms - rawNow - autoLead - fineTrim);
    });
    elSyncLinesList.appendChild(btn);
  });
}

function highlightActiveSyncLine() {
  if (!elSyncLinesList) return;
  elSyncLinesList.querySelectorAll(".sync-line-btn").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.lidx) === state.activeLineIdx);
  });
}

function setOffsetMs(newOffsetMs) {
  settings.offsetMs = Math.max(-60000, Math.min(60000, Math.round(newOffsetMs)));
  if (state.sourceMode === "system" && state.sysTrackKey) {
    settings.trackOffsets = settings.trackOffsets || {};
    settings.trackOffsets[state.sysTrackKey] = settings.offsetMs;
  }
  applySettingsToEngine();
  saveSettings();
  // Immediately re-evaluate active lyric line & glowing star so the shift is visible right away!
  state.activeLineIdx = -1;
  state.activeWordIdx = -1;
  updateLyricsAtTime(getCurrentPlaybackMs());
  highlightActiveSyncLine();
}

function updateOffset(deltaMs) {
  setOffsetMs(settings.offsetMs + deltaMs);
}

if (elRngLead) {
  elRngLead.addEventListener("input", () => {
    settings.browserLeadMs = Number(elRngLead.value);
    applySettingsToEngine();
    saveSettings();
    state.activeLineIdx = -1;
    state.activeWordIdx = -1;
    updateLyricsAtTime(getCurrentPlaybackMs());
  });
}

elRngOffset.addEventListener("input", () => setOffsetMs(Number(elRngOffset.value)));
document.getElementById("btn-offset-m1000").addEventListener("click", () => updateOffset(-1000));
document.getElementById("btn-offset-minus").addEventListener("click", () => updateOffset(-250));
document.getElementById("btn-offset-plus").addEventListener("click", () => updateOffset(250));
document.getElementById("btn-offset-p1000").addEventListener("click", () => updateOffset(1000));
document.getElementById("btn-offset-reset").addEventListener("click", () => setOffsetMs(0));
document.getElementById("btn-bar-sync-minus").addEventListener("click", () => updateOffset(-250));
document.getElementById("btn-bar-sync-plus").addEventListener("click", () => updateOffset(250));

// Word sandbox + live constellation filter
elWordSandbox.addEventListener("input", () => {
  buildAtlasCards(elWordSandbox.value);
});

function morphFromSandbox() {
  const txt = elWordSandbox.value.trim();
  if (!txt) return;
  const res = mapper.resolveForLine(txt);
  applyConstellation(res.constellation, res.id, { speedScale: 1.05, meteor: true });
  const sIdx = physics.advanceWordStar(txt, 1.2, true);
  showWordNextToStar(txt, sIdx);
  renderBottomLyricLine(
    { start_ms: Date.now(), text: txt, words: txt.split(/\s+/).map((w) => ({ word: w })) },
    null,
    0
  );
}
document.getElementById("btn-sandbox-go").addEventListener("click", morphFromSandbox);
elWordSandbox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") morphFromSandbox();
});

// ---------------------------------------------------------------------------
// HUD Auto-Hide, Window Modes, Playback Controls & Shortcuts
// ---------------------------------------------------------------------------
let idleTimer = null;
function wakeHud() {
  document.body.classList.remove("hud-idle");
  if (idleTimer) clearTimeout(idleTimer);
  const delay = (state.windowMode === "background" || state.windowMode === "wallpaper") ? 1200 : 2800;
  idleTimer = setTimeout(() => {
    if (
      elMainMenu.classList.contains("hidden") &&
      document.activeElement !== elWordSandbox &&
      document.activeElement !== elObjectSearch
    ) {
      document.body.classList.add("hud-idle");
    }
  }, delay);
}

window.addEventListener("mousemove", wakeHud, { passive: true });
window.addEventListener("mousedown", wakeHud, { passive: true });
window.addEventListener("resize", () => {
  const b = getRenderBudget();
  engine.resize(b.maxDpr, b.nebulaScale);
});
async function loadLiveCelestialData(retry = true) {
  if (!API_AVAILABLE) return;
  try {
    const data = await apiGet("/api/celestial");
    if (data && Array.isArray(data.satellites) && data.satellites.length > 0) {
      hemiPhysics.setLiveSatellites(data.satellites);
      if (elPanelObjects && !elPanelObjects.classList.contains("hidden")) {
        buildLiveObjectsList(elObjectSearch ? elObjectSearch.value : "");
      }
      return;
    }
  } catch {}
  if (retry) {
    setTimeout(() => loadLiveCelestialData(false), 3500);
  }
}

if (API_AVAILABLE) {
  apiPost("/api/audio_reactive", { enabled: settings.audioReactive }).catch(() => {});
  apiPost("/api/lyrics_provider", { provider: settings.lyricsProvider || "auto" }).catch(() => {});
  loadLiveCelestialData(true);
  // Automatically sync refreshed NORAD GP satellite orbital elements during long sessions (every 30 min)
  setInterval(() => loadLiveCelestialData(false), 30 * 60 * 1000);
}

// Interactive Sky Controls + Live Star / Planet / Satellite Hover Inspection!
let skyDragging = false;
let skyDragMoved = false;
let lastPtrX = 0;
let lastPtrY = 0;
let hoverMouseX = -999;
let hoverMouseY = -999;
let hoverInsideCanvas = false;

function hideSkyTooltip() {
  elHoverRing.classList.add("hidden");
  elSkyTooltip.classList.add("hidden");
  morphPhysics.hoveredStarIdx = -1;
  hemiPhysics.hoveredStarIdx = -1;
}

function updateSkyHover() {
  if (!hoverInsideCanvas || skyDragging || !elMainMenu.classList.contains("hidden")) {
    hideSkyTooltip();
    return;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const aspect = engine.aspect || (vw / Math.max(1, vh));
  const hit = physics.pickAtScreen(hoverMouseX, hoverMouseY, vw, vh, aspect);
  if (!hit) {
    hideSkyTooltip();
    return;
  }

  const icon = hit.kind === "sun" ? "☀ "
    : hit.kind === "planet" ? "🪐 "
    : hit.kind === "moon" ? "☾ "
    : hit.kind === "satellite" ? "🛰 "
    : hit.kind === "galaxy" ? "🌀 "
    : hit.kind === "nebula" ? "☁ "
    : hit.kind === "cluster" ? "✧ "
    : "✦ ";

  elTipName.textContent = `${icon}${hit.name}`;
  elTipDesig.textContent = hit.desig || "";
  elTipConst.textContent = hit.constellation || "";
  elTipSub.textContent = hit.subtitle || "";
  if (elTipFact) {
    if (hit.fact) {
      elTipFact.textContent = hit.fact;
      elTipFact.classList.remove("hidden");
    } else {
      elTipFact.textContent = "";
      elTipFact.classList.add("hidden");
    }
  }

  elHoverRing.classList.remove("hidden");
  elSkyTooltip.classList.remove("hidden");
  elHoverRing.style.transform = `translate3d(${hit.px.toFixed(1)}px, ${hit.py.toFixed(1)}px, 0)`;

  const tipW = 276;
  const tipH = hit.fact ? 155 : 92;
  const tx = hit.px + 18 + tipW > vw ? Math.max(12, hit.px - tipW - 14) : hit.px + 18;
  const ty = hit.py - 18 < 68 ? hit.py + 18 : Math.min(vh - tipH, hit.py - 22);
  elSkyTooltip.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0)`;
}

canvas.addEventListener("pointerenter", () => { hoverInsideCanvas = true; });
canvas.addEventListener("pointerleave", () => {
  hoverInsideCanvas = false;
  hideSkyTooltip();
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  skyDragging = true;
  skyDragMoved = false;
  lastPtrX = e.clientX;
  lastPtrY = e.clientY;
  hideSkyTooltip();
  if (settings.visualMode === "hemisphere") {
    hemiPhysics.isDragging = true;
    document.body.classList.add("is-dragging");
    canvas.setPointerCapture?.(e.pointerId);
  }
});

canvas.addEventListener("pointermove", (e) => {
  hoverMouseX = e.clientX;
  hoverMouseY = e.clientY;
  hoverInsideCanvas = true;
  if (!skyDragging) {
    updateSkyHover();
    return;
  }
  const dx = e.clientX - lastPtrX;
  const dy = e.clientY - lastPtrY;
  lastPtrX = e.clientX;
  lastPtrY = e.clientY;
  if (Math.hypot(dx, dy) > 1.5) skyDragMoved = true;

  if (settings.visualMode === "hemisphere") {
    const hadTrack = Boolean(hemiPhysics.trackedTarget);
    hemiPhysics.panByPixels(dx, dy);
    if (hadTrack) updateTrackingPill();
  }
});

function endSkyDrag(e) {
  if (!skyDragging) return;
  skyDragging = false;
  hemiPhysics.isDragging = false;
  document.body.classList.remove("is-dragging");
  try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
  if (!skyDragMoved) {
    // Clicking a Planet, Sun, Moon, Satellite, or Nebula in Hemisphere Mode smoothly flies to & locks onto it!
    if (settings.visualMode === "hemisphere") {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const aspect = engine.aspect || (vw / Math.max(1, vh));
      const hit = hemiPhysics.pickAtScreen(e.clientX, e.clientY, vw, vh, aspect);
      if (hit && hit.kind && hit.kind !== "star") {
        const targetKind =
          (hit.kind === "sun" || hit.kind === "moon" || hit.kind === "planet") ? "solar"
          : hit.kind === "satellite" ? "satellite"
          : "dso";
        flyToLiveObject({
          kind: targetKind,
          subkind: hit.kind,
          id: hit.id,
          catnr: hit.catnr,
          name: hit.name,
          subtitle: hit.subtitle,
        });
        return;
      }
    }
    physics.advanceWordStar("", 1.15, false);
    physics.spawnMeteor(1.0);
  }
}

canvas.addEventListener("pointerup", endSkyDrag);
canvas.addEventListener("pointercancel", endSkyDrag);

canvas.addEventListener("dblclick", () => {
  if (settings.visualMode === "hemisphere") {
    hemiPhysics.resetView();
    updateTrackingPill();
    const c = CONSTELLATIONS[hemiPhysics.focusedId];
    if (c) elConstellationTag.textContent = `✦ ${c.title}`;
  }
});

canvas.addEventListener("wheel", (e) => {
  if (settings.visualMode !== "hemisphere") return;
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  hemiPhysics.zoomBy(factor);
}, { passive: false });

function syncModeButtons() {
  document.querySelectorAll("[data-winmode]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.winmode === state.windowMode);
  });
}

async function setWindowMode(mode) {
  state.windowMode = mode;
  syncModeButtons();
  if (API_AVAILABLE) {
    try {
      const res = await apiPost("/api/mode", { mode });
      if (res && res.mode) {
        state.windowMode = res.mode;
        syncModeButtons();
      }
    } catch {}
  } else if (mode === "fullscreen") {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
}

document.querySelectorAll("[data-vismode]").forEach((btn) => {
  btn.addEventListener("click", () => setVisualMode(btn.dataset.vismode));
});

document.querySelectorAll("[data-winmode]").forEach((btn) => {
  btn.addEventListener("click", () => setWindowMode(btn.dataset.winmode));
});

if (elBtnView) {
  elBtnView.addEventListener("click", () => {
    if (state.sourceMode === "viewing" && state.userPinnedViewing) {
      exitViewingModeToMusic();
    } else {
      enterViewingMode(true);
    }
  });
}

document.getElementById("btn-open").addEventListener("click", () => elFileInput.click());
elFileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files.length) handleDroppedFiles(e.target.files);
  elFileInput.value = "";
});

document.getElementById("btn-tray").addEventListener("click", () => {
  apiPost("/api/minimize").catch(() => {});
});
document.querySelector(".pywebview-drag-region")?.addEventListener("mousedown", (e) => {
  if (e.button === 0 && state.windowMode === "borderless") {
    apiPost("/api/drag").catch(() => {});
  }
});
document.getElementById("btn-close").addEventListener("click", () => {
  if (API_AVAILABLE) apiPost("/api/quit").catch(() => window.close());
  else window.close();
});

function togglePlayPause() {
  if (state.sourceMode === "local") {
    if (elAudio.paused) {
      elAudio.play().catch(() => {});
      elBtnPlayPause.textContent = "⏸";
    } else {
      elAudio.pause();
      elBtnPlayPause.textContent = "▶";
    }
  } else if (state.sourceMode === "system" || state.sourceMode === "viewing") {
    const wantPlay = !state.sysPlaying;
    // Freeze monotonic clock immediately when pausing so lyrics stop dead on the beat!
    state.sysPosMs = getCurrentPlaybackMs();
    state.sysSnapTime = performance.now();
    state.sysPlaying = wantPlay;
    state.sysRate = wantPlay ? 1.0 : 0.0;
    state.sysCmdLockUntil = performance.now() + 650;
    elBtnPlayPause.textContent = wantPlay ? "⏸" : "▶";
    // Send EXPLICIT "pause" or "play" (reliable on LiMusic, Brave, Chrome, Edge, Spotify!)
    apiPost("/api/media_control", { action: wantPlay ? "play" : "pause" }).catch(() => {});
  }
}

function skipTrack(dir) {
  if (state.sourceMode === "local") {
    elAudio.currentTime = 0;
  } else if (state.sourceMode === "system") {
    state.sysCmdLockUntil = performance.now() + 500;
    apiPost("/api/media_control", { action: dir > 0 ? "next" : "prev" }).catch(() => {});
  }
}

function seekToMs(targetMs) {
  const clamped = Math.max(0, Math.round(targetMs));
  state.preGlidedLineIdx = -1;
  state.lastConstellationSwitchMs = -999999;
  state.lastWordShownMs = -999999;
  if (state.sourceMode === "local" && elAudio.duration) {
    elAudio.currentTime = Math.min(elAudio.duration, clamped / 1000);
    state.activeLineIdx = -1;
    state.activeWordIdx = -1;
  } else if (state.sourceMode === "system" && state.sysDurMs > 0) {
    const pos = Math.min(state.sysDurMs, clamped);
    state.sysPosMs = pos;
    state.sysSnapTime = performance.now();
    state.sysCmdLockUntil = performance.now() + 650;
    state.activeLineIdx = -1;
    state.activeWordIdx = -1;
    updateLyricsAtTime(pos);
    apiPost("/api/media_control", { action: "seek", position_ms: pos }).catch(() => {});
  }
}

if (elBtnPlayerMin) {
  elBtnPlayerMin.addEventListener("click", () => {
    settings.playerMinimized = true;
    saveSettings();
    syncPlayerBarVisibility();
  });
}
if (elBtnPlayerRestore) {
  elBtnPlayerRestore.addEventListener("click", () => {
    settings.playerMinimized = false;
    saveSettings();
    syncPlayerBarVisibility();
  });
}

elBtnPlayPause.addEventListener("click", togglePlayPause);
elBtnPrev.addEventListener("click", () => skipTrack(-1));
elBtnNext.addEventListener("click", () => skipTrack(1));

elBtnBackLive.addEventListener("click", () => {
  if (!elAudio.paused) elAudio.pause();
  exitViewingModeToMusic();
});

elSeekSlider.addEventListener("pointerdown", () => { state.isSeekingSlider = true; });
window.addEventListener("pointerup", () => { state.isSeekingSlider = false; });

elSeekSlider.addEventListener("input", () => {
  const frac = Number(elSeekSlider.value) / 1000;
  const dur = state.sourceMode === "local"
    ? (elAudio.duration || 0) * 1000
    : state.sysDurMs;
  if (dur > 0) {
    elTimeLabel.textContent = formatMs(frac * dur);
    if (state.sourceMode === "local") {
      seekToMs(frac * dur);
    }
  }
});

elSeekSlider.addEventListener("change", () => {
  state.isSeekingSlider = false;
  const frac = Number(elSeekSlider.value) / 1000;
  const dur = state.sourceMode === "local"
    ? (elAudio.duration || 0) * 1000
    : state.sysDurMs;
  if (dur > 0) seekToMs(frac * dur);
});

// Drag-and-drop audio / .lrc
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  elDropOverlay.classList.remove("hidden");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) elDropOverlay.classList.add("hidden");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  elDropOverlay.classList.add("hidden");
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    handleDroppedFiles(e.dataTransfer.files);
  }
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (document.activeElement === elWordSandbox || document.activeElement === elObjectSearch) return;
  const k = e.key.toLowerCase();
  if (k === "v") setVisualMode(settings.visualMode === "hemisphere" ? "morph" : "hemisphere");
  else if (k === "r" && settings.visualMode === "hemisphere") {
    hemiPhysics.resetView();
    updateTrackingPill();
    const c = CONSTELLATIONS[hemiPhysics.focusedId];
    if (c) elConstellationTag.textContent = `✦ ${c.title}`;
  } else if ((k === "=" || k === "+") && settings.visualMode === "hemisphere") {
    hemiPhysics.zoomBy(1.18);
  } else if (k === "-" && settings.visualMode === "hemisphere") {
    hemiPhysics.zoomBy(1 / 1.18);
  } else if (k === "w") setWindowMode("borderless");
  else if (k === "b") setWindowMode("background");
  else if (k === "p") setWindowMode("wallpaper");
  else if (k === "f" || e.key === "F11") {
    e.preventDefault();
    setWindowMode(state.windowMode === "fullscreen" ? "borderless" : "fullscreen");
  } else if (k === "m" || k === "a") openMenuTab("constellations");
  else if (k === "g") openMenuTab("objects");
  else if (k === "s") openMenuTab("settings");
  else if (k === "l") {
    const order = ["star", "both", "bottom", "off"];
    settings.lyricMode = order[(order.indexOf(settings.lyricMode) + 1) % order.length];
    applySettingsToEngine();
    saveSettings();
  } else if (k === "d" && elBtnView) elBtnView.click();
  else if (k === "o") elFileInput.click();
  else if (e.code === "Space") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    seekToMs(getCurrentPlaybackMs() - 5000);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    seekToMs(getCurrentPlaybackMs() + 5000);
  } else if (k === "[") updateOffset(e.shiftKey ? -2000 : -500);
  else if (k === "]") updateOffset(e.shiftKey ? 2000 : 500);
  else if (e.key === "Escape") {
    elMainMenu.classList.add("hidden");
    if (state.windowMode === "fullscreen") setWindowMode("borderless");
  }
});

// Boot into clean Observatory Viewing Mode with a fresh random real constellation immediately visible!
buildAtlasCards();
buildLiveObjectsList();
buildFontChips();
buildPaletteChips();
physics = settings.visualMode === "hemisphere" ? hemiPhysics : morphPhysics;
applySettingsToEngine();
{
  const bootCid = CONSTELLATION_KEYS[Math.floor(Math.random() * CONSTELLATION_KEYS.length)] || "orion";
  const bootConst = CONSTELLATIONS[bootCid];
  const bootPal = getActivePalette(bootConst.palette);
  // Seed BOTH engines right at startup so Morph Mode is instantly visible on frame 1 (never blank!)
  morphPhysics.morphTo({ ...bootConst, palette: bootPal }, { speedScale: 1.25, meteor: true });
  hemiPhysics.focusConstellation(bootCid, { instant: true, keepPalette: settings.paletteOverride !== "auto" });
  if (bootPal) hemiPhysics.setPalette(bootPal);
  state.currentConstellationId = bootCid;
  mapper.lastConstellationId = bootCid;
  highlightActiveAtlasCard();
  if (bootConst.title) elConstellationTag.textContent = `✦ ${bootConst.title}`;
  updateConstellationFactDisplay(bootCid);
}
enterViewingMode(false);
wakeHud();
requestAnimationFrame(frameLoop);
