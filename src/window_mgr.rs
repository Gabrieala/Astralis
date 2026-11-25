//! Native Win32 Window Manager for Astralis (Windows 10 & Windows 11 24H2/26H1+).
//!
//! Directly manipulates the `tao` Win32 HWND on the UI event-loop thread:
//!   - Borderless floating window (with native frameless drag)
//!   - Background layer (bottom-pinned behind all apps)
//!   - Live Desktop Wallpaper (Win11 Raised Desktop Progman below SHELLDLL_DefView + classic WorkerW)
//!   - Fullscreen
//!   - Click-Through Ghost Mode (WS_EX_TRANSPARENT | WS_EX_LAYERED)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{RedrawWindow, RDW_ALLCHILDREN, RDW_ERASE, RDW_INVALIDATE, RDW_UPDATENOW};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetForegroundWindow, GetSystemMetrics,
    GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible, SendMessageTimeoutW, SetParent,
    SetWindowLongPtrW, SetWindowPos, ShowWindow, SystemParametersInfoW, GWL_EXSTYLE, HWND_BOTTOM,
    HWND_NOTOPMOST, HWND_TOP, LWA_ALPHA, SET_WINDOW_POS_FLAGS, SMTO_NORMAL, SM_CXSCREEN,
    SM_CYSCREEN, SPI_GETWORKAREA, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_HIDE, SW_RESTORE, SW_SHOW,
    SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, SetLayeredWindowAttributes,
};

fn wide_str(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn is_hwnd_focused(hwnd_raw: isize) -> bool {
    let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
    unsafe { GetForegroundWindow() == hwnd }
}

pub fn is_hwnd_minimized(hwnd_raw: isize) -> bool {
    let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
    unsafe { IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() }
}

pub fn get_screen_size() -> (i32, i32) {
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}

pub fn get_work_area() -> (i32, i32, i32, i32) {
    unsafe {
        let mut r = RECT::default();
        let _ = SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut r as *mut _ as *mut _),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        );
        (r.left, r.top, r.right - r.left, r.bottom - r.top)
    }
}

struct EnumState {
    workerw: Option<HWND>,
}

unsafe extern "system" fn enum_windows_cb(tophandle: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut EnumState);
    let defview_cls = wide_str("SHELLDLL_DefView");
    let worker_cls = wide_str("WorkerW");
    if let Ok(defview) = FindWindowExW(tophandle, HWND(std::ptr::null_mut()), PCWSTR(defview_cls.as_ptr()), PCWSTR::null()) {
        if !defview.0.is_null() {
            if let Ok(w) = FindWindowExW(HWND(std::ptr::null_mut()), tophandle, PCWSTR(worker_cls.as_ptr()), PCWSTR::null()) {
                if !w.0.is_null() {
                    state.workerw = Some(w);
                    return BOOL(0);
                }
            }
        }
    }
    BOOL(1)
}

/// Locate Windows desktop wallpaper host behind desktop icons:
///   - Win10 / Win11 <=23H2: top-level WorkerW sibling behind SHELLDLL_DefView
///   - Win11 24H2/25H2/26H1+: Progman parent placed immediately beneath SHELLDLL_DefView
fn find_wallpaper_host() -> Option<(HWND, HWND)> {
    unsafe {
        let progman_cls = wide_str("Progman");
        let progman = FindWindowW(PCWSTR(progman_cls.as_ptr()), PCWSTR::null()).ok()?;
        if progman.0.is_null() {
            return None;
        }

        let mut res: usize = 0;
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut res));
        let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut res));

        // 1. Classic top-level WorkerW sibling
        let mut enum_state = EnumState { workerw: None };
        let _ = EnumWindows(Some(enum_windows_cb), LPARAM(&mut enum_state as *mut _ as isize));
        if let Some(w) = enum_state.workerw {
            return Some((w, HWND_TOP));
        }

        // 2. Windows 11 24H2/25H2/26H1+ Raised Desktop (SHELLDLL_DefView inside Progman)
        let defview_cls = wide_str("SHELLDLL_DefView");
        if let Ok(defview) = FindWindowExW(progman, HWND(std::ptr::null_mut()), PCWSTR(defview_cls.as_ptr()), PCWSTR::null()) {
            if !defview.0.is_null() {
                return Some((progman, defview));
            }
        }

        let worker_cls = wide_str("WorkerW");
        if let Ok(worker_child) = FindWindowExW(progman, HWND(std::ptr::null_mut()), PCWSTR(worker_cls.as_ptr()), PCWSTR::null()) {
            if !worker_child.0.is_null() {
                return Some((worker_child, HWND_TOP));
            }
        }
        None
    }
}

