use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

struct BackendProcess(Mutex<Option<CommandChild>>);

fn free_local_port() -> u16 {
    TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(5177)
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
            let native_dirs = [
                resources.join("resources/native"),
                resources.join("native"),
                resources.parent().unwrap_or(&resources).join("Frameworks"),
            ];
            let sidecar = app
                .shell()
                .sidecar("dianzi-junshi-server")?
                .env("HOST", "127.0.0.1")
                .env("PORT", port.to_string());
            #[cfg(not(target_os = "macos"))]
            let sidecar = {
                let mut configured = sidecar;
                for directory in native_dirs {
                    let sqlite_names = ["libsqlite3.dylib", "libsqlite3.so", "sqlite3.dll"];
                    if let Some(path) = sqlite_names.iter().map(|name| directory.join(name)).find(|path| path.exists()) {
                        configured = configured.env("DJ_SQLITE_LIBRARY", path.to_string_lossy().to_string());
                    }
                    let vec_names = ["vec0.dylib", "vec0.so", "vec0.dll"];
                    if let Some(path) = vec_names.iter().map(|name| directory.join(name)).find(|path| path.exists()) {
                        configured = configured.env("DJ_SQLITE_VEC_PATH", path.to_string_lossy().to_string());
                    }
                }
                configured
            };
            #[cfg(target_os = "macos")]
            let sidecar = {
                let _ = native_dirs;
                sidecar.env("DJ_DISABLE_SQLITE_VEC", "1")
            };
            #[cfg(target_os = "linux")]
            let sidecar = sidecar
                .env(
                    "DJ_BACKEND_ARCHIVE",
                    resources
                        .join("resources/backend/dianzi-junshi-server.gz")
                        .to_string_lossy()
                        .to_string(),
                )
                .env("DJ_DISABLE_SQLITE_VEC", "1");
            let (_events, child) = sidecar.spawn()?;
            app.manage(BackendProcess(Mutex::new(Some(child))));

            if !wait_for_backend(port, Duration::from_secs(10)) {
                return Err("本地服务没有及时启动，请重新打开电子军师".into());
            }
            let url = format!("http://127.0.0.1:{port}/").parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("电子军师")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 620.0)
                .resizable(true)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("电子军师桌面应用启动失败");

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
