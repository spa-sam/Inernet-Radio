// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::State;

// Application state to store the counter
struct CounterState(Mutex<i32>);

// Command to increment counter and return new value
#[tauri::command]
fn increment(state: State<CounterState>) -> i32 {
    let mut counter = state.0.lock().unwrap();
    *counter += 1;
    *counter
}

// Command to decrement counter and return new value
#[tauri::command]
fn decrement(state: State<CounterState>) -> i32 {
    let mut counter = state.0.lock().unwrap();
    *counter -= 1;
    *counter
}

// Command to reset counter
#[tauri::command]
fn reset(state: State<CounterState>) -> i32 {
    let mut counter = state.0.lock().unwrap();
    *counter = 0;
    *counter
}

// Command to get current counter value
#[tauri::command]
fn get_count(state: State<CounterState>) -> i32 {
    let counter = state.0.lock().unwrap();
    *counter
}

fn main() {
    tauri::Builder::default()
        .manage(CounterState(Mutex::new(0)))
        .invoke_handler(tauri::generate_handler![increment, decrement, reset, get_count])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
