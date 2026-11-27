//! Non-Invasive Interactive Desktop Wallpaper Input Observer (Windows 10 & 11).
//!
//! When Astralis is embedded behind desktop icons (`wallpaper` mode), Windows delivers
//! mouse events to `SHELLDLL_DefView` / `SysListView32` instead of the wallpaper HWND.
//! This module installs a lightweight `WH_MOUSE_LL` observer ONLY while in wallpaper mode:
//!   - Caches every desktop icon's screen bounding box on a background thread using the
//!     standard read-only Windows Accessibility API (`IAccessible` via `Oleacc.dll`),
//!     automatically DPI-calibrated against `GetWindowRect(SysListView32)`.
//!   - When clicking, double-clicking, or dragging ANY desktop icon (or right-clicking,
//!     or holding Shift/Ctrl to multi-select), every event passes straight through to
//!     `CallNextHookEx` so icons and apps behave 100% natively.
//!   - When left-dragging or clicking on **empty desktop sky** (outside every icon),
//!     suppresses `WM_LBUTTONDOWN` / matching `WM_LBUTTONUP` from reaching `SysListView32`
//!     so Windows NEVER draws the translucent blue marquee selection box while you spin
//!     the 3D celestial dome!
//!   - Flushes coalesced deltas at up to 60 Hz when active (zero CPU when idle or non-wallpaper).

use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use windows::core::{w, Interface, VARIANT};
use windows::Win32::Foundation::{BOOL, HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Accessibility::{AccessibleObjectFromWindow, IAccessible};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, EnumWindows, FindWindowExW, FindWindowW, GetClassNameW,
    GetMessageW, GetParent, GetSystemMetrics, GetWindowRect, IsWindow, IsWindowVisible,
    PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, WindowFromPoint,
    HHOOK, MSG, MSLLHOOKSTRUCT, OBJID_CLIENT, SM_CXSCREEN, SM_CYSCREEN, WH_MOUSE_LL,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONUP,
};

#[derive(Debug, Clone, Copy, Default)]
pub struct DesktopInputFrame {
    pub nx: f32,
    pub ny: f32,
    pub dx: f32,
    pub dy: f32,
    pub wheel: f32,
    pub dragging: bool,
    pub drag_ended: bool,
    pub clicked: bool,
    pub over_desktop: bool,
}

#[derive(Default)]
struct HookAccum {
    over_desktop: bool,
    lbutton_down: bool,
    swallowed_lbutton: bool,
    dragging: bool,
    down_x: i32,
    down_y: i32,
    last_x: i32,
    last_y: i32,
    nx: f32,
    ny: f32,
    dx: f32,
    dy: f32,
    wheel: f32,
    drag_ended: bool,
    clicked: bool,
    dirty: bool,
}

#[derive(Default)]
struct IconRectCache {
    valid: bool,
    rects: Vec<RECT>,
}

struct SharedHookState {
    active: AtomicBool,
    hwnd_raw: AtomicIsize,
    listview_hwnd: AtomicIsize,
    refresh_icons_now: AtomicBool,
    icon_wake: (Mutex<bool>, Condvar),
    accum: Mutex<HookAccum>,
    icons: Mutex<IconRectCache>,
}

static GLOBAL_HOOK_STATE: OnceLock<Arc<SharedHookState>> = OnceLock::new();

fn global_state() -> &'static Arc<SharedHookState> {
    GLOBAL_HOOK_STATE.get_or_init(|| {
        Arc::new(SharedHookState {
            active: AtomicBool::new(false),
            hwnd_raw: AtomicIsize::new(0),
            listview_hwnd: AtomicIsize::new(0),
            refresh_icons_now: AtomicBool::new(true),
            icon_wake: (Mutex::new(false), Condvar::new()),
            accum: Mutex::new(HookAccum::default()),
            icons: Mutex::new(IconRectCache::default()),
        })
    })
}

