const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Example commands.json loading (optional)
let commands = {
  "sshConnect": "ssh -tt -o ServerAliveInterval=10 -o ServerAliveCountMax=1 pi@cnc.local",
  "mkdirDir": "ssh -tt pi@cnc.local \"mkdir -p {dir}\"",
  "scpUpload": "scp {file} pi@cnc.local:\"{uploadDir}\"",
  "setPinOutputHigh": "ssh pi@cnc.local \"pinctrl set {pin} op pn dh\"",
  "setPinOutputLow":  "ssh pi@cnc.local \"pinctrl set {pin} op pn dl\""
};
try {
  const commandsPath = path.join(__dirname, 'commands.json');
  commands = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
} catch (err) {
  console.log('No custom commands.json found; using defaults.');
}

let mainWindow = null;
let sshProcess = null;
let gpioTestProcess = null;
let uploadDir = '~';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    icon: path.join(__dirname, 'CNCPIUI.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, 'CNCPIUI.png'));
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Toggle SSH connection
ipcMain.on('toggle-ssh', () => {
  if (!sshProcess) {
    // Start SSH with keepalives
    // e.g. -o ServerAliveInterval=10, -o ServerAliveCountMax=1
    // means every 10s it sends a keepalive, if it fails once => close
    sshProcess = spawn(commands.sshConnect, { shell: true, env: process.env });

    sshProcess.stdout.on('data', (data) => {
      mainWindow?.webContents.send('ssh-output', data.toString());
    });
    sshProcess.stderr.on('data', (data) => {
      mainWindow?.webContents.send('ssh-output', data.toString());
    });

    // If SSH closes (lost connection, user logs out, etc.)
    sshProcess.on('close', () => {
      sshProcess = null;
      // Also kill GPIO test if running
      if (gpioTestProcess) {
        gpioTestProcess.kill();
        gpioTestProcess = null;
        mainWindow?.webContents.send('gpio-test-status', false);
      }
      // Notify UI
      mainWindow?.webContents.send('ssh-status', 'disconnected');
    });
    sshProcess.on('error', (err) => {
      mainWindow?.webContents.send('ssh-output', 'SSH Error: ' + err.message);
    });

    // We just connected
    mainWindow?.webContents.send('ssh-status', 'connected');
  } else {
    // Disconnect
    sshProcess.kill();
    sshProcess = null;
    if (gpioTestProcess) {
      gpioTestProcess.kill();
      gpioTestProcess = null;
      mainWindow?.webContents.send('gpio-test-status', false);
    }
    mainWindow?.webContents.send('ssh-status', 'disconnected');
  }
});

// Send command to SSH
ipcMain.on('send-command', (event, command) => {
  if (sshProcess && sshProcess.stdin.writable) {
    sshProcess.stdin.write(command + '\n');
  } else {
    mainWindow?.webContents.send('ssh-output', 'Not connected.\n');
  }
});

// Set upload directory
ipcMain.on('set-upload-dir', (event, dir) => {
  uploadDir = dir || '~';
  const mkdirCmd = commands.mkdirDir.replace('{dir}', uploadDir);
  const mkdirProcess = spawn(mkdirCmd, { shell: true, env: process.env });
  mkdirProcess.on('close', code => {
    if (code === 0) {
      mainWindow?.webContents.send('upload-dir-status', `Upload directory set to ${uploadDir}`);
    } else {
      mainWindow?.webContents.send('upload-dir-status', `Failed to create directory. Exit code: ${code}`);
    }
  });
  mkdirProcess.on('error', err => {
    mainWindow?.webContents.send('upload-dir-status', 'Error: ' + err.message);
  });
});

// Open file dialog & upload
ipcMain.on('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    if (!uploadDir) uploadDir = '~';
    for (const filePath of result.filePaths) {
      const scpCmd = commands.scpUpload
        .replace('{file}', filePath)
        .replace('{uploadDir}', uploadDir);
      const scpProcess = spawn(scpCmd, { shell: true, env: process.env });
      scpProcess.on('close', code => {
        mainWindow?.webContents.send('upload-status', `Uploaded ${filePath} (exit ${code})`);
      });
      scpProcess.on('error', err => {
        mainWindow?.webContents.send('upload-status', 'Upload error: ' + err.message);
      });
    }
  }
});

// Toggle continuous GPIO_test.py
ipcMain.on('run-gpio-test', () => {
  if (!sshProcess) {
    mainWindow?.webContents.send('ssh-output', '[GPIO TEST] Not connected.\n');
    mainWindow?.webContents.send('gpio-test-status', false);
    return;
  }
  if (gpioTestProcess) {
    gpioTestProcess.kill();
    gpioTestProcess = null;
    mainWindow?.webContents.send('ssh-output', '[GPIO TEST] Stopped.\n');
    mainWindow?.webContents.send('gpio-test-status', false);
  } else {
    gpioTestProcess = spawn('ssh', [
      'pi@cnc.local',
      'python3',
      '/home/pi/GPIO_test.py'
    ], { shell: true, env: process.env });

    mainWindow?.webContents.send('ssh-output', '[GPIO TEST] Started.\n');
    mainWindow?.webContents.send('gpio-test-status', true);

    gpioTestProcess.stdout.on('data', (data) => {
      try {
        const states = JSON.parse(data.toString());
        mainWindow?.webContents.send('pin-states', states);
      } catch (err) {
        console.error('GPIO Test parse error:', err);
      }
    });
    gpioTestProcess.stderr.on('data', (data) => {
      mainWindow?.webContents.send('ssh-output', '[GPIO TEST Error] ' + data.toString() + '\n');
    });
    gpioTestProcess.on('close', (code) => {
      gpioTestProcess = null;
      mainWindow?.webContents.send('ssh-output', `[GPIO TEST] Exited with code ${code}\n`);
      mainWindow?.webContents.send('gpio-test-status', false);
    });
    gpioTestProcess.on('error', (err) => {
      mainWindow?.webContents.send('ssh-output', '[GPIO TEST] Spawn error: ' + err.message + '\n');
      mainWindow?.webContents.send('gpio-test-status', false);
    });
  }
});

// Right-click => set pin state
ipcMain.on('set-pin-state', (event, { pin, state }) => {
  if (!sshProcess) {
    mainWindow?.webContents.send('ssh-output', 'Not connected.\n');
    return;
  }
  let cmd;
  if (state === 'high') {
    cmd = commands.setPinOutputHigh.replace('{pin}', pin);
  } else {
    cmd = commands.setPinOutputLow.replace('{pin}', pin);
  }

  const proc = spawn(cmd, { shell: true, env: process.env });
  proc.stdout.on('data', (data) => {
    mainWindow?.webContents.send('ssh-output', '[GPIO] ' + data.toString());
  });
  proc.stderr.on('data', (data) => {
    mainWindow?.webContents.send('ssh-output', '[GPIO Error] ' + data.toString());
  });
  proc.on('close', (code) => {
    mainWindow?.webContents.send('ssh-output', `[GPIO] Pin ${pin} set ${state}, exit code ${code}\n`);
  });
  proc.on('error', (err) => {
    mainWindow?.webContents.send('ssh-output', `[GPIO Error] ${err.message}\n`);
  });
});