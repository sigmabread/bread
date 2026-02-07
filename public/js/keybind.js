const KEYBIND_ACTIVATED_KEY = 'keybindActivated';
const KEYBIND_TIMER_END_KEY = 'keybindTimerEnd';
const KEY_SEQUENCE = 'kibips';
let keySequence = [];
let timerInterval;

// Function to check and initialize the keybind state on page load
function initKeybindState() {
    const timerEnd = sessionStorage.getItem(KEYBIND_TIMER_END_KEY);
    if (timerEnd) {
        const remainingTime = Math.round((parseInt(timerEnd, 10) - Date.now()) / 1000);
        if (remainingTime > 0) {
            sessionStorage.setItem(KEYBIND_ACTIVATED_KEY, 'true');
            disableAllInput();
            startTimer(remainingTime);
        } else {
            // Timer expired while on another page
            clearKeybindState();
        }
    }
}

function handleGlobalKeyDown(event) {
    if (sessionStorage.getItem(KEYBIND_ACTIVATED_KEY) === 'true') {
        event.preventDefault();
        event.stopPropagation();
        return;
    }

    keySequence.push(event.key.toLowerCase());
    // Keep the sequence at the length of the target sequence
    if (keySequence.length > KEY_SEQUENCE.length) {
        keySequence.shift();
    }

    if (keySequence.join('') === KEY_SEQUENCE) {
        keySequence = [];
        const duration = 600; // 10 minutes
        const timerEnd = Date.now() + duration * 1000;
        sessionStorage.setItem(KEYBIND_TIMER_END_KEY, timerEnd.toString());
        sessionStorage.setItem(KEYBIND_ACTIVATED_KEY, 'true');
        disableAllInput();
        startTimer(duration);
    }
}

function startTimer(duration) {
    let timerElement = document.getElementById('keybind-timer');
    if (!timerElement) {
        timerElement = document.createElement('div');
        timerElement.id = 'keybind-timer';
        timerElement.style.position = 'fixed';
        timerElement.style.bottom = '10px';
        timerElement.style.left = '10px';
        timerElement.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        timerElement.style.color = 'white';
        timerElement.style.padding = '8px 12px';
        timerElement.style.borderRadius = '5px';
        timerElement.style.fontFamily = 'monospace';
        timerElement.style.zIndex = '999999';
        document.body.appendChild(timerElement);
    }

    let timer = duration;
    timerInterval = setInterval(() => {
        const minutes = Math.floor(timer / 60);
        const seconds = timer % 60;
        timerElement.textContent = `Input disabled: ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

        if (--timer < 0) {
            clearInterval(timerInterval);
            enableAllInput();
            if (timerElement.parentNode) {
                timerElement.parentNode.removeChild(timerElement);
            }
        }
    }, 1000);
}

function preventDefault(event) {
    event.preventDefault();
    event.stopPropagation();
}

function disableAllInput() {
    // Hide the main app and key overlay, show nothing but the timer
    const proxyApp = document.getElementById('proxyApp');
    const keyOverlay = document.getElementById('keyOverlay');
    if (proxyApp) proxyApp.classList.add('hidden');
    if (keyOverlay) keyOverlay.classList.add('hidden');

    window.addEventListener('keydown', preventDefault, true);
    window.addEventListener('keyup', preventDefault, true);
    window.addEventListener('keypress', preventDefault, true);
}

function clearKeybindState() {
    sessionStorage.removeItem(KEYBIND_ACTIVATED_KEY);
    sessionStorage.removeItem(KEYBIND_TIMER_END_KEY);
}

function getDeviceId() {
    const DEVICE_ID_KEY = 'bread_device_id';
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
        id = 'dev_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
        localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
}

function enableAllInput() {
    clearKeybindState();
    window.removeEventListener('keydown', preventDefault, true);
    window.removeEventListener('keyup', preventDefault, true);
    window.removeEventListener('keypress', preventDefault, true);

    // Clear the stored key to force re-authentication after reload
    try {
        const deviceId = getDeviceId();
        localStorage.removeItem('bread_used_key_' + deviceId);
    } catch (_) {
        // Ignore potential errors in case local storage is disabled
    }

    // Reload the page to restore the correct UI state (now locked)
    location.reload();
}

document.addEventListener('keydown', handleGlobalKeyDown);
// Initialize on script load
initKeybindState();
