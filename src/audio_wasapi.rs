//! Native Windows WASAPI Loopback System Audio FFT Analyzer.
//!
//! Captures whatever is playing on the default audio output device (Brave, Chrome,
//! Spotify, games, etc.) via AUDCLNT_STREAMFLAGS_LOOPBACK and computes ultra-lightweight
//! 2048-point Hann-windowed FFT bands (sub, bass, mid, high, energy, beat, active).

use rustfft::{num_complex::Complex, FftPlanner};
use serde::Serialize;
use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

// Standard Windows KSDATAFORMAT_SUBTYPE_IEEE_FLOAT GUID {00000003-0000-0010-8000-00AA00389B71}
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
    GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

const FFT_SIZE: usize = 2048;

#[derive(Debug, Clone, Copy, Serialize)]
pub struct AudioMetrics {
    pub sub: f32,
    pub bass: f32,
    pub mid: f32,
    pub high: f32,
    pub energy: f32,
    pub beat: f32,
    pub kick: f32,
    pub snare: f32,
    pub beat_seq: u64,
    pub beat_kind: u8, // 0 = none, 1 = kick/downbeat, 2 = snare/clap/accent
    pub active: f32,
}

impl Default for AudioMetrics {
    fn default() -> Self {
        Self {
            sub: 0.0,
            bass: 0.0,
            mid: 0.0,
            high: 0.0,
            energy: 0.0,
            beat: 0.0,
            kick: 0.0,
            snare: 0.0,
            beat_seq: 0,
            beat_kind: 0,
            active: 0.0,
        }
    }
}

pub struct AudioAnalyzer {
    enabled: Arc<AtomicBool>,
    stop_flag: Arc<AtomicBool>,
    metrics: Arc<Mutex<AudioMetrics>>,
}

impl AudioAnalyzer {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(true)),
            stop_flag: Arc::new(AtomicBool::new(false)),
            metrics: Arc::new(Mutex::new(AudioMetrics::default())),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            if let Ok(mut m) = self.metrics.lock() {
                *m = AudioMetrics::default();
            }
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn get_metrics(&self) -> AudioMetrics {
        if !self.is_enabled() {
            return AudioMetrics::default();
        }
        *self.metrics.lock().unwrap()
    }

    pub fn start(&self) {
        let enabled = Arc::clone(&self.enabled);
        let stop_flag = Arc::clone(&self.stop_flag);
        let metrics = Arc::clone(&self.metrics);

        thread::Builder::new()
            .name("AstralisWasapiFFT".into())
            .spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                while !stop_flag.load(Ordering::Relaxed) {
                    if let Err(_) = run_wasapi_session(&enabled, &stop_flag, &metrics) {
                        // Retry gently if default audio device changes or unplugs
                        thread::sleep(Duration::from_secs(2));
                    }
                }
                unsafe {
                    CoUninitialize();
                }
            })
            .ok();
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

