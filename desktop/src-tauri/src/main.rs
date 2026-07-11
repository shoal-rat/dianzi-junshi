fn main() {
    if let Some(code) = dianzi_junshi_desktop_lib::run_keychain_cli() {
        std::process::exit(code);
    }
    dianzi_junshi_desktop_lib::run();
}
