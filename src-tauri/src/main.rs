#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use keyring::Error as KeyringError;
use once_cell::sync::Lazy;
use open;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, Read};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri::Window;

#[tauri::command]
fn read_findings(path: String) -> Result<String, String> {
    let mut contents = String::new();
    File::open(&path)
        .map_err(|e| format!("Could not open file {}: {}", path, e))?
        .read_to_string(&mut contents)
        .map_err(|e| format!("Could not read file {}: {}", path, e))?;

    // try transform: parse the JSON and run the transformer if parsing succeeds
    let parsed: serde_json::Value =
        serde_json::from_str(&contents).map_err(|e| format!("Invalid JSON in {}: {}", path, e))?;

    if let Some(out) = transform_vulnerabilities(&parsed) {
        return Ok(out.to_string());
    }

    // otherwise return original content
    Ok(contents)
}

// Extracted transformer so it can be tested separately.
fn transform_vulnerabilities(parsed: &serde_json::Value) -> Option<serde_json::Value> {
    let vuls = parsed.get("vulnerabilities")?.as_array()?;

    // Try to detect image info from impactPaths entries matching our internal registry prefix.
    // This will be used to populate the top-level `image` field returned to the frontend.
    let registry_prefix = "git.grid:4567/usmc/tdol/core";
    let mut detected_image_name: Option<String> = None;
    let mut detected_image_version: Option<String> = None;

    let mut findings: Vec<serde_json::Value> = Vec::new();
    for (i, entry) in vuls.iter().enumerate() {
        let id = entry
            .get("issueId")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("vuln-{}", i));

        let severity = entry
            .get("severity")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let package_name = entry
            .get("impactedPackageName")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let package_version = entry
            .get("impactedPackageVersion")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let component = entry
            .get("components")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.get(0))
            .and_then(|comp| comp.get("name"))
            .and_then(|n| n.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // CVEs: extract id strings
        let cves: Vec<String> = entry
            .get("cves")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| c.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        // cvss score: try first CVE cvssV3
        let cvss_score = entry
            .get("cves")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.get(0))
            .and_then(|c0| c0.get("cvssV3"))
            .and_then(|s| s.as_str())
            .and_then(|s| s.parse::<f64>().ok());

        // fixed versions / fix available
        let (fix_available, fixed_version) = match entry.get("fixedVersions") {
            Some(v) if v.is_null() => (false, serde_json::Value::Null),
            Some(v) => {
                if v.is_array() {
                    let arr = v.as_array().unwrap();
                    if arr.is_empty() {
                        (false, serde_json::Value::Null)
                    } else {
                        (true, arr.get(0).cloned().unwrap_or(serde_json::Value::Null))
                    }
                } else if v.is_string() {
                    (true, v.clone())
                } else {
                    (false, serde_json::Value::Null)
                }
            }
            None => (false, serde_json::Value::Null),
        };

        let description = entry
            .get("summary")
            .and_then(|s| s.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let references = entry
            .get("references")
            .cloned()
            .unwrap_or_else(|| serde_json::Value::Array(vec![]));

        // derive a path from the first impactPath last element if present
        let path = entry
            .get("impactPaths")
            .and_then(|p| p.as_array())
            .and_then(|paths| paths.get(0))
            .and_then(|path_arr| path_arr.as_array())
            .and_then(|arr| arr.last())
            .and_then(|last| last.get("location"))
            .and_then(|loc| loc.get("file"))
            .and_then(|f| f.as_str())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // include impactPaths in metadata so frontend can inspect counts
        let impact_paths = entry
            .get("impactPaths")
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        // If we haven't already detected an image, scan this entry's impactPaths for our registry prefix.
        if detected_image_name.is_none() {
            if let Some(ip_arr) = entry.get("impactPaths").and_then(|v| v.as_array()) {
                'outer: for path_seq in ip_arr.iter() {
                    if let Some(seq) = path_seq.as_array() {
                        for el in seq.iter() {
                            if let Some(name) = el.get("name").and_then(|n| n.as_str()) {
                                if name.contains(registry_prefix) {
                                    // take last path segment after '/'
                                    let parts: Vec<&str> = name.split('/').collect();
                                    if let Some(last) = parts.last() {
                                        detected_image_name = Some(last.to_string());
                                    }
                                    // version field on this element is our image version
                                    if let Some(ver) = el.get("version").and_then(|v| v.as_str()) {
                                        detected_image_version = Some(ver.to_string());
                                    }
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }
        }

        let metadata = serde_json::json!({
            "impactedPackageType": entry.get("impactedPackageType").cloned().unwrap_or(serde_json::Value::Null),
            "jfrog": entry.get("jfrogResearcInformation").cloned().unwrap_or(serde_json::Value::Null),
            "impact_paths": impact_paths
        });

        let finding = serde_json::json!({
            "id": id,
            "severity": severity,
            "package": {
                "name": package_name,
                "version": package_version
            },
            "component": component,
            "cves": cves,
            "cvss_score": cvss_score,
            "fix_available": fix_available,
            "fixed_version": fixed_version,
            "description": description,
            "references": references,
            "path": path,
            "metadata": metadata
        });

        findings.push(finding);
    }

    let out_obj = serde_json::json!({
        "image": serde_json::json!({
            "name": detected_image_name.clone().map(|s| serde_json::Value::String(s)).unwrap_or(serde_json::Value::Null),
            "version": detected_image_version.clone().map(|s| serde_json::Value::String(s)).unwrap_or(serde_json::Value::Null)
        }),
        "scan_date": serde_json::Value::Null,
        "findings": findings
    });

    Some(out_obj)
}

// Open a URL on the host using the platform default opener. Frontend uses this
// when it cannot rely on the Tauri `shell` API (dev + various webviews).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    match open::that(&url) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("failed to open url {}: {}", url, e)),
    }
}

// Open a native file picker and return the selected file path (first selection).
#[tauri::command]
fn open_native_dialog() -> Result<Option<String>, String> {
    // Platform-specific: prefer macOS `osascript` so we avoid pulling extra GUI deps.
    // On Linux, try `zenity` if available. Return `Ok(None)` when the user cancels.
    #[cfg(target_os = "macos")]
    {
        // Use a simple AppleScript `choose file` without a type filter; some
        // versions of macOS or configuration can make type filters fail.
        // Pass a plain string to osascript, e.g.:
        // POSIX path of (choose file with prompt "Select JSON file")
        let script = r#"POSIX path of (choose file with prompt "Select JSON file")"#;
        match Command::new("osascript").arg("-e").arg(script).output() {
            Ok(out) => {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if s.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(s))
                    }
                } else {
                    // If the user cancelled the dialog, osascript writes a
                    // 'User canceled.' message to stderr and exits non-zero.
                    // Treat this as a normal cancellation (return Ok(None)).
                    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                    let err_l = err.to_lowercase();
                    if err.is_empty()
                        || err_l.contains("user canceled")
                        || err_l.contains("user canceled.")
                    {
                        Ok(None)
                    } else {
                        Err(format!("osascript failed: {}", err))
                    }
                }
            }
            Err(e) => Err(format!("failed to run osascript: {}", e)),
        }
    }

    #[cfg(all(not(target_os = "macos"), target_os = "linux"))]
    {
        // Try zenity (common on many Linux desktops).
        match Command::new("zenity")
            .arg("--file-selection")
            .arg("--file-filter=JSON | *.json")
            .output()
        {
            Ok(out) => {
                if out.status.success() {
                    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if s.is_empty() {
                        Ok(None)
                    } else {
                        Ok(Some(s))
                    }
                } else {
                    Ok(None)
                }
            }
            Err(_) => Ok(None),
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        // Other platforms: not implemented here.
        Ok(None)
    }
}

