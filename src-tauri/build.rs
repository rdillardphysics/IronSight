fn main() {
    // Generate a valid 1x1 RGBA PNG icon so tauri-build can read it.
    std::fs::create_dir_all("icons").ok();
    // Create a 1x1 image with opaque white pixel (RGBA)
    let img = image::ImageBuffer::from_fn(1, 1, |_, _| image::Rgba([255u8, 255u8, 255u8, 255u8]));
    let dyn_img = image::DynamicImage::ImageRgba8(img);
    // Encode to PNG in-memory
    let mut buf: Vec<u8> = Vec::new();
    {
        use std::io::Cursor;
        let mut cursor = Cursor::new(&mut buf);
        dyn_img
            .write_to(&mut cursor, image::ImageOutputFormat::Png)
            .expect("failed to encode PNG");
    }

    // If the user has provided their own icon at `icons/icon.png`, validate
    // that it's a PNG. If it is missing or invalid, write the generated
    // placeholder so tauri-build has a valid image to work with. Emit a
    // cargo warning when we replace an invalid file so the developer sees it.
    let icon_path = "icons/icon.png";
    const PNG_SIG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    match std::fs::metadata(icon_path) {
        Ok(md) => {
            if md.is_file() {
                // Read the file header to confirm PNG signature
                match std::fs::read(icon_path) {
                    Ok(bytes) => {
                        let valid = bytes.len() >= 8 && bytes[..8] == PNG_SIG;
                        if !valid {
                            println!("cargo:warning=icons/icon.png exists but is not a valid PNG; replacing with generated placeholder.");
                            let _ = std::fs::write(icon_path, &buf);
                        }
                        // if valid, leave as-is
                    }
                    Err(_) => {
                        println!("cargo:warning=Failed to read existing icons/icon.png; writing placeholder icon.");
                        let _ = std::fs::write(icon_path, &buf);
                    }
                }
            } else {
                // path exists but isn't a file — overwrite with placeholder
                let _ = std::fs::write(icon_path, &buf);
            }
        }
        Err(_) => {
            // file does not exist — create the placeholder
            let _ = std::fs::write(icon_path, &buf);
        }
    }

    // Process `tauri.conf.json` and place the generated context in the build output directory
    // so `tauri::generate_context!()` can read it at compile time.
    tauri_build::build()
}
