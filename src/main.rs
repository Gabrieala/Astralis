#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_wasapi;
mod celestial;
mod lyrics;
mod media_smtc;
mod window_mgr;

use audio_wasapi::AudioAnalyzer;
use celestial::LiveCelestialFeed;
use include_dir::{include_dir, Dir};
use lyrics::{parse_lrc, LyricsEngine};
use media_smtc::MediaWatcher;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::platform::windows::WindowExtWindows;
use tao::window::WindowBuilder;
use tiny_http::{Header, Method, Response, Server, StatusCode};
use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem};
use tray_icon::{Icon as TrayIconImg, TrayIconBuilder};
use window_mgr::WindowController;
use wry::WebViewBuilder;

const APP_TITLE: &str = "Astralis - Constellation Visualizer";
static EMBEDDED_WEB: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/web");

#[allow(dead_code)]
#[derive(Debug, Clone)]
enum UserEvent {
    SetMode(String),
    SetClickThrough(bool),
    ToggleClickThrough,
    MinimizeToTray,
    ShowWindow,
    StartDrag,
    Quit,
    TrayMenu(MenuId),
}

struct WindowStatusCache {
    mode: String,
    click_through: bool,
    focused: bool,
    minimized: bool,
}

fn resolve_cache_dir() -> PathBuf {
    // Prefer local ./cache in portable/dev folder when writable; else %LOCALAPPDATA%\Astralis\cache
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // If running from target/release or target/debug, check project root two levels up
            let project_root = dir
                .parent()
                .and_then(|p| p.parent())
                .filter(|root| root.join("Cargo.toml").exists());
            let base = project_root.unwrap_or(dir);
            let local_cache = base.join("cache");
            if fs::create_dir_all(&local_cache).is_ok() {
                return local_cache;
            }
        }
    }
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        let fallback = PathBuf::from(local_app).join("Astralis").join("cache");
        let _ = fs::create_dir_all(&fallback);
        return fallback;
    }
    PathBuf::from("cache")
}

fn resolve_dev_web_dir() -> Option<PathBuf> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let direct = dir.join("web");
            if direct.join("index.html").exists() {
                return Some(direct);
            }
            if let Some(root) = dir.parent().and_then(|p| p.parent()) {
                let dev = root.join("web");
                if dev.join("index.html").exists() {
                    return Some(dev);
                }
            }
        }
    }
    let cwd = PathBuf::from("web");
    if cwd.join("index.html").exists() {
        return Some(cwd);
    }
    None
}

/// Generate a crisp 32×32 RGBA celestial star crest for the Windows tray & window icon.
fn build_star_icon_rgba(size: u32) -> (Vec<u8>, u32, u32) {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let c = (size as f32 - 1.0) * 0.5;
    let max_r = size as f32 * 0.46;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 - c;
            let dy = y as f32 - c;
            let r = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;

            if r > max_r + 1.0 {
                rgba[idx + 3] = 0;
                continue;
            }

            // Deep obsidian badge with sapphire border ring
            let mut cr = 10.0f32;
            let mut cg = 18.0f32;
            let mut cb = 44.0f32;
            let mut ca = 255.0f32;

            if r > max_r - 1.6 {
                let ring = (1.0 - (r - (max_r - 1.6)).abs() / 1.8).clamp(0.0, 1.0);
                cr = 10.0 + ring * 115.0;
                cg = 18.0 + ring * 172.0;
                cb = 44.0 + ring * 211.0;
                ca = ((max_r + 0.8 - r).clamp(0.0, 1.0)) * 255.0;
            }

            // 4-point celestial star silhouette in center
            let ax = dx.abs() / max_r;
            let ay = dy.abs() / max_r;
            let star_metric = ax.powf(0.58) + ay.powf(0.58);
            if star_metric < 0.84 {
                let s = ((0.84 - star_metric) / 0.24).clamp(0.0, 1.0);
                cr = cr * (1.0 - s) + 230.0 * s;
                cg = cg * (1.0 - s) + 244.0 * s;
                cb = cb * (1.0 - s) + 255.0 * s;
            }

            // Glowing white core
            let core = (-((r / max_r) * 3.8).powi(2)).exp();
            cr = (cr + core * 140.0).min(255.0);
            cg = (cg + core * 140.0).min(255.0);
            cb = (cb + core * 140.0).min(255.0);

            rgba[idx] = cr as u8;
            rgba[idx + 1] = cg as u8;
            rgba[idx + 2] = cb as u8;
            rgba[idx + 3] = ca as u8;
        }
    }
    (rgba, size, size)
}