// Start a local scan command. If the environment variable `IRONSIGHT_SCAN_CMD` is
// present it is treated as a shell template where `{target}` will be substituted.
// stdout is streamed back to the frontend via `scan-progress` events and a final
// `scan-complete` event is emitted on exit.
#[tauri::command]
fn start_scan(window: Window, target: Option<String>) -> Result<(), String> {
    // allow a configurable CLI via env var
    if let Ok(template) = std::env::var("IRONSIGHT_SCAN_CMD") {
        let t = template.replace("{target}", &target.clone().unwrap_or_default());
        // spawn a thread to run the blocking child process
        thread::spawn(move || {
            if let Ok(mut child) = Command::new("sh")
                .arg("-c")
                .arg(t)
                .stdout(std::process::Stdio::piped())
                .spawn()
            {
                if let Some(stdout) = child.stdout.take() {
                    let reader = std::io::BufReader::new(stdout);
                    for line in reader.lines().flatten() {
                        let _ =
                            window.emit("scan-progress", Some(serde_json::json!({"line": line})));
                    }
                }
                let status = child.wait();
                let _ = window.emit(
                    "scan-complete",
                    Some(serde_json::json!({"status": format!("{:?}", status)})),
                );
            } else {
                let _ = window.emit(
                    "scan-complete",
                    Some(serde_json::json!({"status": "failed to launch"})),
                );
            }
        });
        return Ok(());
    }

    // No CLI configured — simulate progress for demo purposes
    thread::spawn(move || {
        for i in 1..=5 {
            let _ = window.emit(
                "scan-progress",
                Some(serde_json::json!({"line": format!("simulated progress {}/5", i)})),
            );
            thread::sleep(Duration::from_millis(400));
        }
        let _ = window.emit(
            "scan-complete",
            Some(serde_json::json!({"status": "simulated"})),
        );
    });

    Ok(())
}