pub struct WindowController {
    hwnd: HWND,
    pub mode: String,
    pub click_through: bool,
    saved_bounds: (i32, i32, i32, i32),
    wallpaper_parent: Option<HWND>,
    bg_pin_active: Arc<AtomicBool>,
}

impl WindowController {
    pub fn new(hwnd_raw: isize) -> Self {
        let hwnd = HWND(hwnd_raw as *mut std::ffi::c_void);
        let mut rect = RECT::default();
        unsafe {
            let _ = GetWindowRect(hwnd, &mut rect);
        }
        let w = (rect.right - rect.left).max(960);
        let h = (rect.bottom - rect.top).max(600);
        let bg_pin_active = Arc::new(AtomicBool::new(false));

        // Lightweight bottom-pin loop for "background" mode (never blocks UI thread!)
        let pin_flag = Arc::clone(&bg_pin_active);
        thread::Builder::new()
            .name("AstralisBottomPin".into())
            .spawn(move || loop {
                if pin_flag.load(Ordering::Relaxed) {
                    unsafe {
                        let _ = SetWindowPos(
                            HWND(hwnd_raw as *mut std::ffi::c_void),
                            HWND_BOTTOM,
                            0,
                            0,
                            0,
                            0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS,
                        );
                    }
                }
                thread::sleep(Duration::from_millis(550));
            })
            .ok();

        Self {
            hwnd,
            mode: "borderless".into(),
            click_through: false,
            saved_bounds: (rect.left, rect.top, w, h),
            wallpaper_parent: None,
            bg_pin_active,
        }
    }

    #[allow(dead_code)]
    pub fn is_focused(&self) -> bool {
        unsafe { GetForegroundWindow() == self.hwnd }
    }

    #[allow(dead_code)]
    pub fn is_minimized(&self) -> bool {
        unsafe { IsIconic(self.hwnd).as_bool() || !IsWindowVisible(self.hwnd).as_bool() }
    }

    pub fn hide_window(&self) {
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
    }

