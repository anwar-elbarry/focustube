// Prevents a CMD terminal window from appearing alongside the app in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    focustube_lib::run()
}