// Fetch a remote file via the system `ssh` binary: `ssh <target> cat <remote_path>`.
// Streams the fetched content back as a single `remote-file-content` event and then
// a `remote-file-complete` event when done.
#[tauri::command]
fn fetch_remote_file(
    window: Window,
    ssh_target: String,
    remote_path: String,
) -> Result<(), String> {
    thread::spawn(move || {
        let cmd = format!(
            "ssh {} cat '{}'",
            ssh_target,
            remote_path.replace("'", "'\\''")
        );
        match Command::new("sh").arg("-c").arg(cmd).output() {
            Ok(out) => {
                let content = String::from_utf8_lossy(&out.stdout).to_string();
                let _ = window.emit(
                    "remote-file-content",
                    Some(serde_json::json!({"path": remote_path, "content": content})),
                );
                let _ = window.emit(
                    "remote-file-complete",
                    Some(serde_json::json!({"status": "ok", "code": out.status.code()})),
                );
            }
            Err(e) => {
                let _ = window.emit(
                    "remote-file-complete",
                    Some(serde_json::json!({"status": "error", "error": format!("{}", e)})),
                );
            }
        }
    });
    Ok(())
}

// Run a scan on a remote host via SSH. `scan_cmd_template` should include a `{target}` placeholder
// that will be substituted with `scan_target` on the remote side. Streams stdout via `scan-progress`.
#[tauri::command]
fn start_scan_ssh(
    window: Window,
    ssh_target: String,
    scan_cmd_template: String,
    scan_target: String,
) -> Result<(), String> {
    thread::spawn(move || {
        let remote_cmd = scan_cmd_template.replace("{target}", &scan_target);
        // run: ssh <ssh_target> sh -lc '<remote_cmd>'
        let full = format!(
            "ssh {} sh -lc '{}'",
            ssh_target,
            remote_cmd.replace("'", "'\\''")
        );
        if let Ok(mut child) = Command::new("sh")
            .arg("-c")
            .arg(full)
            .stdout(std::process::Stdio::piped())
            .spawn()
        {
            if let Some(stdout) = child.stdout.take() {
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    let _ = window.emit("scan-progress", Some(serde_json::json!({"line": line})));
                }
            }
            let status = child.wait();
            let _ = window.emit(
                "scan-complete",
                Some(serde_json::json!({"status": format!("{:?}", status)})),
            );
        } else {
            let _ = window.emit(
                "scan-complete",
                Some(serde_json::json!({"status": "failed to launch ssh"})),
            );
        }
    });
    Ok(())
}

// Manage background SSH tunnel child processes keyed by '<username>@<ip>'
static TUNNEL_CHILDREN: Lazy<Mutex<HashMap<String, std::process::Child>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

// Start an SSH tunnel: forwards local_port -> remote_host:remote_port via SSH
// Returns Ok("running") when the tunnel is started, or an error string.
#[tauri::command]
fn start_ssh_tunnel(
    ip: String,
    username: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<String, String> {
    let key = format!("{}@{}", username, ip);
    let mut map = TUNNEL_CHILDREN
        .lock()
        .map_err(|e| format!("lock error: {}", e))?;
    if map.contains_key(&key) {
        return Ok("already_running".to_string());
    }
    // Build an ssh command that opens a local port forward and does not allocate a shell
    let cmd = format!("ssh -L {local}:{remote_host}:{remote} -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=60 {target}",
        local = local_port, remote_host = remote_host, remote = remote_port, target = format!("{}@{}", username, ip));

    match std::process::Command::new("sh").arg("-c").arg(cmd).spawn() {
        Ok(child) => {
            map.insert(key, child);
            Ok("running".to_string())
        }
        Err(e) => Err(format!("failed to spawn ssh: {}", e)),
    }
}

// Stop a previously started SSH tunnel for the given ip/username
#[tauri::command]
fn stop_ssh_tunnel(ip: String, username: String) -> Result<String, String> {
    let key = format!("{}@{}", username, ip);
    let mut map = TUNNEL_CHILDREN
        .lock()
        .map_err(|e| format!("lock error: {}", e))?;
    if let Some(mut child) = map.remove(&key) {
        match child.kill() {
            Ok(_) => {
                let _ = child.wait();
                return Ok("stopped".to_string());
            }
            Err(e) => return Err(format!("failed to kill tunnel process: {}", e)),
        }
    }
    Ok("not_found".to_string())
}

// Store an SSH credential (password) in the OS keychain using the `keyring` crate.
// The entry will be stored using service "ironsight-ssh" and username "<username>@<ip>".
#[tauri::command]
fn store_ssh_credential(ip: String, username: String, password: String) -> Result<(), String> {
    let user_key = format!("{}@{}", username, ip);
    let entry = Entry::new("ironsight-ssh", &user_key);
    entry
        .set_password(&password)
        .map_err(|e| format!("keyring set failed: {}", e))?;
    Ok(())
}

// Check whether a credential exists for the given ip and username.
#[tauri::command]
fn has_ssh_credential(ip: String, username: String) -> Result<bool, String> {
    let user_key = format!("{}@{}", username, ip);
    let entry = Entry::new("ironsight-ssh", &user_key);
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(KeyringError::NoEntry) => Ok(false),
        Err(e) => Err(format!("keyring error: {}", e)),
    }
}

