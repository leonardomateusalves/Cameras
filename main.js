const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let go2rtcProcess = null;
let expressServer = null;

const BACKEND_PORT = process.env.LOCAL_AGENT_PORT || process.env.PORT || 8080;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// Helper function for HTTP requests from main process to local backend
function makeBackendRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BACKEND_URL);
    const postData = body ? JSON.stringify(body) : null;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ success: false, error: 'Resposta inválida do agente local' });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: `Agente local indisponível: ${err.message}` });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ success: false, error: 'Timeout de conexão com o agente local' });
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

// Determine paths for Go2RTC binary in dev and packaged modes
function getGo2RtcPath() {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'go2rtc.exe' : 'go2rtc';
  
  const possiblePaths = [
    path.join(__dirname, 'bin', binaryName),
    path.join(process.resourcesPath || '', 'bin', binaryName),
    path.join(app.getAppPath ? app.getAppPath() : __dirname, 'bin', binaryName),
    path.join(__dirname, binaryName),
    path.join(process.cwd(), binaryName)
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Ensure loopback-only Go2RTC YAML configuration in writable userData/temp directory
function ensureGo2RtcConfig(binaryDir) {
  try {
    const targetDir = app.getPath ? path.join(app.getPath('userData'), 'go2rtc') : binaryDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const configPath = path.join(targetDir, 'go2rtc.yaml');
    const yamlContent = `api:
  listen: "127.0.0.1:1984"
rtsp:
  listen: "127.0.0.1:8554"
webrtc:
  listen: "127.0.0.1:8555"
ffmpeg:
  bin: "ffmpeg"
`;
    fs.writeFileSync(configPath, yamlContent, 'utf-8');
    return configPath;
  } catch (err) {
    console.warn('[Go2RTC Config] Não foi possível gravar go2rtc.yaml:', err.message);
    return null;
  }
}

// Start Go2RTC binary
function startGo2Rtc() {
  const binaryPath = getGo2RtcPath();
  if (!binaryPath) {
    console.log('[Electron Main] Binário do Go2RTC não encontrado na pasta bin/. Assumindo serviço ativo na porta 1984.');
    return;
  }

  const binaryDir = path.dirname(binaryPath);
  const configPath = ensureGo2RtcConfig(binaryDir);
  const spawnArgs = configPath ? ['-config', configPath] : [];

  console.log(`[Electron Main] Iniciando Go2RTC a partir de: ${binaryPath} (Args: ${spawnArgs.join(' ')})`);
  try {
    go2rtcProcess = spawn(binaryPath, spawnArgs, {
      cwd: binaryDir,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    go2rtcProcess.stdout.on('data', (data) => {
      console.log(`[Go2RTC LOG] ${data.toString().trim()}`);
    });

    go2rtcProcess.stderr.on('data', (data) => {
      console.error(`[Go2RTC ERR] ${data.toString().trim()}`);
    });

    go2rtcProcess.on('exit', (code) => {
      console.warn(`[Go2RTC] Processo encerrado com código ${code}.`);
      go2rtcProcess = null;
    });

    // Verificação de prontidão da API Go2RTC
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const req = http.get('http://127.0.0.1:1984/api/streams', (res) => {
        if (res.statusCode === 200) {
          console.log('[Go2RTC READY] API respondendo com sucesso na porta 1984.');
          clearInterval(checkInterval);
        }
      });
      req.on('error', () => {
        if (attempts >= 10) {
          console.error('[Go2RTC ERROR] Não foi possível obter confirmação da API Go2RTC após 10 tentativas.');
          clearInterval(checkInterval);
        }
      });
      req.end();
    }, 500);

  } catch (err) {
    console.error('[Electron Main] Erro ao iniciar processo Go2RTC:', err);
  }
}

// Start Embedded Local Express Backend
function startLocalBackend() {
  try {
    const { app: expressApp, registerAllStreamsWithGo2Rtc, startAutomaticDiscoverySequence, initWebSocket } = require('./backend/app');
    expressServer = expressApp.listen(BACKEND_PORT, '127.0.0.1', () => {
      console.log(`[Electron Main] Agente Local Express rodando em http://127.0.0.1:${BACKEND_PORT}`);
      // setTimeout(registerAllStreamsWithGo2Rtc, 1500); // Comentado para habilitar somente streaming sob demanda ("lazy stream")
      setTimeout(startAutomaticDiscoverySequence, 2000);
    });

    if (initWebSocket) {
      initWebSocket(expressServer);
    }

    expressServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Electron Main] A porta ${BACKEND_PORT} já está em uso por outro processo do Agente.`);
      } else {
        console.error('[Electron Main] Erro no servidor Express:', err);
      }
    });
  } catch (err) {
    console.error('[Electron Main] Falha ao carregar o backend do agente local:', err);
  }
}

// Create Electron Window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Nexus RTSP Monitor - CFTV P2P',
    backgroundColor: '#030712',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  mainWindow.setMenu(null);
  Menu.setApplicationMenu(null);

  // Renderer process diagnostics
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron Main] Page failed to load (${errorCode}): ${errorDescription} at URL: ${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error(`[Electron Main] Renderer process crashed: ${details.reason}`);
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) {
      console.warn(`[Renderer Console Warning/Error] ${message} (${sourceId}:${line})`);
    }
  });

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const indexPath = path.join(__dirname, 'dist', 'index.html');
    console.log('[Electron Main] Loading production UI from:', indexPath);
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('[Electron Main] Error loading index.html:', err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup IPC Handlers
function setupIpcHandlers() {
  ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window-maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
  });

  ipcMain.handle('send-webrtc-sdp', async (event, { streamId, sdp }) => {
    return new Promise((resolve) => {
      const url = new URL('/api/webrtc', BACKEND_URL);
      url.searchParams.set('src', streamId);

      const postData = sdp || '';
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ success: true, sdp: data, status: res.statusCode });
          } else {
            resolve({ success: false, error: `Go2RTC/Backend respondeu com status HTTP ${res.statusCode}: ${data}` });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: `Agente local/Go2RTC indisponível: ${err.message}` });
      });

      req.setTimeout(6000, () => {
        req.destroy();
        resolve({ success: false, error: 'Timeout de sinalização SDP com Go2RTC' });
      });

      req.write(postData);
      req.end();
    });
  });

  ipcMain.handle('get-go2rtc-status', async () => {
    return new Promise((resolve) => {
      const req = http.get('http://127.0.0.1:1984/api', (res) => {
        resolve({ online: res.statusCode === 200, status: res.statusCode });
      });
      req.on('error', () => resolve({ online: false, error: 'Serviço Go2RTC indisponível na porta 1984' }));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve({ online: false, error: 'Timeout ao conectar no Go2RTC' });
      });
    });
  });

  ipcMain.handle('discover-cameras', async () => {
    return makeBackendRequest('POST', '/api/cameras/discover');
  });

  ipcMain.handle('get-cameras', async (event, tenantId) => {
    return makeBackendRequest('GET', `/api/cameras?tenantId=${encodeURIComponent(tenantId || 'tenant_default')}`);
  });

  ipcMain.handle('add-camera', async (event, camData) => {
    return makeBackendRequest('POST', '/api/cameras', camData);
  });

  ipcMain.handle('test-camera', async (event, rtspUrl) => {
    return makeBackendRequest('POST', '/api/cameras/test', { rtspUrl });
  });

  ipcMain.handle('remove-camera', async (event, id) => {
    return makeBackendRequest('DELETE', `/api/cameras/${encodeURIComponent(id)}`);
  });

  ipcMain.handle('get-discovery-status', async () => {
    return makeBackendRequest('GET', '/api/discovery-status');
  });
}

app.whenReady().then(() => {
  startLocalBackend();
  startGo2Rtc();
  setupIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function cleanupProcesses() {
  if (go2rtcProcess) {
    try { go2rtcProcess.kill(); } catch (e) {}
    go2rtcProcess = null;
  }
  if (expressServer) {
    try { expressServer.close(); } catch (e) {}
    expressServer = null;
  }
}

app.on('before-quit', cleanupProcesses);
app.on('will-quit', cleanupProcesses);
app.on('window-all-closed', () => {
  cleanupProcesses();
  if (process.platform !== 'darwin') app.quit();
});

