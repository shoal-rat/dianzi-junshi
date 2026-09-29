use std::{
    io::{self, Read},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct BackendProcess(Mutex<Option<CommandChild>>);

const KEYCHAIN_SERVICE: &str = "com.shoalrat.dianzi-junshi";

pub fn run_keychain_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("--keychain") { return None; }
    let action = args.get(2).map(String::as_str).unwrap_or("");
    let provider = args.get(3).map(String::as_str).unwrap_or("");
    if !["claude", "deepseek", "glm", "custom", "integration-test"].contains(&provider) {
        eprintln!("unsupported provider");
        return Some(2);
    }
    let entry = match keyring::Entry::new(KEYCHAIN_SERVICE, &format!("{provider}-api-key")) {
        Ok(entry) => entry,
        Err(error) => { eprintln!("{error}"); return Some(3); }
    };
    match action {
        "get" => match entry.get_password() {
            Ok(secret) => { print!("{secret}"); Some(0) }
            Err(keyring::Error::NoEntry) => Some(4),
            Err(error) => { eprintln!("{error}"); Some(5) }
        },
        "set" => {
            let mut secret = String::new();
            if let Err(error) = io::stdin().take(32 * 1024).read_to_string(&mut secret) {
                eprintln!("{error}"); return Some(6);
            }
            if secret.trim().is_empty() { eprintln!("empty secret"); return Some(7); }
            match entry.set_password(secret.trim()) {
                Ok(()) => Some(0), Err(error) => { eprintln!("{error}"); Some(8) }
            }
        }
        "delete" => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Some(0),
            Err(error) => { eprintln!("{error}"); Some(9) }
        },
        _ => { eprintln!("unsupported action"); Some(2) }
    }
}

fn free_local_port() -> u16 {
    TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(5177)
}

/// 系统是不是中文环境：macOS 看首选语言，其他平台看 LC_ALL / LC_MESSAGES / LANG。
fn system_is_zh() -> bool {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("defaults").args(["read", "-g", "AppleLanguages"]).output() {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(first) = text.lines().map(|l| l.trim().trim_matches(|c| c == '"' || c == ',')).find(|l| l.len() >= 2 && l.chars().next().map_or(false, |c| c.is_ascii_alphabetic())) {
                return first.to_ascii_lowercase().starts_with("zh");
            }
        }
    }
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(v) = std::env::var(key) {
            let v = v.to_ascii_lowercase();
            if v.is_empty() || v == "c" || v.starts_with("c.") || v == "posix" { continue; }
            return v.starts_with("zh");
        }
    }
    false
}

/// 界面语言以后端为准（设置里可以手动改），问不到就按系统。
fn backend_lang_is_zh(port: u16) -> Option<bool> {
    use std::io::Write;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(500)).ok()?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    stream.write_all(b"GET /api/settings HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").ok()?;
    let mut body = String::new();
    stream.take(256 * 1024).read_to_string(&mut body).ok()?;
    if body.contains("\"lang\":\"zh\"") { Some(true) } else if body.contains("\"lang\":\"en\"") { Some(false) } else { None }
}

fn wait_for_backend(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    false
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let port = free_local_port();
            let resources = app.path().resource_dir()?;
            let sidecar = app
                .shell()
                .sidecar("dianzi-junshi-server")?
                .env("HOST", "127.0.0.1")
                .env("PORT", port.to_string())
                .env("DJ_KEYCHAIN_HELPER", std::env::current_exe()?.to_string_lossy().to_string());
            #[cfg(target_os = "linux")]
            let sidecar = sidecar.env(
                "DJ_BACKEND_ARCHIVE",
                resources
                    .join("resources/backend/dianzi-junshi-server.gz")
                    .to_string_lossy()
                    .to_string(),
            );
            #[cfg(not(target_os = "linux"))]
            let _ = &resources;
            let (_events, child) = sidecar.spawn()?;
            app.manage(BackendProcess(Mutex::new(Some(child))));

            if !wait_for_backend(port, Duration::from_secs(10)) {
                return Err(if system_is_zh() {
                    "本地服务没有及时启动，请重新打开电子军师"
                } else {
                    "The local service didn't start in time — please reopen Junshi"
                }
                .into());
            }
            let zh = backend_lang_is_zh(port).unwrap_or_else(system_is_zh);
            let url = format!("http://127.0.0.1:{port}/").parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title(if zh { "电子军师" } else { "Junshi · 电子军师" })
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 620.0)
                .resizable(true)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Dianzi Junshi failed to start / 电子军师桌面应用启动失败");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            if let Some(state) = handle.try_state::<BackendProcess>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