    pub fn show_window(&self) {
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_RESTORE);
            let _ = ShowWindow(self.hwnd, SW_SHOW);
        }
    }

    fn detach_wallpaper(&mut self) {
        if let Some(old_parent) = self.wallpaper_parent.take() {
            unsafe {
                let _ = SetParent(self.hwnd, HWND(std::ptr::null_mut()));
                let _ = RedrawWindow(
                    old_parent,
                    None,
                    None,
                    RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW,
                );
            }
        }
    }

    fn apply_ex_style(&self, tool_window: bool, no_activate: bool, layered: bool, transparent: bool) {
        unsafe {
            let mut ex = GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE);
            let mask_off = (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0 | WS_EX_TRANSPARENT.0) as isize;
            ex &= !mask_off;
            if tool_window {
                ex |= WS_EX_TOOLWINDOW.0 as isize;
                ex &= !(WS_EX_APPWINDOW.0 as isize);
            } else {
                ex |= WS_EX_APPWINDOW.0 as isize;
            }
            if no_activate {
                ex |= WS_EX_NOACTIVATE.0 as isize;
            }
            if layered || transparent {
                ex |= WS_EX_LAYERED.0 as isize;
            }
            if transparent {
                ex |= WS_EX_TRANSPARENT.0 as isize;
            }
            SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, ex);
            if layered || transparent {
                let _ = SetLayeredWindowAttributes(self.hwnd, windows::Win32::Foundation::COLORREF(0), 255, LWA_ALPHA);
            }
            let _ = SetWindowPos(
                self.hwnd,
                HWND(std::ptr::null_mut()),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        }
    }

    pub fn set_click_through(&mut self, enabled: bool) -> bool {
        self.click_through = enabled;
        let is_bg = self.mode == "background" || self.mode == "wallpaper";
        self.apply_ex_style(is_bg, is_bg, enabled || self.mode == "wallpaper", enabled);
        self.click_through
    }

    pub fn set_mode(&mut self, requested: &str) -> String {
        let mode = match requested {
            "borderless" | "background" | "wallpaper" | "fullscreen" => requested,
            _ => "borderless",
        };

        // Save current floating bounds before leaving borderless
        if self.mode == "borderless" && mode != "borderless" {
            unsafe {
                let mut r = RECT::default();
                if GetWindowRect(self.hwnd, &mut r).is_ok() {
                    let w = r.right - r.left;
                    let h = r.bottom - r.top;
                    if w >= 480 && h >= 320 {
                        self.saved_bounds = (r.left, r.top, w, h);
                    }
                }
            }
        }

        self.bg_pin_active.store(false, Ordering::Relaxed);
        if self.mode == "wallpaper" && mode != "wallpaper" {
            self.detach_wallpaper();
        }

        let (sw, sh) = get_screen_size();
        let (wx, wy, ww, wh) = get_work_area();

        match mode {
            "borderless" => {
                self.apply_ex_style(false, false, self.click_through, self.click_through);
                let (x, y, w, h) = self.saved_bounds;
                unsafe {
                    let _ = ShowWindow(self.hwnd, SW_SHOW);
                    let _ = SetWindowPos(
                        self.hwnd,
                        HWND_NOTOPMOST,
                        x,
                        y,
                        w,
                        h,
                        SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                    );
                }
                self.mode = "borderless".into();
            }
            "fullscreen" => {
                self.apply_ex_style(false, false, self.click_through, self.click_through);
                unsafe {
                    let _ = ShowWindow(self.hwnd, SW_SHOW);
                    let _ = SetWindowPos(
                        self.hwnd,
                        HWND_TOP,
                        0,
                        0,
                        sw,
                        sh,
                        SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                    );
                }
                self.mode = "fullscreen".into();
            }
            "background" => {
                self.apply_ex_style(true, true, self.click_through, self.click_through);
                unsafe {
                    let _ = ShowWindow(self.hwnd, SW_SHOW);
                    let _ = SetWindowPos(
                        self.hwnd,
                        HWND_BOTTOM,
                        wx,
                        wy,
                        ww,
                        wh,
                        SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
                    );
                }
                self.mode = "background".into();
                self.bg_pin_active.store(true, Ordering::Relaxed);
            }
            "wallpaper" => {
                if let Some((host, insert_after)) = find_wallpaper_host() {
                    // Win11 Raised Desktop requires WS_EX_LAYERED alpha=255 for crisp composition behind icons
                    self.apply_ex_style(true, true, true, true);
                    unsafe {
                        let _ = SetParent(self.hwnd, host);
                        let _ = SetWindowPos(
                            self.hwnd,
                            insert_after,
                            0,
                            0,
                            sw,
                            sh,
                            SET_WINDOW_POS_FLAGS(SWP_NOACTIVATE.0 | SWP_FRAMECHANGED.0 | SWP_SHOWWINDOW.0),
                        );
                    }
                    self.wallpaper_parent = Some(host);
                    self.mode = "wallpaper".into();
                } else {
                    // Clean fallback to bottom-pinned background if desktop host isn't available
                    return self.set_mode("background");
                }
            }
            _ => {}
        }

        self.mode.clone()
    }

    pub fn cleanup(&mut self) {
        self.bg_pin_active.store(false, Ordering::Relaxed);
        self.detach_wallpaper();
    }
}