// Delete a stored SSH credential for the given ip and username.
#[tauri::command]
fn delete_ssh_credential(ip: String, username: String) -> Result<(), String> {
    let user_key = format!("{}@{}", username, ip);
    let entry = Entry::new("ironsight-ssh", &user_key);
    entry.delete_password().map_err(|e| match e {
        KeyringError::NoEntry => format!("no entry"),
        other => format!("keyring delete failed: {}", other),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_transform_vulnerabilities_basic() {
        let sample = r#"
        {
            "vulnerabilities": [
                {
                    "severity": "High",
                    "impactedPackageName": "glibc-common",
                    "impactedPackageVersion": "0:2.34-231.el9_7.2",
                    "impactedPackageType": "RPM",
                    "components": [ { "name": "some_sha256.tar", "version": "", "location": { "file": "some_sha256.tar" } } ],
                    "summary": "glibc: Integer overflow in memalign leads to heap corruption",
                    "fixedVersions": null,
                    "cves": [ { "id": "CVE-2026-0861", "cvssV3": "9.8" } ],
                    "issueId": "XRAY-932948",
                    "references": [ "https://access.redhat.com/security/cve/CVE-2026-0861" ],
                    "impactPaths": [ [ { "name": "a", "version": "1" }, { "name": "b", "version": "2" } ] ]
                }
            ]
        }
        "#;

        let v: serde_json::Value = serde_json::from_str(sample).unwrap();
        let out = transform_vulnerabilities(&v).expect("should transform");
        let findings = out
            .get("findings")
            .and_then(|f| f.as_array())
            .expect("findings array");
        assert_eq!(findings.len(), 1);
        let f0 = &findings[0];
        assert_eq!(
            f0.get("id").and_then(|v| v.as_str()).unwrap(),
            "XRAY-932948"
        );
        assert_eq!(
            f0.get("severity")
                .and_then(|v| v.as_str())
                .unwrap()
                .to_lowercase(),
            "high"
        );
        assert_eq!(
            f0.get("package")
                .and_then(|p| p.get("name"))
                .and_then(|v| v.as_str())
                .unwrap(),
            "glibc-common"
        );
        assert_eq!(
            f0.get("cves")
                .and_then(|c| c.as_array())
                .map(|a| a[0].as_str().unwrap()),
            Some("CVE-2026-0861")
        );
        // metadata impact_paths should exist and be an array
        assert!(f0
            .get("metadata")
            .and_then(|m| m.get("impact_paths"))
            .is_some());
        // ensure top-level image was detected from the impactPaths
        let image = out
            .get("image")
            .and_then(|i| i.as_object())
            .expect("image obj");
        assert_eq!(
            image.get("name").and_then(|v| v.as_str()).unwrap(),
            "tdol-datahub-actions"
        );
        assert_eq!(
            image.get("version").and_then(|v| v.as_str()).unwrap(),
            "8.0.2-101394"
        );
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // If a DEV_SERVER_URL environment variable is set, redirect the main window
            if let Ok(url) = std::env::var("DEV_SERVER_URL") {
                if let Some(win) = app.get_webview_window("main") {
                    // use a small JS redirect so the existing window navigates to the dev server
                    let script = format!("window.location.replace('{}')", url);
                    let _ = win.eval(&script);
                }
            }
            // Handshake: repeatedly set a JS global so the frontend can detect native window presence
            // This helps avoid false-negative detection in dev where the Tauri injection may arrive late.
            if let Some(win) = app.get_webview_window("main") {
                let win_ = win.clone();
                thread::spawn(move || {
                    // attempt to set the flag a few times, then stop
                    for _ in 0..30 {
                        let _ = win_.eval("window.__IRONSIGHT_NATIVE = true");
                        thread::sleep(Duration::from_millis(250));
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_findings,
            open_url,
            start_scan,
            fetch_remote_file,
            start_scan_ssh,
            open_native_dialog,
            store_ssh_credential,
            has_ssh_credential,
            delete_ssh_credential,
            start_ssh_tunnel,
            stop_ssh_tunnel
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