fn run_wasapi_session(
    enabled: &AtomicBool,
    stop_flag: &AtomicBool,
    metrics_out: &Mutex<AudioMetrics>,
) -> windows::core::Result<()> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let audio_client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;

        let mix_fmt_ptr = audio_client.GetMixFormat()?;
        let fmt: WAVEFORMATEX = *mix_fmt_ptr;
        let sample_rate = fmt.nSamplesPerSec.max(8000) as f32;
        let channels = fmt.nChannels.max(1) as usize;
        let bits = fmt.wBitsPerSample;

        let is_float = if fmt.wFormatTag == WAVE_FORMAT_IEEE_FLOAT as u16 {
            true
        } else if fmt.wFormatTag == WAVE_FORMAT_EXTENSIBLE as u16 {
            let ext = *(mix_fmt_ptr as *const WAVEFORMATEXTENSIBLE);
            let sub = ext.SubFormat;
            sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
        } else {
            false
        };

        // 100ms shared-mode loopback buffer
        let hns_buffer: i64 = 1_000_000;
        let init_res = audio_client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            hns_buffer,
            0,
            mix_fmt_ptr,
            None,
        );
        CoTaskMemFree(Some(mix_fmt_ptr as *const _));
        init_res?;

        let capture_client: IAudioCaptureClient = audio_client.GetService()?;
        audio_client.Start()?;

        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let hann: Vec<f32> = (0..FFT_SIZE)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * i as f32 / (FFT_SIZE - 1) as f32).cos()))
            .collect();

        let mut ring: Vec<f32> = Vec::with_capacity(FFT_SIZE * 2);
        let mut fft_buf: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];

        let mut smooth = AudioMetrics::default();
        let mut prev_kick: f32 = 0.0;
        let mut kick_avg: f32 = 0.03;
        let mut prev_snare: f32 = 0.0;
        let mut snare_avg: f32 = 0.025;
        let mut beat_seq: u64 = 0;
        let mut last_onset = Instant::now() - Duration::from_secs(1);
        let mut last_fft = Instant::now();

        while !stop_flag.load(Ordering::Relaxed) {
            if !enabled.load(Ordering::Relaxed) {
                ring.clear();
                thread::sleep(Duration::from_millis(100));
                continue;
            }

            let mut packet_len = capture_client.GetNextPacketSize()?;
            if packet_len == 0 {
                // Decay smoothly during silence (WASAPI loopback emits no packets when silent)
                if last_fft.elapsed() > Duration::from_millis(60) {
                    smooth.sub *= 0.80;
                    smooth.bass *= 0.80;
                    smooth.mid *= 0.80;
                    smooth.high *= 0.80;
                    smooth.energy *= 0.80;
                    smooth.beat *= 0.68;
                    smooth.kick *= 0.65;
                    smooth.snare *= 0.65;
                    smooth.active = if smooth.energy > 0.015 { 1.0 } else { 0.0 };
                    if let Ok(mut out) = metrics_out.lock() {
                        *out = smooth;
                    }
                    last_fft = Instant::now();
                }
                thread::sleep(Duration::from_millis(8));
                continue;
            }

            while packet_len > 0 {
                let mut data_ptr = std::ptr::null_mut();
                let mut num_frames = 0u32;
                let mut flags = 0u32;
                capture_client.GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)?;

                let frames = num_frames as usize;
                let silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 || data_ptr.is_null();

                if silent {
                    for _ in 0..frames {
                        ring.push(0.0);
                    }
                } else if is_float && bits == 32 {
                    let slice = std::slice::from_raw_parts(data_ptr as *const f32, frames * channels);
                    let nch = channels.min(2).max(1);
                    let inv_ch = 1.0 / nch as f32;
                    for f in 0..frames {
                        let base = f * channels;
                        let mut mono = 0.0f32;
                        for ch in 0..nch {
                            mono += slice[base + ch];
                        }
                        ring.push(mono * inv_ch);
                    }
                } else if bits == 16 {
                    let slice = std::slice::from_raw_parts(data_ptr as *const i16, frames * channels);
                    let nch = channels.min(2).max(1);
                    let inv_ch = 1.0 / (nch as f32 * 32768.0);
                    for f in 0..frames {
                        let base = f * channels;
                        let mut mono = 0.0f32;
                        for ch in 0..nch {
                            mono += slice[base + ch] as f32;
                        }
                        ring.push(mono * inv_ch);
                    }
                } else {
                    for _ in 0..frames {
                        ring.push(0.0);
                    }
                }

                capture_client.ReleaseBuffer(num_frames)?;
                packet_len = capture_client.GetNextPacketSize()?;
            }

            // Tight ~45Hz (22ms) FFT for razor-sharp kick/snare onset sync (<0.3% CPU in Rust!)
            if ring.len() >= FFT_SIZE {
                let start = ring.len() - FFT_SIZE;
                if last_fft.elapsed() >= Duration::from_millis(22) {
                    last_fft = Instant::now();
                    for i in 0..FFT_SIZE {
                        fft_buf[i] = Complex::new(ring[start + i] * hann[i], 0.0);
                    }
                    fft.process(&mut fft_buf);

                    let bin_hz = sample_rate / FFT_SIZE as f32;
                    let half = FFT_SIZE / 2;
                    let band_avg = |lo_hz: f32, hi_hz: f32| -> f32 {
                        let lo = ((lo_hz / bin_hz).floor() as usize).clamp(1, half - 1);
                        let hi = ((hi_hz / bin_hz).ceil() as usize).clamp(lo + 1, half);
                        let mut sum = 0.0f32;
                        for b in lo..hi {
                            sum += fft_buf[b].norm();
                        }
                        let mean = sum / (hi - lo) as f32;
                        ((mean / (FFT_SIZE as f32 * 0.042)).ln_1p() * 0.56).clamp(0.0, 1.0)
                    };

                    let raw_sub = band_avg(22.0, 85.0);
                    let raw_bass = band_avg(85.0, 240.0);
                    let raw_mid = band_avg(240.0, 2200.0);
                    let raw_high = band_avg(2200.0, 11000.0);
                    let raw_energy =
                        (raw_sub * 0.28 + raw_bass * 0.34 + raw_mid * 0.24 + raw_high * 0.14)
                            .clamp(0.0, 1.0);

                    // Dual-band spectral flux onset detector:
                    // 1) Kick / Low-end drum punch (35-145 Hz)
                    let raw_kick = (raw_sub * 0.62 + raw_bass * 0.52).clamp(0.0, 1.0);
                    let kick_flux = (raw_kick - prev_kick).max(0.0);
                    prev_kick = prev_kick * 0.35 + raw_kick * 0.65;
                    kick_avg = kick_avg * 0.94 + raw_kick * 0.06;
                    let kick_thresh = (kick_avg * 0.20).max(0.032);
                    let kick_hit = if kick_flux > kick_thresh && raw_kick > 0.10 {
                        ((kick_flux / kick_thresh - 0.72) * 0.85 + kick_flux * 4.2).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };

                    // 2) Snare / Clap / Percussion transient (220-950 Hz + crisp upper crack)
                    let raw_snare = (band_avg(220.0, 950.0) * 0.60 + band_avg(2200.0, 6500.0) * 0.48)
                        .clamp(0.0, 1.0);
                    let snare_flux = (raw_snare - prev_snare).max(0.0);
                    prev_snare = prev_snare * 0.35 + raw_snare * 0.65;
                    snare_avg = snare_avg * 0.94 + raw_snare * 0.06;
                    let snare_thresh = (snare_avg * 0.26).max(0.036);
                    let snare_hit = if snare_flux > snare_thresh && raw_snare > 0.10 {
                        ((snare_flux / snare_thresh - 0.75) * 0.78 + snare_flux * 3.8).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };

                    let beat_hit = kick_hit.max(snare_hit * 0.92);
                    let mut beat_kind = smooth.beat_kind;
                    if beat_hit > 0.24 && last_onset.elapsed() >= Duration::from_millis(135) {
                        beat_seq = beat_seq.wrapping_add(1);
                        last_onset = Instant::now();
                        beat_kind = if kick_hit >= snare_hit * 0.9 { 1 } else { 2 };
                    }

                    // Snappy envelopes so consecutive 110-150 BPM beats visibly separate & punch!
                    smooth.sub = smooth.sub * 0.42 + raw_sub * 0.58;
                    smooth.bass = smooth.bass * 0.38 + raw_bass * 0.62;
                    smooth.mid = smooth.mid * 0.48 + raw_mid * 0.52;
                    smooth.high = smooth.high * 0.45 + raw_high * 0.55;
                    smooth.energy = smooth.energy * 0.45 + raw_energy * 0.55;
                    smooth.kick = kick_hit.max(smooth.kick * 0.62);
                    smooth.snare = snare_hit.max(smooth.snare * 0.62);
                    smooth.beat = beat_hit.max(smooth.beat * 0.65);
                    smooth.beat_seq = beat_seq;
                    smooth.beat_kind = beat_kind;
                    smooth.active = if smooth.energy > 0.015 { 1.0 } else { 0.0 };

                    if let Ok(mut out) = metrics_out.lock() {
                        *out = smooth;
                    }
                }
                ring.drain(0..start);
            }
        }

        let _ = audio_client.Stop();
        Ok(())
    }
}
