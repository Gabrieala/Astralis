# ✦ Astralis — Real-Time Celestial Observatory & Music Visualizer

**Astralis** is a lightweight, standalone **native Rust** Windows desktop application (~5.2 MB single `.exe`) that turns whatever music you're listening to into a living celestial sky of **all 88 official IAU constellations**, real-time planets, live NORAD satellites, deep-sky nebulae, beat-reactive starlight, and synced lyrics across languages.

Crafted by **Gabrieala Mandal**.

---

## ✨ Features

- **Two Switchable Visual Modes (`V`)**
  - **✦ Morph Mode**: Features a vibrant constellation center-stage that flows smoothly along curved orbital star flights with beat-reactive round starlight and pulsing constellation lines.
  - **◐ Hemisphere Dome Mode**: A full 3D interactive planetarium featuring **all 88 IAU constellations** (767 Hipparcos stars), **1,350 real 3D Hipparcos background stars**, a **true 3D rotating Milky Way**, **real-time Sun, live-phased Moon & 7 Planets**, subtle **Ecliptic path**, **9 live CelesTrak NORAD satellites**, and **21 Messier/NGC nebulae, galaxies & clusters**.
  - Drag freely to explore and zoom around the dome during songs, inspect individual stars/planets/nebulae for astronomy fun facts, or lock onto any planet/satellite via **🪐 Live Sky (`G`)**.
- **Zero-Fidget Multi-Provider Synced Lyrics**
  - Automatically detects any music playing on Windows via native **Windows SMTC** (Spotify, YouTube, Brave, Chrome, Edge, Firefox, LiMusic, Apple Music, TIDAL, VLC, or local dropped `.mp3`/`.wav`/`.flac`/`.lrc`).
  - Queries **Boidu Better Lyrics** (official Apple Music millisecond TTML + `hi-Latn` Hinglish / `ja-Latn` Romaji / `ko-Latn` transliterations), **LRCLIB**, and **KuGou** — selectable via a **5-provider Lyrics Source dropdown** in Settings (`Auto`, `Hinglish / Romanized`, `Boidu`, `LRCLIB`, `KuGou`).
  - Full multilingual support (English, Hindi/Devanagari, Japanese, Korean, Chinese, Spanish, French, German, Arabic, Cyrillic) + 6 selectable lyric font styles.
- **45 Hz Native WASAPI Beat Reactivity**
  - Dual-band kick & snare spectral-flux onset detection reacts directly to real drum hits (even during instrumental intros, drops, and guitar solos), while keeping calm acoustic/ambient tracks serene.
  - Pausing your song smoothly pauses the stars in lockstep while keeping Dome Mode interactive.
- **Desktop & Wallpaper Integration**
  - **Borderless (`W`)**, **Background Behind Apps (`B`)**, **Live Desktop Wallpaper (`P`, Windows 10 & Windows 11 24H2/26H1)**, **Fullscreen (`F`)**, Click-Through Ghost Mode, and System Tray support.

---

## 🚀 Download & Run (Windows 10 / 11 64-bit)

1. Download **`Astralis-v1.0.0-win64.zip`** from the [Releases](../../releases) page and extract **`Astralis.exe`**.
2. Double-click **`Astralis.exe`** — no Python, Node.js, or installer required.
   *(On first launch, Windows SmartScreen may ask to confirm an unsigned indie app — click **More info → Run anyway**.)*

### Optional CLI Launch Flags
```powershell
Astralis.exe --background   # Start pinned behind open apps
Astralis.exe --wallpaper    # Start as a live desktop wallpaper behind icons
Astralis.exe --fullscreen   # Start in fullscreen
Astralis.exe --debug        # Enable WebView2 DevTools
```

---

## ⌨️ Keyboard Shortcuts

| Key | Action |
|---|---|
| `V` | Switch between **✦ Morph Mode** and **◐ Hemisphere Dome Mode** |
| `Space` | Play / Pause music |
| `←` / `→` | Seek `-5s` / `+5s` |
| `R` | Reset Dome camera & zoom |
| `+` / `-` / Scroll | Zoom in / out in Dome Mode |
| `M` / `A` | Open **✦ 88 Sky** Constellation Atlas |
| `G` | Open **🪐 Live Sky** Fly-To & Satellite Tracker |
| `S` | Open **⚙ Settings** |
| `D` | Toggle **🔭 Viewing Mode** (live observatory without music) |
| `L` | Cycle lyric display style (`Star` / `Both` / `Bottom` / `Off`) |
| `W` / `B` / `P` / `F` | Window modes: Borderless / Background / Wallpaper / Fullscreen |
| `O` | Open local audio or `.lrc` file (or drag & drop directly onto the window) |
| `[` / `]` | Fine-tune lyric sync offset (`-500ms` / `+500ms`) |

---

## 🛠 Building From Source

Requires **Rust (MSVC toolchain)** on Windows 10/11 (Edge WebView2 runtime is pre-installed on Windows 11 and updated Windows 10):

```powershell
cargo build --release
```

The standalone binary (with all `web/` assets embedded via `include_dir!`) will be built at:
```text
target\release\Astralis.exe
```

Run tests:
```powershell
cargo test
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE).
