fn main() {
    println!("cargo:rerun-if-changed=assets/astralis.ico");
    println!("cargo:rerun-if-changed=assets/astralis_64.rgba");

    #[cfg(target_os = "windows")]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/astralis.ico");
        res.set("ProductName", "Astralis");
        res.set("FileDescription", "Astralis — Celestial Observatory & Music Visualizer");
        res.set("LegalCopyright", "Copyright (c) 2026 Gabrieala Mandal");
        res.compile().expect("Failed to embed Windows icon resource");
    }
}
