const { ipcRenderer } = require('electron');

const toggleSsh = document.getElementById('toggle-ssh');
const statusText = document.getElementById('statusText');
const terminalOutput = document.getElementById('terminalOutput');
const commandInput = document.getElementById('commandInput');
const clearBtn = document.getElementById('clearBtn');
const uploadDirInput = document.getElementById('uploadDir');
const uploadFileBtn = document.getElementById('uploadFileBtn');
const uploadStatus = document.getElementById('uploadStatus');

const tabConsole = document.getElementById('tabConsole');
const tabPins = document.getElementById('tabPins');
const consoleView = document.getElementById('consoleView');
const pinView = document.getElementById('pinView');

document.addEventListener('DOMContentLoaded', () => {
  fetch('pinout.html')
    .then(res => res.text())
    .then(html => {
      pinView.innerHTML = html;

      // If you have the "toggle-gpio-test" in pinout.html
      const toggleGpioTest = document.getElementById('toggle-gpio-test');
      const gpioTestLabel = document.getElementById('gpioTestLabel');
      if (toggleGpioTest) {
        toggleGpioTest.addEventListener('change', () => {
          ipcRenderer.send('run-gpio-test');
        });
      }

      // Build a context menu for setting pins high/low
      createPinContextMenu();
    })
    .catch(err => console.error('Failed to load pinout.html:', err));
});

function createPinContextMenu() {
  const menu = document.createElement('div');
  menu.id = 'pinContextMenu';
  menu.style.position = 'absolute';
  menu.style.zIndex = '9999';
  menu.style.background = '#fff';
  menu.style.border = '1px solid #ccc';
  menu.style.padding = '4px';
  menu.style.display = 'none';

  const setHighItem = document.createElement('div');
  setHighItem.textContent = 'Set Pin High';
  setHighItem.style.padding = '4px';
  setHighItem.style.cursor = 'pointer';

  const setLowItem = document.createElement('div');
  setLowItem.textContent = 'Set Pin Low';
  setLowItem.style.padding = '4px';
  setLowItem.style.cursor = 'pointer';

  menu.appendChild(setHighItem);
  menu.appendChild(setLowItem);
  document.body.appendChild(menu);

  let currentPin = null;

  // Show menu on right-click
  pinView.addEventListener('contextmenu', (e) => {
    const circle = e.target.closest('[data-pin]');
    if (!circle) return;
    e.preventDefault();

    currentPin = circle.dataset.pin;

    menu.style.top = e.pageY + 'px';
    menu.style.left = e.pageX + 'px';
    menu.style.display = 'block';
  });

  // Hide menu on click outside
  document.addEventListener('click', () => {
    menu.style.display = 'none';
  });

  // Set pin high
  setHighItem.addEventListener('click', () => {
    if (!currentPin) return;
    ipcRenderer.send('set-pin-state', { pin: currentPin, state: 'high' });
  });

  // Set pin low
  setLowItem.addEventListener('click', () => {
    if (!currentPin) return;
    ipcRenderer.send('set-pin-state', { pin: currentPin, state: 'low' });
  });
}

// Toggle SSH
toggleSsh.addEventListener('change', () => {
  ipcRenderer.send('toggle-ssh');
});

// Clear console
clearBtn.addEventListener('click', () => {
  terminalOutput.value = '';
});

// Send command on Enter
commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    ipcRenderer.send('send-command', commandInput.value);
    commandInput.value = '';
  }
});

// Set upload dir on Enter
uploadDirInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    ipcRenderer.send('set-upload-dir', uploadDirInput.value);
  }
});

// Open file dialog
uploadFileBtn.addEventListener('click', () => {
  ipcRenderer.send('open-file-dialog');
});

// Tabs
tabConsole.addEventListener('click', () => {
  consoleView.classList.remove('hidden');
  pinView.classList.add('hidden');
  tabConsole.classList.add('bg-blue-500', 'text-white');
  tabConsole.classList.remove('bg-gray-300', 'text-gray-700');
  tabPins.classList.add('bg-gray-300', 'text-gray-700');
  tabPins.classList.remove('bg-blue-500', 'text-white');
});

tabPins.addEventListener('click', () => {
  pinView.classList.remove('hidden');
  consoleView.classList.add('hidden');
  tabPins.classList.add('bg-blue-500', 'text-white');
  tabPins.classList.remove('bg-gray-300', 'text-gray-700');
  tabConsole.classList.add('bg-gray-300', 'text-gray-700');
  tabConsole.classList.remove('bg-blue-500', 'text-white');
});

// SSH status
ipcRenderer.on('ssh-status', (event, status) => {
  if (status === 'connected') {
    toggleSsh.checked = true;
    statusText.textContent = 'Connected';
    statusText.classList.remove('text-gray-600');
    statusText.classList.add('text-green-600');

    document.querySelectorAll('[data-static-pin="true"]').forEach((circle) => {
      circle.classList.remove('bg-gray-300');
      circle.classList.add('bg-green-500');
    });
  } else {
    toggleSsh.checked = false;
    statusText.textContent = 'Disconnected';
    statusText.classList.remove('text-green-600');
    statusText.classList.add('text-gray-600');

    document.querySelectorAll('[data-static-pin="true"]').forEach((circle) => {
      circle.classList.remove('bg-green-500');
      circle.classList.add('bg-gray-300');
    });
  }
});

// Console output
ipcRenderer.on('ssh-output', (event, data) => {
  terminalOutput.value += data;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
});

// Upload statuses
ipcRenderer.on('upload-dir-status', (event, msg) => {
  uploadStatus.textContent = msg;
});
ipcRenderer.on('upload-status', (event, msg) => {
  uploadStatus.textContent = msg;
});

// Real-time GPIO states
ipcRenderer.on('pin-states', (event, states) => {
  // e.g. {2:1, 3:0, 4:1, ...}
  Object.keys(states).forEach((pinStr) => {
    const pinNum = parseInt(pinStr, 10);
    const circle = document.querySelector(`[data-pin="${pinNum}"]`);
    if (!circle) return;
    if (states[pinNum] === 1) {
      circle.classList.remove('bg-gray-300');
      circle.classList.add('bg-green-500');
    } else {
      circle.classList.remove('bg-green-500');
      circle.classList.add('bg-gray-300');
    }
  });
});

// GPIO Test label
ipcRenderer.on('gpio-test-status', (event, isRunning) => {
  const toggleGpioTest = document.getElementById('toggle-gpio-test');
  const gpioTestLabel = document.getElementById('gpioTestLabel');
  if (!toggleGpioTest || !gpioTestLabel) return;

  if (isRunning) {
    toggleGpioTest.checked = true;
    gpioTestLabel.textContent = 'GPIO Test ON';
    gpioTestLabel.classList.remove('text-gray-600');
    gpioTestLabel.classList.add('text-green-600');
  } else {
    toggleGpioTest.checked = false;
    gpioTestLabel.textContent = 'GPIO Test OFF';
    gpioTestLabel.classList.remove('text-green-600');
    gpioTestLabel.classList.add('text-gray-600');
  }
});