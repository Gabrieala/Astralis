//! Live Real-Time Satellite Orbital Data Fetcher (CelesTrak NORAD GP/OMM).
//!
//! Fetches authentic live NORAD General Perturbations orbital elements for
//! 9 active spacecraft (ISS, Tiangong, Hubble, Terra, Aqua, NOAA-20, Sentinel-2A,
//! Landsat 9, Suomi NPP), merges safely into disk cache, and auto-refreshes every 2 hours.

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const CACHE_TTL_SEC: u64 = 7200;
const USER_AGENT: &str = "AstralisObservatory/1.0";

struct TrackedSat {
    catnr: u32,
    label: &'static str,
    role: &'static str,
    mag: f64,
}

const TRACKED_SATELLITES: &[TrackedSat] = &[
    TrackedSat { catnr: 25544, label: "ISS (Zarya)", role: "Space Station", mag: -1.8 },
    TrackedSat { catnr: 48274, label: "Tiangong (CSS)", role: "Space Station", mag: -0.6 },
    TrackedSat { catnr: 20580, label: "Hubble (HST)", role: "Space Telescope", mag: 1.4 },
    TrackedSat { catnr: 25994, label: "NASA Terra", role: "Earth Observatory", mag: 2.4 },
    TrackedSat { catnr: 27424, label: "NASA Aqua", role: "Earth Observatory", mag: 2.5 },
    TrackedSat { catnr: 43013, label: "NOAA-20", role: "Weather Satellite", mag: 2.7 },
    TrackedSat { catnr: 40697, label: "Sentinel-2A", role: "ESA Earth Imager", mag: 2.8 },
    TrackedSat { catnr: 49260, label: "Landsat 9", role: "Earth Imager", mag: 2.9 },
    TrackedSat { catnr: 37849, label: "Suomi NPP", role: "Weather Satellite", mag: 2.8 },
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SatelliteGP {
    pub catnr: u32,
    pub name: String,
    #[serde(default)]
    pub norad_name: String,
    pub role: String,
    pub mag: f64,
    pub epoch_ms: i64,
    #[serde(default)]
    pub epoch_iso: String,
    pub inclination: f64,
    pub raan: f64,
    pub eccentricity: f64,
    pub arg_perigee: f64,
    pub mean_anomaly: f64,
    pub mean_motion: f64,
    pub alt_km: f64,
    pub vel_kms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CelestialPayload {
    pub live: bool,
    #[serde(default)]
    pub source: String,
    pub fetched_at: u64,
    pub satellites: Vec<SatelliteGP>,
}

#[derive(Deserialize)]
struct CelesTrakGP {
    #[serde(rename = "OBJECT_NAME")]
    object_name: Option<String>,
    #[serde(rename = "EPOCH")]
    epoch: Option<String>,
    #[serde(rename = "MEAN_MOTION")]
    mean_motion: Option<f64>,
    #[serde(rename = "ECCENTRICITY")]
    eccentricity: Option<f64>,
    #[serde(rename = "INCLINATION")]
    inclination: Option<f64>,
    #[serde(rename = "RA_OF_ASC_NODE")]
    ra_of_asc_node: Option<f64>,
    #[serde(rename = "ARG_OF_PERICENTER")]
    arg_of_pericenter: Option<f64>,
    #[serde(rename = "MEAN_ANOMALY")]
    mean_anomaly: Option<f64>,
}

fn unix_now_sec() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_epoch_ms(epoch_str: &str) -> i64 {
    let s = epoch_str.trim();
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return dt.timestamp_millis();
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc).timestamp_millis();
    }
    if let Ok(ndt) = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S") {
        return DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc).timestamp_millis();
    }
    Utc::now().timestamp_millis()
}

pub struct LiveCelestialFeed {
    cache_file: PathBuf,
    payload: Arc<Mutex<CelestialPayload>>,
    stop_flag: Arc<AtomicBool>,
}

