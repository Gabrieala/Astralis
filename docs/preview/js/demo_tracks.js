/**
 * Built-in Interactive Demo Journeys showcasing authentic IAU Constellations
 * + Ultra-Light Web Audio Ambient Synth.
 */

function makeDemoLines(rawPairs) {
  const lines = [];
  for (let i = 0; i < rawPairs.length; i++) {
    const [startMs, text] = rawPairs[i];
    const nextMs = i + 1 < rawPairs.length ? rawPairs[i + 1][0] : startMs + 4800;
    const rawWords = text.split(/\s+/).filter(Boolean);
    const span = Math.min(nextMs - startMs - 150, Math.max(1800, rawWords.length * 560));
    const weights = rawWords.map((w) => Math.max(1, (w.match(/[aeiouy]+/gi) || []).length));
    const totalW = weights.reduce((a, b) => a + b, 0) || 1;

    let cursor = startMs;
    const words = rawWords.map((w, idx) => {
      const dur = (weights[idx] / totalW) * span;
      const ws = Math.round(cursor);
      cursor += dur;
      return {
        word: w,
        clean: w.toLowerCase().replace(/[^a-z0-9']/g, ""),
        start_ms: ws,
        end_ms: Math.max(ws + 120, Math.round(cursor)),
      };
    });

    lines.push({
      start_ms: startMs,
      end_ms: nextMs,
      text,
      instrumental: false,
      words,
    });
  }
  return lines;
}

export const DEMO_TRACKS = [
  {
    id: "northern-sky",
    title: "Northern Sky Atlas",
    artist: "Astralis Live Demo",
    duration_ms: 52000,
    lines: makeDemoLines([
      [500,   "Orion stands beneath the quiet winter night"],
      [5600,  "Follow Polaris north across the silent sky"],
      [10800, "Spread open swan wings over the dark ocean"],
      [16000, "Where Sirius shines brighter than the dawn"],
      [21200, "A crimson heart beats deep inside Scorpius"],
      [26400, "Rise like a phoenix from the golden flame"],
      [31600, "Beneath Cassiopeia and the northern crown"],
      [36800, "Sweet melody echoes from Vega and Lyra"],
      [42000, "Two twin souls drift across the Andromeda galaxy"],
      [47200, "While Draco winds forever around the pole"],
    ]),
  },
  {
    id: "southern-voyage",
    title: "Southern Horizon",
    artist: "Astralis Live Demo",
    duration_ms: 42000,
    lines: makeDemoLines([
      [500,   "Beneath the Southern Cross we sail the tide"],
      [5600,  "An eagle soars above the distant storm"],
      [10800, "Aim your golden arrow toward the horizon"],
      [16000, "Where Alpha Centauri watches from afar"],
      [21200, "Rain falls gently from the water bearer"],
      [26400, "Brave Perseus rides across the midnight sky"],
      [31600, "Through Libra scales of quiet silver peace"],
      [36800, "Until the lion wakes the golden sun"],
    ]),
  },
];

export class DemoAmbientSynth {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.master = null;
    this.chordTimer = null;
    this.chordIdx = 0;
    this.chords = [
      [146.83, 220.0, 261.63, 329.63],
      [130.81, 196.0, 246.94, 293.66],
      [116.54, 174.61, 220.0, 261.63],
      [110.0,  164.81, 220.0, 261.63],
    ];
  }

  start() {
    if (this.playing) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = this.ctx || new AC();
      if (this.ctx.state === "suspended") this.ctx.resume();

      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(0.001, this.ctx.currentTime);
      this.master.gain.exponentialRampToValueAtTime(0.11, this.ctx.currentTime + 1.4);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 950;
      filter.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.filter = filter;

      this.playing = true;
      this._playChord();
      this.chordTimer = setInterval(() => this._playChord(), 4800);
    } catch {
      this.playing = false;
    }
  }

  _playChord() {
    if (!this.playing || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = this.chords[this.chordIdx % this.chords.length];
    this.chordIdx++;

    for (const freq of notes) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.18 / notes.length, now + 1.4);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.1);
      osc.connect(gain);
      gain.connect(this.filter);
      osc.start(now);
      osc.stop(now + 5.2);
    }
  }

  stop() {
    this.playing = false;
    if (this.chordTimer) {
      clearInterval(this.chordTimer);
      this.chordTimer = null;
    }
    if (this.master && this.ctx) {
      try {
        this.master.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
      } catch {}
    }
  }
}
