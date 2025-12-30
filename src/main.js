// Wait for Tauri to be ready
const { invoke } = window.__TAURI__.core;

const counterDisplay = document.getElementById('counter');
const incrementBtn = document.getElementById('increment');
const decrementBtn = document.getElementById('decrement');
const resetBtn = document.getElementById('reset');

// Update counter display
function updateDisplay(value) {
    counterDisplay.textContent = value;
}

// Initialize counter from backend
async function init() {
    const count = await invoke('get_count');
    updateDisplay(count);
}

// Event listeners
incrementBtn.addEventListener('click', async () => {
    const count = await invoke('increment');
    updateDisplay(count);
});

decrementBtn.addEventListener('click', async () => {
    const count = await invoke('decrement');
    updateDisplay(count);
});

resetBtn.addEventListener('click', async () => {
    const count = await invoke('reset');
    updateDisplay(count);
});

// Initialize on load
init();