impl LiveCelestialFeed {
    pub fn new(cache_file: PathBuf) -> Self {
        if let Some(parent) = cache_file.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut initial = CelestialPayload {
            live: false,
            source: "CelesTrak NORAD GP".into(),
            fetched_at: 0,
            satellites: Vec::new(),
        };
        if cache_file.exists() {
            if let Ok(raw) = fs::read_to_string(&cache_file) {
                if let Ok(parsed) = serde_json::from_str::<CelestialPayload>(&raw) {
                    if !parsed.satellites.is_empty() {
                        initial = parsed;
                    }
                }
            }
        }
        Self {
            cache_file,
            payload: Arc::new(Mutex::new(initial)),
            stop_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn get_data(&self) -> CelestialPayload {
        self.payload.lock().unwrap().clone()
    }

    pub fn start_background_refresh(&self) {
        let payload = Arc::clone(&self.payload);
        let cache_file = self.cache_file.clone();
        let stop_flag = Arc::clone(&self.stop_flag);

        thread::Builder::new()
            .name("AstralisCelestialFeed".into())
            .spawn(move || {
                while !stop_flag.load(Ordering::Relaxed) {
                    let (has_data, age) = {
                        let p = payload.lock().unwrap();
                        (
                            !p.satellites.is_empty(),
                            unix_now_sec().saturating_sub(p.fetched_at),
                        )
                    };

                    if !has_data || age >= CACHE_TTL_SEC {
                        fetch_live_all(&payload, &cache_file);
                    }

                    // Sleep in short slices so shutdown exits immediately
                    let target_wait = if has_data && age < CACHE_TTL_SEC {
                        (CACHE_TTL_SEC - age).max(60)
                    } else {
                        CACHE_TTL_SEC
                    };
                    for _ in 0..target_wait {
                        if stop_flag.load(Ordering::Relaxed) {
                            return;
                        }
                        thread::sleep(Duration::from_secs(1));
                    }
                }
            })
            .ok();
    }

    pub fn stop(&self) {
        self.stop_flag.store(true, Ordering::Relaxed);
    }
}

fn fetch_one(catnr: u32) -> Option<CelesTrakGP> {
    let url = format!("https://celestrak.org/NORAD/elements/gp.php?CATNR={}&FORMAT=JSON", catnr);
    let resp = ureq::get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(8))
        .call()
        .ok()?;
    let arr: Vec<CelesTrakGP> = resp.into_json().ok()?;
    arr.into_iter().next()
}

fn fetch_live_all(payload: &Mutex<CelestialPayload>, cache_file: &PathBuf) {
    let mut merged: HashMap<u32, SatelliteGP> = {
        let guard = payload.lock().unwrap();
        guard
            .satellites
            .iter()
            .map(|s| (s.catnr, s.clone()))
            .collect()
    };

    let mut fetched_any = false;
    for (idx, meta) in TRACKED_SATELLITES.iter().enumerate() {
        if idx > 0 {
            thread::sleep(Duration::from_millis(180));
        }
        let Some(gp) = fetch_one(meta.catnr) else {
            continue;
        };
        let (Some(mm), Some(inc), Some(raan), Some(ecc), Some(argp), Some(ma)) = (
            gp.mean_motion,
            gp.inclination,
            gp.ra_of_asc_node,
            gp.eccentricity,
            gp.arg_of_pericenter,
            gp.mean_anomaly,
        ) else {
            continue;
        };

        let n_rad_s = mm * 2.0 * std::f64::consts::PI / 86400.0;
        let a_km = (398600.4418 / (n_rad_s * n_rad_s)).cbrt();
        let alt_km = ((a_km - 6371.0).max(160.0) * 10.0).round() / 10.0;
        let vel_kms = ((398600.4418 / a_km).sqrt() * 100.0).round() / 100.0;
        let epoch_iso = gp.epoch.unwrap_or_default();

        merged.insert(
            meta.catnr,
            SatelliteGP {
                catnr: meta.catnr,
                name: meta.label.to_string(),
                norad_name: gp.object_name.unwrap_or_else(|| meta.label.to_string()),
                role: meta.role.to_string(),
                mag: meta.mag,
                epoch_ms: parse_epoch_ms(&epoch_iso),
                epoch_iso,
                inclination: inc,
                raan,
                eccentricity: ecc,
                arg_perigee: argp,
                mean_anomaly: ma,
                mean_motion: mm,
                alt_km,
                vel_kms,
            },
        );
        fetched_any = true;
    }

    let ordered: Vec<SatelliteGP> = TRACKED_SATELLITES
        .iter()
        .filter_map(|m| merged.get(&m.catnr).cloned())
        .collect();

    if fetched_any && !ordered.is_empty() {
        let next = CelestialPayload {
            live: true,
            source: "CelesTrak NORAD GP".into(),
            fetched_at: unix_now_sec(),
            satellites: ordered,
        };
        if let Ok(json) = serde_json::to_string(&next) {
            let _ = fs::write(cache_file, json);
        }
        if let Ok(mut guard) = payload.lock() {
            *guard = next;
        }
    }
}