fn content_type_for(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if lower.ends_with(".js") || lower.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if lower.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if lower.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".ico") {
        "image/x-icon"
    } else {
        "application/octet-stream"
    }
}

fn read_static_asset(rel_path: &str, dev_web: Option<&Path>) -> Option<Vec<u8>> {
    let clean = rel_path.trim_start_matches('/');
    let target = if clean.is_empty() { "index.html" } else { clean };
    if target.contains("..") {
        return None;
    }

    // Prefer live disk files in dev workspace so edits reflect immediately without recompiling!
    if let Some(dir) = dev_web {
        let disk_path = dir.join(target);
        if disk_path.is_file() {
            if let Ok(bytes) = fs::read(&disk_path) {
                return Some(bytes);
            }
        }
    }

    EMBEDDED_WEB.get_file(target).map(|f| f.contents().to_vec())
}

fn json_response(value: &serde_json::Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    let mut resp = Response::from_data(body).with_status_code(StatusCode(status));
    if let Ok(h) = Header::from_bytes("Content-Type", "application/json; charset=utf-8") {
        resp.add_header(h);
    }
    if let Ok(h) = Header::from_bytes("Cache-Control", "no-store") {
        resp.add_header(h);
    }
    resp
}

#[allow(clippy::too_many_arguments)]
fn start_http_server(
    media: Arc<MediaWatcher>,
    audio: Arc<AudioAnalyzer>,
    lyrics: Arc<LyricsEngine>,
    celestial: Arc<LiveCelestialFeed>,
    win_status: Arc<Mutex<WindowStatusCache>>,
    proxy: EventLoopProxy<UserEvent>,
    dev_web: Option<PathBuf>,
) -> u16 {
    let server = Server::http("127.0.0.1:0").expect("Failed to bind local Astralis HTTP server");
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);

    thread::Builder::new()
        .name("AstralisHTTP".into())
        .spawn(move || {
            for mut req in server.incoming_requests() {
                let media = Arc::clone(&media);
                let audio = Arc::clone(&audio);
                let lyrics = Arc::clone(&lyrics);
                let celestial = Arc::clone(&celestial);
                let win_status = Arc::clone(&win_status);
                let proxy = proxy.clone();
                let dev_web = dev_web.clone();

                // Handle each request swiftly in a tiny scoped worker if it's a slow network lookup,
                // or inline for instant local endpoints (<0.2ms)!
                let raw_url = req.url().to_string();
                let path = raw_url.split('?').next().unwrap_or("/").to_string();
                let method = req.method().clone();

                if method == Method::Post && path == "/api/search_lyrics" {
                    thread::spawn(move || {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let title = body.get("title").and_then(|v| v.as_str()).unwrap_or("");
                        let artist = body.get("artist").and_then(|v| v.as_str()).unwrap_or("");
                        let res = lyrics.fetch_lyrics(title, artist, "", 0);
                        let _ = req.respond(json_response(&json!(res), 200));
                    });
                    continue;
                }

                match (method, path.as_str()) {
                    (Method::Get, "/api/audio") => {
                        let a = audio.get_metrics();
                        let _ = req.respond(json_response(&json!(a), 200));
                    }
                    (Method::Get, "/api/state") => {
                        let m = media.get_snapshot();
                        let a = audio.get_metrics();
                        let w = win_status.lock().unwrap();
                        let payload = json!({
                            "media": m,
                            "audio": a,
                            "window": {
                                "mode": w.mode,
                                "click_through": w.click_through,
                                "focused": w.focused,
                                "minimized": w.minimized,
                            }
                        });
                        let _ = req.respond(json_response(&payload, 200));
                    }
                    (Method::Get, "/api/lyrics") => {
                        let lyr = media.get_lyrics();
                        let _ = req.respond(json_response(&json!(lyr), 200));
                    }
                    (Method::Get, "/api/celestial") => {
                        let data = celestial.get_data();
                        let _ = req.respond(json_response(&json!(data), 200));
                    }
                    (Method::Post, "/api/mode") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let mode = body
                            .get("mode")
                            .and_then(|v| v.as_str())
                            .unwrap_or("borderless")
                            .to_string();
                        let _ = proxy.send_event(UserEvent::SetMode(mode.clone()));
                        let _ = req.respond(json_response(&json!({ "mode": mode }), 200));
                    }
                    (Method::Post, "/api/click_through") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(false);
                        let _ = proxy.send_event(UserEvent::SetClickThrough(enabled));
                        let _ = req.respond(json_response(&json!({ "enabled": enabled }), 200));
                    }
                    (Method::Post, "/api/audio_reactive") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);
                        audio.set_enabled(enabled);
                        let _ = req.respond(json_response(&json!({ "enabled": audio.is_enabled() }), 200));
                    }
                    (Method::Post, "/api/lyrics_provider") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let provider = body
                            .get("provider")
                            .and_then(|v| v.as_str())
                            .unwrap_or("auto");
                        let applied = lyrics.set_provider_mode(provider);
                        media.force_refetch_lyrics();
                        let _ = req.respond(json_response(&json!({ "provider": applied }), 200));
                    }
                    (Method::Post, "/api/parse_lrc") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let lrc_text = body.get("lrc_text").and_then(|v| v.as_str()).unwrap_or("");
                        let dur_ms = body.get("duration_ms").and_then(|v| v.as_i64()).unwrap_or(0);
                        let lines = parse_lrc(lrc_text, dur_ms);
                        let _ = req.respond(json_response(&json!({ "lines": lines }), 200));
                    }
                    (Method::Post, "/api/media_control") => {
                        let mut body_str = String::new();
                        let _ = req.as_reader().read_to_string(&mut body_str);
                        let body: serde_json::Value =
                            serde_json::from_str(&body_str).unwrap_or_else(|_| json!({}));
                        let action = body.get("action").and_then(|v| v.as_str()).unwrap_or("");
                        let pos_ms = body.get("position_ms").and_then(|v| v.as_i64());
                        let ok = media.send_command(action, pos_ms);
                        let _ = req.respond(json_response(&json!({ "ok": ok }), 200));
                    }
                    (Method::Post, "/api/drag") => {
                        let _ = proxy.send_event(UserEvent::StartDrag);
                        let _ = req.respond(json_response(&json!({ "ok": true }), 200));
                    }
                    (Method::Post, "/api/minimize") => {
                        let _ = proxy.send_event(UserEvent::MinimizeToTray);
                        let _ = req.respond(json_response(&json!({ "ok": true }), 200));
                    }
                    (Method::Post, "/api/quit") => {
                        let _ = req.respond(json_response(&json!({ "ok": true }), 200));
                        let _ = proxy.send_event(UserEvent::Quit);
                    }
                    (Method::Get, static_path) => {
                        if let Some(bytes) = read_static_asset(static_path, dev_web.as_deref()) {
                            let mut resp = Response::from_data(bytes);
                            if let Ok(h) = Header::from_bytes("Content-Type", content_type_for(static_path)) {
                                resp.add_header(h);
                            }
                            let _ = req.respond(resp);
                        } else {
                            let _ = req.respond(json_response(&json!({ "error": "not_found" }), 404));
                        }
                    }
                    _ => {
                        let _ = req.respond(json_response(&json!({ "error": "not_found" }), 404));
                    }
                }
            }
        })
        .ok();

    port
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let debug_mode = args.iter().any(|a| a == "--debug");
    let start_mode = if args.iter().any(|a| a == "--wallpaper") {
        "wallpaper"
    } else if args.iter().any(|a| a == "--background") {
        "background"
    } else if args.iter().any(|a| a == "--fullscreen") {
        "fullscreen"
    } else {
        "borderless"
    };

    let cache_dir = resolve_cache_dir();
    let dev_web = resolve_dev_web_dir();

    let lyrics_engine = Arc::new(LyricsEngine::new(cache_dir.join("lyrics")));
    let media_watcher = Arc::new(MediaWatcher::new(Arc::clone(&lyrics_engine)));
    let audio_analyzer = Arc::new(AudioAnalyzer::new());
    let celestial_feed = Arc::new(LiveCelestialFeed::new(cache_dir.join("celestial_satellites.json")));

    media_watcher.start();
    audio_analyzer.start();
    celestial_feed.start_background_refresh();

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let (win_rgba, win_w, win_h) = build_star_icon_rgba(32);
    let tao_icon = tao::window::Icon::from_rgba(win_rgba.clone(), win_w, win_h).ok();

    let window = WindowBuilder::new()
        .with_title(APP_TITLE)
        .with_inner_size(LogicalSize::new(1240.0, 740.0))
        .with_min_inner_size(LogicalSize::new(640.0, 400.0))
        .with_decorations(false)
        .with_resizable(true)
        .with_window_icon(tao_icon)
        .build(&event_loop)
        .expect("Failed to create Astralis window");

    let hwnd_raw = window.hwnd();
    let mut win_ctrl = WindowController::new(hwnd_raw);

    let win_status = Arc::new(Mutex::new(WindowStatusCache {
        mode: start_mode.to_string(),
        click_through: false,
        focused: true,
        minimized: false,
    }));

    // Periodically refresh focus/minimized flags so /api/state stays 100% lock-free & accurate
    let status_poller = Arc::clone(&win_status);
    thread::Builder::new()
        .name("AstralisWinFocus".into())
        .spawn(move || loop {
            let focused = window_mgr::is_hwnd_focused(hwnd_raw);
            let minimized = window_mgr::is_hwnd_minimized(hwnd_raw);
            if let Ok(mut s) = status_poller.lock() {
                s.focused = focused;
                s.minimized = minimized;
            }
            thread::sleep(Duration::from_millis(250));
        })
        .ok();

    let port = start_http_server(
        Arc::clone(&media_watcher),
        Arc::clone(&audio_analyzer),
        Arc::clone(&lyrics_engine),
        Arc::clone(&celestial_feed),
        Arc::clone(&win_status),
        proxy.clone(),
        dev_web,
    );

    let url = format!("http://127.0.0.1:{}/index.html", port);
    let _webview = WebViewBuilder::new()
        .with_url(&url)
        .with_background_color((1, 2, 7, 255))
        .with_devtools(debug_mode)
        .build(&window)
        .expect("Failed to initialize Edge WebView2");

    // Apply requested startup window mode (--background / --wallpaper / --fullscreen)
    if start_mode != "borderless" {
        let applied = win_ctrl.set_mode(start_mode);
        if let Ok(mut s) = win_status.lock() {
            s.mode = applied;
        }
    }

    // Native Windows System Tray Icon & Context Menu
    let tray_menu = Menu::new();
    let item_borderless = MenuItem::new("Show Borderless Window", true, None);
    let item_bg = MenuItem::new("Background Layer (Behind Apps)", true, None);
    let item_wall = MenuItem::new("Live Desktop Wallpaper (Behind Icons)", true, None);
    let item_full = MenuItem::new("Fullscreen", true, None);
    let item_ghost = MenuItem::new("Toggle Click-Through Ghost Mode", true, None);
    let item_audio = MenuItem::new("Toggle System Audio Reactivity", true, None);
    let item_hide = MenuItem::new("Hide to Tray", true, None);
    let item_quit = MenuItem::new("Quit Astralis", true, None);

    let id_borderless = item_borderless.id().clone();
    let id_bg = item_bg.id().clone();
    let id_wall = item_wall.id().clone();
    let id_full = item_full.id().clone();
    let id_ghost = item_ghost.id().clone();
    let id_audio = item_audio.id().clone();
    let id_hide = item_hide.id().clone();
    let id_quit = item_quit.id().clone();

    let _ = tray_menu.append_items(&[
        &item_borderless,
        &item_bg,
        &item_wall,
        &item_full,
        &PredefinedMenuItem::separator(),
        &item_ghost,
        &item_audio,
        &PredefinedMenuItem::separator(),
        &item_hide,
        &item_quit,
    ]);

    let tray_img = TrayIconImg::from_rgba(win_rgba, win_w, win_h).ok();
    let mut tray_builder = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("Astralis — Celestial Observatory & Music Visualizer");
    if let Some(img) = tray_img {
        tray_builder = tray_builder.with_icon(img);
    }
    let _tray = tray_builder.build().ok();

    // Forward tray menu clicks into the main Win32 event loop
    let tray_proxy = proxy.clone();
    MenuEvent::set_event_handler(Some(move |ev: MenuEvent| {
        let _ = tray_proxy.send_event(UserEvent::TrayMenu(ev.id));
    }));

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                win_ctrl.cleanup();
                media_watcher.stop();
                audio_analyzer.stop();
                celestial_feed.stop();
                *control_flow = ControlFlow::Exit;
            }
            Event::UserEvent(ev) => match ev {
                UserEvent::SetMode(m) => {
                    let applied = win_ctrl.set_mode(&m);
                    if let Ok(mut s) = win_status.lock() {
                        s.mode = applied;
                    }
                }
                UserEvent::SetClickThrough(en) => {
                    let applied = win_ctrl.set_click_through(en);
                    if let Ok(mut s) = win_status.lock() {
                        s.click_through = applied;
                    }
                }
                UserEvent::ToggleClickThrough => {
                    let next = !win_ctrl.click_through;
                    let applied = win_ctrl.set_click_through(next);
                    if let Ok(mut s) = win_status.lock() {
                        s.click_through = applied;
                    }
                }
                UserEvent::MinimizeToTray => {
                    win_ctrl.hide_window();
                }
                UserEvent::ShowWindow => {
                    win_ctrl.show_window();
                }
                UserEvent::StartDrag => {
                    if win_ctrl.mode == "borderless" {
                        let _ = window.drag_window();
                    }
                }
                UserEvent::Quit => {
                    win_ctrl.cleanup();
                    media_watcher.stop();
                    audio_analyzer.stop();
                    celestial_feed.stop();
                    *control_flow = ControlFlow::Exit;
                }
                UserEvent::TrayMenu(id) => {
                    if id == id_borderless {
                        win_ctrl.show_window();
                        let applied = win_ctrl.set_mode("borderless");
                        if let Ok(mut s) = win_status.lock() {
                            s.mode = applied;
                        }
                    } else if id == id_bg {
                        win_ctrl.show_window();
                        let applied = win_ctrl.set_mode("background");
                        if let Ok(mut s) = win_status.lock() {
                            s.mode = applied;
                        }
                    } else if id == id_wall {
                        win_ctrl.show_window();
                        let applied = win_ctrl.set_mode("wallpaper");
                        if let Ok(mut s) = win_status.lock() {
                            s.mode = applied;
                        }
                    } else if id == id_full {
                        win_ctrl.show_window();
                        let applied = win_ctrl.set_mode("fullscreen");
                        if let Ok(mut s) = win_status.lock() {
                            s.mode = applied;
                        }
                    } else if id == id_ghost {
                        let next = !win_ctrl.click_through;
                        let applied = win_ctrl.set_click_through(next);
                        if let Ok(mut s) = win_status.lock() {
                            s.click_through = applied;
                        }
                    } else if id == id_audio {
                        audio_analyzer.set_enabled(!audio_analyzer.is_enabled());
                    } else if id == id_hide {
                        win_ctrl.hide_window();
                    } else if id == id_quit {
                        win_ctrl.cleanup();
                        media_watcher.stop();
                        audio_analyzer.stop();
                        celestial_feed.stop();
                        *control_flow = ControlFlow::Exit;
                    }
                }
            },
            _ => {}
        }
    });
}