fn wake_icon_scanner(st: &SharedHookState) {
    st.refresh_icons_now.store(true, Ordering::Relaxed);
    if let Ok(mut guard) = st.icon_wake.0.try_lock() {
        *guard = true;
        st.icon_wake.1.notify_one();
    }
}

fn get_class_name(hwnd: HWND) -> String {
    if hwnd.0.is_null() {
        return String::new();
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Locate the Windows Desktop's `SysListView32` icon layer (handles both Progman and WorkerW layouts).
fn find_desktop_listview_hwnd(cached_raw: isize) -> Option<HWND> {
    unsafe {
        if cached_raw != 0 {
            let h = HWND(cached_raw as *mut c_void);
            if IsWindow(h).as_bool() && get_class_name(h) == "SysListView32" {
                return Some(h);
            }
        }

        if let Ok(progman) = FindWindowW(w!("Progman"), None) {
            if !progman.0.is_null() {
                if let Ok(defview) =
                    FindWindowExW(progman, HWND::default(), w!("SHELLDLL_DefView"), None)
                {
                    if !defview.0.is_null() {
                        if let Ok(lv) =
                            FindWindowExW(defview, HWND::default(), w!("SysListView32"), None)
                        {
                            if !lv.0.is_null() {
                                return Some(lv);
                            }
                        }
                    }
                }
            }
        }

        let mut found: isize = 0;
        unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            if let Ok(defview) = FindWindowExW(hwnd, HWND::default(), w!("SHELLDLL_DefView"), None)
            {
                if !defview.0.is_null() {
                    if let Ok(lv) =
                        FindWindowExW(defview, HWND::default(), w!("SysListView32"), None)
                    {
                        if !lv.0.is_null() {
                            *(lparam.0 as *mut isize) = lv.0 as isize;
                            return BOOL(0);
                        }
                    }
                }
            }
            BOOL(1)
        }
        let _ = EnumWindows(Some(enum_proc), LPARAM(&mut found as *mut isize as isize));
        if found != 0 {
            Some(HWND(found as *mut c_void))
        } else {
            None
        }
    }
}

/// Query every visible desktop icon's screen bounding box via standard read-only MSAA (`IAccessible`).
/// Automatically calibrates DPI against `GetWindowRect(lv)` so hit rects always match `MSLLHOOKSTRUCT.pt`.
/// Runs ONLY on a background thread (never inside `WH_MOUSE_LL`).
fn scan_desktop_icon_rects(cached_lv: isize) -> Option<Vec<RECT>> {
    let lv = find_desktop_listview_hwnd(cached_lv)?;
    unsafe {
        // If user turned off "Show desktop icons", there are 0 clickable icons -> entire sky is clean!
        if !IsWindowVisible(lv).as_bool() {
            return Some(Vec::new());
        }

        let mut raw_ptr: *mut c_void = std::ptr::null_mut();
        if AccessibleObjectFromWindow(lv, OBJID_CLIENT.0 as u32, &IAccessible::IID, &mut raw_ptr)
            .is_err()
            || raw_ptr.is_null()
        {
            return None;
        }
        let acc = IAccessible::from_raw(raw_ptr);

        // Self-calibrate coordinate space (physical pixels vs logical pixels if DPI differs)
        let mut sx = 1.0f64;
        let mut sy = 1.0f64;
        let mut ox_phys = 0.0f64;
        let mut oy_phys = 0.0f64;
        let mut ox_acc = 0.0f64;
        let mut oy_acc = 0.0f64;
        let mut lv_rect = RECT::default();
        if GetWindowRect(lv, &mut lv_rect).is_ok() {
            let phys_w = (lv_rect.right - lv_rect.left) as f64;
            let phys_h = (lv_rect.bottom - lv_rect.top) as f64;
            let mut ax = 0i32;
            let mut ay = 0i32;
            let mut aw = 0i32;
            let mut ah = 0i32;
            let self_var = VARIANT::from(0i32); // CHILDID_SELF
            if acc
                .accLocation(&mut ax, &mut ay, &mut aw, &mut ah, &self_var)
                .is_ok()
                && aw > 100
                && ah > 100
                && phys_w > 100.0
                && phys_h > 100.0
            {
                let rx = phys_w / (aw as f64);
                let ry = phys_h / (ah as f64);
                if (rx - 1.0).abs() > 0.03 || (ry - 1.0).abs() > 0.03 {
                    sx = rx;
                    sy = ry;
                    ox_phys = lv_rect.left as f64;
                    oy_phys = lv_rect.top as f64;
                    ox_acc = ax as f64;
                    oy_acc = ay as f64;
                }
            }
        }

        let count = acc.accChildCount().ok()?.clamp(0, 512);
        let mut rects = Vec::with_capacity(count as usize);

        for child_id in 1..=count {
            let mut x = 0i32;
            let mut y = 0i32;
            let mut w = 0i32;
            let mut h = 0i32;
            let var_child = VARIANT::from(child_id);
            if acc
                .accLocation(&mut x, &mut y, &mut w, &mut h, &var_child)
                .is_ok()
                && w > 0
                && h > 0
            {
                let left = (ox_phys + ((x as f64) - ox_acc) * sx).round() as i32;
                let top = (oy_phys + ((y as f64) - oy_acc) * sy).round() as i32;
                let pw = ((w as f64) * sx).round() as i32;
                let ph = ((h as f64) * sy).round() as i32;
                // Ignore any malformed container-sized rects; normal desktop icons are <= 420px
                if pw > 0 && ph > 0 && pw <= 420 && ph <= 420 {
                    // Add a 4px cushion around each icon so clicks near icon edges stay native
                    rects.push(RECT {
                        left: left - 4,
                        top: top - 4,
                        right: left + pw + 4,
                        bottom: top + ph + 4,
                    });
                }
            }
        }
        Some(rects)
    }
}

fn rect_contains_point(r: &RECT, pt: POINT) -> bool {
    pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom
}

/// Instant check whether `pt` lies over a cached desktop icon.
/// Returns `None` if the cache is not yet valid or briefly contended (fail-safe: don't swallow!).
fn point_hits_cached_icon(st: &SharedHookState, pt: POINT) -> Option<bool> {
    let cache = st.icons.try_lock().ok()?;
    if !cache.valid {
        return None;
    }
    for r in &cache.rects {
        if rect_contains_point(r, pt) {
            return Some(true);
        }
    }
    Some(false)
}

/// Returns true ONLY when the screen point sits directly over the Windows Desktop
/// (`SysListView32` inside `SHELLDLL_DefView`, `SHELLDLL_DefView`, `Progman`, or `WorkerW`),
/// never when hovering over open apps, Explorer windows, Start Menu, or the Taskbar.
fn is_point_on_desktop(st: &SharedHookState, pt: POINT) -> bool {
    let hwnd = unsafe { WindowFromPoint(pt) };
    if hwnd.0.is_null() {
        return false;
    }
    let cls = get_class_name(hwnd);
    if cls == "SHELLDLL_DefView" || cls == "Progman" || cls == "WorkerW" {
        return true;
    }
    if cls == "SysListView32" {
        if let Ok(parent) = unsafe { GetParent(hwnd) } {
            let pcls = get_class_name(parent);
            if pcls == "SHELLDLL_DefView" {
                let raw = hwnd.0 as isize;
                if st.listview_hwnd.swap(raw, Ordering::Relaxed) != raw {
                    wake_icon_scanner(st);
                }
                return true;
            }
        }
    }
    false
}

fn normalize_point(pt: POINT, hwnd_raw: isize) -> (f32, f32) {
    if hwnd_raw != 0 {
        let mut r = RECT::default();
        if unsafe { GetWindowRect(HWND(hwnd_raw as *mut c_void), &mut r) }.is_ok() {
            let w = (r.right - r.left).max(1) as f32;
            let h = (r.bottom - r.top).max(1) as f32;
            return (
                ((pt.x - r.left) as f32 / w).clamp(0.0, 1.0),
                ((pt.y - r.top) as f32 / h).clamp(0.0, 1.0),
            );
        }
    }
    let sw = unsafe { GetSystemMetrics(SM_CXSCREEN) }.max(1) as f32;
    let sh = unsafe { GetSystemMetrics(SM_CYSCREEN) }.max(1) as f32;
    (
        (pt.x as f32 / sw).clamp(0.0, 1.0),
        (pt.y as f32 / sh).clamp(0.0, 1.0),
    )
}

unsafe extern "system" fn low_level_mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let st = global_state();
        if st.active.load(Ordering::Relaxed) && lparam.0 != 0 {
            let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
            let pt = info.pt;
            let msg = wparam.0 as u32;

            if msg == WM_RBUTTONUP {
                // User may have renamed/deleted/arranged icons via desktop context menu -> refresh icon cache soon!
                wake_icon_scanner(st);
                return CallNextHookEx(HHOOK::default(), code, wparam, lparam);
            }

            if matches!(
                msg,
                WM_MOUSEMOVE | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_MOUSEWHEEL
            ) {
                let on_desk = is_point_on_desktop(st, pt);
                let hwnd_raw = st.hwnd_raw.load(Ordering::Relaxed);
                let (nx, ny) = normalize_point(pt, hwnd_raw);

                if let Ok(mut acc) = st.accum.try_lock() {
                    match msg {
                        WM_MOUSEMOVE => {
                            if acc.swallowed_lbutton && acc.lbutton_down {
                                // Smooth uninterrupted sky drag even if the cursor passes over a window edge!
                                let ddx = (pt.x - acc.last_x) as f32;
                                let ddy = (pt.y - acc.last_y) as f32;
                                if !acc.dragging
                                    && ((pt.x - acc.down_x).abs() > 4
                                        || (pt.y - acc.down_y).abs() > 4)
                                {
                                    acc.dragging = true;
                                }
                                if acc.dragging {
                                    acc.dx += ddx;
                                    acc.dy += ddy;
                                }
                                acc.last_x = pt.x;
                                acc.last_y = pt.y;
                                acc.nx = nx;
                                acc.ny = ny;
                                acc.over_desktop = true;
                                acc.dirty = true;
                            } else if on_desk {
                                acc.over_desktop = true;
                                acc.nx = nx;
                                acc.ny = ny;
                                if acc.lbutton_down {
                                    let ddx = (pt.x - acc.last_x) as f32;
                                    let ddy = (pt.y - acc.last_y) as f32;
                                    if !acc.dragging
                                        && ((pt.x - acc.down_x).abs() > 5
                                            || (pt.y - acc.down_y).abs() > 5)
                                    {
                                        acc.dragging = true;
                                    }
                                    if acc.dragging {
                                        acc.dx += ddx;
                                        acc.dy += ddy;
                                    }
                                }
                                acc.last_x = pt.x;
                                acc.last_y = pt.y;
                                acc.dirty = true;
                            } else if acc.over_desktop || acc.dragging {
                                acc.over_desktop = false;
                                if acc.dragging {
                                    acc.dragging = false;
                                    acc.drag_ended = true;
                                }
                                acc.lbutton_down = false;
                                acc.dirty = true;
                            }
                        }
                        WM_LBUTTONDOWN => {
                            if on_desk {
                                let shift_held =
                                    (GetAsyncKeyState(VK_SHIFT.0 as i32) as u16 & 0x8000) != 0;
                                let ctrl_held =
                                    (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
                                let on_icon = point_hits_cached_icon(st, pt);

                                // If clicking an icon OR holding Shift/Ctrl (for multi-select marquee),
                                // pass straight through to Windows so desktop icons work 100% natively!
                                if shift_held || ctrl_held || on_icon == Some(true) {
                                    acc.lbutton_down = false;
                                    acc.swallowed_lbutton = false;
                                    acc.dragging = false;
                                    wake_icon_scanner(st);
                                } else {
                                    acc.over_desktop = true;
                                    acc.lbutton_down = true;
                                    acc.dragging = false;
                                    acc.down_x = pt.x;
                                    acc.down_y = pt.y;
                                    acc.last_x = pt.x;
                                    acc.last_y = pt.y;
                                    acc.nx = nx;
                                    acc.ny = ny;

                                    // Empty desktop sky verified (not on any icon): swallow WM_LBUTTONDOWN so
                                    // Windows SysListView32 NEVER draws the blue marquee selection rectangle!
                                    if on_icon == Some(false) {
                                        acc.swallowed_lbutton = true;
                                        return LRESULT(1);
                                    } else {
                                        acc.swallowed_lbutton = false;
                                    }
                                }
                            } else {
                                acc.lbutton_down = false;
                                acc.swallowed_lbutton = false;
                                acc.dragging = false;
                            }
                        }
                        WM_LBUTTONUP => {
                            let was_swallowed = acc.swallowed_lbutton;
                            if acc.lbutton_down || was_swallowed {
                                if acc.dragging {
                                    acc.drag_ended = true;
                                } else if on_desk {
                                    acc.clicked = true;
                                    acc.nx = nx;
                                    acc.ny = ny;
                                }
                                acc.lbutton_down = false;
                                acc.swallowed_lbutton = false;
                                acc.dragging = false;
                                acc.dirty = true;
                                if was_swallowed {
                                    return LRESULT(1);
                                }
                            } else if on_desk {
                                // User may have finished dragging a desktop icon -> refresh cached icon rects
                                wake_icon_scanner(st);
                            }
                        }
                        WM_MOUSEWHEEL => {
                            // Leave Ctrl+Scroll untouched for Windows desktop icon resizing!
                            let ctrl_held =
                                (GetAsyncKeyState(VK_CONTROL.0 as i32) as u16 & 0x8000) != 0;
                            if on_desk && !ctrl_held {
                                let delta_raw = ((info.mouseData >> 16) & 0xFFFF) as i16;
                                acc.wheel += delta_raw as f32 / 120.0;
                                acc.over_desktop = true;
                                acc.nx = nx;
                                acc.ny = ny;
                                acc.dirty = true;
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

pub struct DesktopInputWatcher {
    stop_flag: Arc<AtomicBool>,
    hook_thread_id: Arc<Mutex<Option<u32>>>,
}

impl DesktopInputWatcher {
    pub fn start<F>(hwnd_raw: isize, on_frame: F) -> Self
    where
        F: Fn(DesktopInputFrame) + Send + 'static,
    {
        let st = global_state();
        st.hwnd_raw.store(hwnd_raw, Ordering::Relaxed);
        let stop_flag = Arc::new(AtomicBool::new(false));
        let hook_thread_id = Arc::new(Mutex::new(None));

        // 1. Dedicated Win32 message-pump thread hosting the WH_MOUSE_LL hook
        let tid_store = Arc::clone(&hook_thread_id);
        let stop_hook = Arc::clone(&stop_flag);
        thread::Builder::new()
            .name("AstralisDesktopHook".into())
            .spawn(move || unsafe {
                let tid = windows::Win32::System::Threading::GetCurrentThreadId();
                if let Ok(mut guard) = tid_store.lock() {
                    *guard = Some(tid);
                }
                if stop_hook.load(Ordering::Relaxed) {
                    return;
                }
                let hook = SetWindowsHookExW(
                    WH_MOUSE_LL,
                    Some(low_level_mouse_proc),
                    HINSTANCE::default(),
                    0,
                );
                let Ok(hhook) = hook else {
                    return;
                };

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                    if stop_hook.load(Ordering::Relaxed) {
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                let _ = UnhookWindowsHookEx(hhook);
            })
            .ok();

        // 2. Background desktop icon bounding-box scanner (COM STA thread; never blocks WH_MOUSE_LL!)
        let stop_icons = Arc::clone(&stop_flag);
        thread::Builder::new()
            .name("AstralisDesktopIcons".into())
            .spawn(move || {
                let com_ok = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
                let st = global_state();
                let mut last_scan = Instant::now() - Duration::from_secs(10);

                while !stop_icons.load(Ordering::Relaxed) {
                    if !st.active.load(Ordering::Relaxed) {
                        if let Ok(guard) = st.icon_wake.0.lock() {
                            let _ = st.icon_wake.1.wait_timeout(guard, Duration::from_millis(300));
                        }
                        continue;
                    }
                    let forced = st.refresh_icons_now.swap(false, Ordering::Relaxed);
                    if forced || last_scan.elapsed() >= Duration::from_millis(1200) {
                        last_scan = Instant::now();
                        let lv_cached = st.listview_hwnd.load(Ordering::Relaxed);
                        match scan_desktop_icon_rects(lv_cached) {
                            Some(rects) => {
                                if let Ok(mut cache) = st.icons.lock() {
                                    cache.rects = rects;
                                    cache.valid = true;
                                }
                            }
                            None => {
                                if let Ok(mut cache) = st.icons.lock() {
                                    cache.valid = false;
                                }
                            }
                        }
                    }
                    if !st.refresh_icons_now.load(Ordering::Relaxed) {
                        if let Ok(guard) = st.icon_wake.0.lock() {
                            let _ = st.icon_wake.1.wait_timeout(guard, Duration::from_millis(200));
                        }
                    }
                }

                if com_ok {
                    unsafe { CoUninitialize() };
                }
            })
            .ok();

        // 3. Coalescing 60 Hz flusher thread (sleeps 220ms when not in wallpaper mode!)
        let stop_flush = Arc::clone(&stop_flag);
        thread::Builder::new()
            .name("AstralisDesktopFlush".into())
            .spawn(move || {
                let st = global_state();
                while !stop_flush.load(Ordering::Relaxed) {
                    if !st.active.load(Ordering::Relaxed) {
                        thread::sleep(Duration::from_millis(220));
                        continue;
                    }
                    let maybe_frame = if let Ok(mut acc) = st.accum.lock() {
                        if acc.dirty {
                            let frame = DesktopInputFrame {
                                nx: acc.nx,
                                ny: acc.ny,
                                dx: acc.dx,
                                dy: acc.dy,
                                wheel: acc.wheel,
                                dragging: acc.dragging,
                                drag_ended: acc.drag_ended,
                                clicked: acc.clicked,
                                over_desktop: acc.over_desktop,
                            };
                            acc.dx = 0.0;
                            acc.dy = 0.0;
                            acc.wheel = 0.0;
                            acc.drag_ended = false;
                            acc.clicked = false;
                            acc.dirty = false;
                            Some(frame)
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    if let Some(frame) = maybe_frame {
                        on_frame(frame);
                    }
                    thread::sleep(Duration::from_millis(16));
                }
            })
            .ok();

        Self {
            stop_flag,
            hook_thread_id,
        }
    }

    pub fn set_active(&self, active: bool) {
        let st = global_state();
        st.active.store(active, Ordering::Relaxed);
        if active {
            wake_icon_scanner(st);
        } else if let Ok(mut acc) = st.accum.lock() {
            acc.lbutton_down = false;
            acc.swallowed_lbutton = false;
            acc.dragging = false;
            acc.over_desktop = false;
            acc.dx = 0.0;
            acc.dy = 0.0;
            acc.wheel = 0.0;
            acc.dirty = false;
        }
    }

    pub fn stop(&self) {
        self.set_active(false);
        self.stop_flag.store(true, Ordering::Relaxed);
        wake_icon_scanner(global_state());
        if let Ok(guard) = self.hook_thread_id.lock() {
            if let Some(tid) = *guard {
                unsafe {
                    let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_icon_rect_hit_detection() {
        let r = RECT {
            left: 10,
            top: 20,
            right: 90,
            bottom: 110,
        };
        assert!(rect_contains_point(&r, POINT { x: 50, y: 60 }));
        assert!(rect_contains_point(&r, POINT { x: 10, y: 20 }));
        assert!(!rect_contains_point(&r, POINT { x: 95, y: 60 }));
        assert!(!rect_contains_point(&r, POINT { x: 50, y: 5 }));
    }
}
