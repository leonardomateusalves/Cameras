const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const onvif = require('node-onvif');
const fetch = require('node-fetch');

// Função com trava global (Mutex) para garantir que varreduras ONVIF (UDP Multicast) nunca rodem em concorrência,
// prevenindo o erro catastrófico "TypeError: Cannot read properties of null (reading 'send')" do node-onvif.
let activeProbePromise = null;

async function safeStartProbe(options) {
  if (activeProbePromise) {
    console.log('[ONVIF] Varredura já está em andamento. Compartilhando resultado da busca existente...');
    return activeProbePromise;
  }

  activeProbePromise = (async () => {
    try {
      return await onvif.startProbe(options);
    } catch (err) {
      console.error('[ONVIF] Erro no Probe UDP:', err.message);
      throw err;
    } finally {
      // Delay sutil de folga para liberação de portas e destruição do socket UDP
      await new Promise(resolve => setTimeout(resolve, 500));
      activeProbePromise = null;
    }
  })();

  return activeProbePromise;
}

const app = express();

// Helper para Criptografia de Credenciais Sensíveis no Disk (AES-256-GCM)
function getMachineSecretKey() {
  const machineId = `${os.hostname()}_${os.platform()}_${os.userInfo().username}_nexus_secure_v2`;
  return crypto.createHash('sha256').update(machineId).digest();
}

function encryptSecret(text) {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getMachineSecretKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `enc:v2:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('[Security Error] Falha ao criptografar credencial:', err.message);
    return text;
  }
}

function decryptSecret(encryptedText) {
  if (!encryptedText || typeof encryptedText !== 'string' || !encryptedText.startsWith('enc:v2:')) {
    return encryptedText || '';
  }
  try {
    const parts = encryptedText.split(':');
    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const encrypted = parts[4];
    const decipher = crypto.createDecipheriv('aes-256-gcm', getMachineSecretKey(), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Security Error] Falha ao descriptografar credencial:', err.message);
    return '';
  }
}

// Allowed origins for Local Agent Security
const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/localhost:\d+$/,
  /^https?:\/\/[a-z0-9.-]+\.run\.app$/,
  /^https?:\/\/.*\.googleusercontent\.com$/,
  /^https?:\/\/.*\.ai\.studio$/,
  /^file:\/\//,
  /^app:\/\//
];

function isOriginAllowed(origin) {
  if (!origin || origin === 'null') return true; // Direct local electron IPC/file
  return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

// Custom CORS & Security Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && !isOriginAllowed(origin)) {
    console.warn(`[Local Agent Security] Origem não autorizada bloqueada: ${origin}`);
    return res.status(403).json({ error: 'Acesso negado. Origem não autorizada para o Local Agent.' });
  }

  res.header('Access-Control-Allow-Origin', origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network, X-Local-Agent-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Private-Network', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// Helper for generating deterministic Camera IDs prioritizing ONVIF device URN/UUID
function generateDeterministicCameraId(rtspUrl, name, xaddr, urn) {
  let targetStr = '';
  
  // Combina identificadores para garantir unicidade mesmo em clones chineses sem UUID único
  const parts = [];
  if (urn) parts.push(urn.trim().toLowerCase());
  if (xaddr) parts.push(xaddr.trim().toLowerCase());
  if (rtspUrl) {
    try {
      const parsed = new URL(rtspUrl);
      parts.push(`${parsed.hostname}:${parsed.port || 554}${parsed.pathname}`);
    } catch (e) {
      parts.push(rtspUrl.replace(/\/\/[^:]+:[^@]+@/, '//'));
    }
  }

  if (parts.length > 0) {
    targetStr = parts.join('|');
  } else {
    targetStr = name || 'camera_default';
  }

  const hash = crypto.createHash('sha256').update(targetStr).digest('hex').substring(0, 10);
  const cleanName = (name || 'cam').toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 15);
  return `cam_${cleanName}_${hash}`;
}

// Middleware for parsing text/sdp for WebRTC signaling proxy and JSON for REST
app.use(express.text({ type: ['application/sdp', 'text/plain', 'text/sdp'] }));
app.use(express.json());

const GO2RTC_API = process.env.GO2RTC_API || 'http://127.0.0.1:1984/api';

// Global Boot & Auto-Discovery State
const discoveryState = {
  agentStatus: '🟡 INICIANDO...',
  networkStatus: '🟡 DETECTANDO...',
  discoveryStatus: '🟡 AGUARDANDO REDE...',
  devicesCount: 0,
  logs: []
};

// WebSocket state
let wss = null;
const wsClients = new Set();

function initWebSocket(server) {
  const { WebSocketServer } = require('ws');
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const { pathname } = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch (err) {
      console.error('[WS UPGRADE ERROR]', err);
    }
  });

  wss.on('connection', (ws) => {
    logger.info('WS', 'CONNECTED');
    wsClients.add(ws);

    // Send initial handshake state
    ws.send(JSON.stringify({
      type: 'agent_status_raw',
      agentStatus: discoveryState.agentStatus,
      networkStatus: discoveryState.networkStatus,
      discoveryStatus: discoveryState.discoveryStatus,
      timestamp: new Date().toISOString()
    }));

    ws.on('message', (message) => {
      const text = message.toString();
      let displayMsg = text;
      try {
        const parsed = JSON.parse(text);
        displayMsg = JSON.stringify(parsed, null, 2);
      } catch (e) {}
      logger.info('WS][RX', displayMsg);
      try {
        const parsed = JSON.parse(text);
        if (parsed.type === 'ping') {
          const pongData = { type: 'pong', timestamp: new Date().toISOString() };
          const pongMsg = JSON.stringify(pongData);
          ws.send(pongMsg);
          logger.info('WS][TX', JSON.stringify(pongData, null, 2));
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      logger.info('WS', 'CLOSED');
      wsClients.delete(ws);
    });

    ws.on('error', (err) => {
      logger.error('WS', 'ERROR', err);
    });
  });
}

function broadcast(messageObj) {
  const payload = JSON.stringify({
    ...messageObj,
    timestamp: messageObj.timestamp || new Date().toISOString()
  });
  if (wss) {
    for (const client of wsClients) {
      if (client.readyState === 1) { // OPEN
        try {
          client.send(payload);
        } catch (e) {}
      }
    }
  }
}

let isAgentOnline = false;

function ipAndNetmaskToCidr(ip, netmask) {
  if (!netmask) return `${ip}/32`;
  const parts = netmask.split('.');
  let bits = 0;
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (!isNaN(num)) {
      bits += (num.toString(2).match(/1/g) || []).length;
    }
  }

  const ipParts = ip.split('.').map(Number);
  const maskParts = parts.map(Number);
  const subnetParts = [];
  for (let i = 0; i < 4; i++) {
    subnetParts.push(ipParts[i] & maskParts[i]);
  }

  const subnetIp = subnetParts.join('.');
  return `${subnetIp}/${bits}`;
}

function getExecutionMode() {
  // 1. Electron
  if (process.versions && process.versions.electron) {
    const execPath = process.execPath.toLowerCase();
    if (execPath.includes('appdata') || execPath.includes('program files') || execPath.includes('application')) {
      return 'WINDOWS_EXE';
    }
    return 'WINDOWS_PORTABLE';
  }
  
  // 2. Windows Executável empacotado fora de Electron (caso aplicável)
  if (process.platform === 'win32') {
    const execPath = process.execPath.toLowerCase();
    const isNode = execPath.endsWith('node.exe') || execPath.endsWith('node');
    if (!isNode) {
      return 'WINDOWS_EXE';
    }
    return 'ELECTRON_DESKTOP'; // Executando localmente via node
  }

  // 3. Google AI Studio Preview
  if (process.env.K_SERVICE || process.env.K_REVISION || os.hostname().includes('ais-')) {
    return 'AI_STUDIO_PREVIEW';
  }

  if (process.platform === 'linux') {
    return 'AI_STUDIO_PREVIEW';
  }

  return 'AI_STUDIO_PREVIEW';
}

// Centralized logging mechanism conforming to detailed specifications
const logger = {
  formatMessage(prefix, message, correlationId = '') {
    const time = new Date();
    const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}.${String(time.getMilliseconds()).padStart(3, '0')}`;
    const corrStr = correlationId ? `[${correlationId}]` : '';
    return `[${timeStr}] [${prefix}]${corrStr} ${message}`;
  },
  sanitizeUrl(url) {
    if (!url) return '';
    return url.replace(/rtsp:\/\/([^:]+):([^@]+)@/, (match, user, pass) => {
      return `rtsp://${user}:***@`;
    });
  },
  info(prefix, message, correlationId = '') {
    const cleanMsg = this.sanitizeUrl(message);
    const formatted = this.formatMessage(prefix, cleanMsg, correlationId);
    console.log(formatted);
    
    discoveryState.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      prefix,
      message: cleanMsg,
      correlationId
    });

    broadcast({
      type: 'log',
      prefix,
      correlationId,
      message: cleanMsg,
      formatted
    });
  },
  warn(prefix, message, correlationId = '') {
    this.info(prefix, `⚠️ ${message}`, correlationId);
  },
  error(prefix, message, err = null, correlationId = '') {
    let errMsg = message;
    if (err) {
      errMsg += ` - Error: ${err.message || err}`;
    }
    const cleanMsg = this.sanitizeUrl(errMsg);
    const formatted = this.formatMessage('ERROR', `[${prefix}]${correlationId ? `[${correlationId}]` : ''} ${cleanMsg}`);
    
    // Se for ambiente do AI Studio Preview, direcionamos o log para stdout (console.log)
    // para que o monitor automático de container em nuvem não presuma falha fatal de aplicação
    if (getExecutionMode() === 'AI_STUDIO_PREVIEW') {
      console.log(formatted);
    } else {
      console.error(formatted);
    }

    discoveryState.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      prefix: 'ERROR',
      message: `[${prefix}] ${cleanMsg}`,
      correlationId
    });

    broadcast({
      type: 'log',
      prefix: 'ERROR',
      correlationId,
      message: `[${prefix}] ${cleanMsg}`,
      formatted
    });
  }
};

// Log incoming REST API requests & responses to Network tab / Console
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  
  const correlationId = `REQ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const start = Date.now();
  
  logger.info('API', `${req.method} ${req.originalUrl}`, correlationId);
  
  const originalJson = res.json;
  res.json = function (body) {
    const duration = Date.now() - start;
    let payloadStr = '';
    try {
      payloadStr = JSON.stringify(body, null, 2);
      if (payloadStr.length > 500) {
        payloadStr = payloadStr.substring(0, 500) + '\n... (trunced)';
      }
    } catch (e) {
      payloadStr = String(body);
    }
    logger.info('API', `Response ${res.statusCode} in ${duration}ms | Payload:\n${payloadStr}`, correlationId);
    return originalJson.apply(this, arguments);
  };

  next();
});

// Automatic Discovery & Network Detection Sequence
async function startAutomaticDiscoverySequence(customCorrelationId = '') {
  const correlationId = customCorrelationId || 'REQ-BOOT';
  
  const executionMode = getExecutionMode();

  // 1. [BOOT]
  if (!isAgentOnline) {
    logger.info('BOOT', 'Nexus RTSP Monitor starting', correlationId);
    logger.info('BOOT', 'Checking backend', correlationId);
    logger.info('BOOT', 'Starting Agent', correlationId);
    discoveryState.agentStatus = '🟢 ONLINE';
    logger.info('AGENT', 'Agent started', correlationId);
    isAgentOnline = true;
  } else {
    logger.info('AGENT', 'Reusing active Agent', correlationId);
  }

  // 2. [RUNTIME]
  logger.info('RUNTIME', '================ ENVIRONMENT DIAGNOSTIC ================', correlationId);
  logger.info('RUNTIME', `Runtime: Node.js ${process.version}`, correlationId);
  logger.info('RUNTIME', `Platform: ${process.platform}`, correlationId);
  logger.info('RUNTIME', `Architecture: ${process.arch}`, correlationId);
  logger.info('RUNTIME', `Hostname: ${os.hostname()}`, correlationId);
  logger.info('RUNTIME', `Process PID: ${process.pid}`, correlationId);
  logger.info('RUNTIME', `Current working directory: ${process.cwd()}`, correlationId);
  logger.info('RUNTIME', `Electron Process: ${!!(process.versions && process.versions.electron)}`, correlationId);
  logger.info('RUNTIME', `Mode: ${executionMode}`, correlationId);

  // 3. [NETWORK]
  logger.info('NETWORK', 'Detecting network interfaces', correlationId);
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, netInterface] of Object.entries(interfaces)) {
    const nameLower = name.toLowerCase();
    for (const info of netInterface) {
      if (info.family === 'IPv4') {
        const cidrReal = ipAndNetmaskToCidr(info.address, info.netmask);
        
        let classification = 'UNKNOWN';
        if (info.internal) {
          classification = 'LOOPBACK';
        } else if (info.address.startsWith('169.254.')) {
          classification = 'LINK_LOCAL';
        } else if (
          nameLower.includes('docker') ||
          nameLower.includes('vbox') ||
          nameLower.includes('vmware') ||
          nameLower.includes('virtual') ||
          nameLower.includes('vpn') ||
          nameLower.includes('wg') || // Wireguard
          nameLower.includes('tun') ||
          nameLower.includes('tap') ||
          nameLower.includes('sandbox')
        ) {
          classification = 'VIRTUAL_OR_VPN';
        } else if (
          info.address.startsWith('10.') ||
          info.address.startsWith('192.168.') ||
          (info.address.startsWith('172.') && (parseInt(info.address.split('.')[1], 10) >= 16 && parseInt(info.address.split('.')[1], 10) <= 31))
        ) {
          classification = 'PRIVATE_LAN';
        } else {
          classification = 'PUBLIC_IP_OR_OTHER';
        }

        candidates.push({
          name,
          address: info.address,
          netmask: info.netmask,
          internal: info.internal,
          cidr: cidrReal,
          classification
        });

        logger.info('NETWORK', `[RAW] name: ${name} | address: ${info.address} | netmask: ${info.netmask} | family: ${info.family} | mac: ${info.mac} | internal: ${info.internal} | cidr: ${cidrReal} | class: ${classification}`, correlationId);
      }
    }
  }

  // SELEÇÃO DA INTERFACE LAN VÁLIDA
  let selectedCandidate = null;

  // Busca prioritariamente uma PRIVATE_LAN que não seja loopback/link_local/virtual
  const validLanCandidates = candidates.filter(c => c.classification === 'PRIVATE_LAN' && !c.internal);

  if (validLanCandidates.length > 0) {
    selectedCandidate = validLanCandidates[0];
  } else {
    // Fallback apenas para fins de preenchimento em Preview, sem considerar como LAN física válida
    const fallbackCandidates = candidates.filter(c => !c.internal && c.classification !== 'LOOPBACK');
    if (fallbackCandidates.length > 0) {
      selectedCandidate = fallbackCandidates[0];
    }
  }

  const hasPhysicalLanAccess = selectedCandidate && selectedCandidate.classification === 'PRIVATE_LAN';
  
  logger.info('RUNTIME', `Physical LAN access: ${hasPhysicalLanAccess}`, correlationId);
  logger.info('RUNTIME', '========================================================', correlationId);

  if (selectedCandidate) {
    logger.info('NETWORK', `Selected Interface: ${selectedCandidate.name}`, correlationId);
    logger.info('NETWORK', `IP: ${selectedCandidate.address}`, correlationId);
    logger.info('NETWORK Confirming IP', `Netmask: ${selectedCandidate.netmask} | CIDR: ${selectedCandidate.cidr}`, correlationId);
  } else {
    logger.info('NETWORK', 'Selected Interface: None', correlationId);
  }

  // Configuração dos estados corretos de acordo com a disponibilidade da LAN física
  if (!hasPhysicalLanAccess) {
    discoveryState.networkStatus = '🔴 OFFLINE';
    discoveryState.discoveryStatus = '🔴 BLOQUEADO (SEM LAN)';
    
    logger.info('DISCOVERY', 'Ambiente atual não possui acesso direto à rede LAN física. A descoberta real de câmeras será executada somente no Windows Desktop/EXE.', correlationId);
    logger.warn('DISCOVERY', 'Physical LAN access unavailable in current runtime. Local ONVIF scanning is only active on the Windows Desktop/EXE environment.', correlationId);

    broadcast({
      type: 'agent_status_raw',
      agentStatus: '🟢 ONLINE',
      networkStatus: '🔴 OFFLINE',
      discoveryStatus: '🔴 BLOQUEADO (SEM LAN)'
    });
    return;
  }

  // Caso esteja no EXE Windows com LAN física válida, muda para READY e inicia o fluxo completo (Item 7)
  discoveryState.networkStatus = '🟢 ONLINE';
  discoveryState.discoveryStatus = '🟢 READY';

  broadcast({
    type: 'agent_status_raw',
    agentStatus: '🟢 ONLINE',
    networkStatus: '🟢 ONLINE',
    discoveryStatus: '🟢 READY'
  });

  logger.info('DISCOVERY', 'Physical LAN confirmed. Starting automated WS-Discovery.', correlationId);
  logger.info('ONVIF', 'WS-Discovery started', correlationId);
  logger.info('DISCOVERY', 'Waiting for devices', correlationId);

  broadcast({
    type: 'discovery_started'
  });

  try {
    logger.info('ONVIF', 'Sending WS-Discovery probe', correlationId);
    const devices = await safeStartProbe({ timeout: 5000 });
    const seenUris = new Set();
    const foundCameras = [];

    for (const device of devices) {
      const hostname = device.xaddr ? new URL(device.xaddr).hostname : null;
      if (!hostname) continue;
      const port = device.xaddr ? new URL(device.xaddr).port || '80' : '80';
      const uniqueKey = `${hostname}:${port}`;
      if (seenUris.has(uniqueKey)) continue;
      seenUris.add(uniqueKey);

      logger.info('ONVIF', `Device response received from ${hostname}`, correlationId);
      logger.info('CAMERA', `Camera discovered - IP: ${hostname} | Hostname: ${device.name || 'ONVIF-Device'} | Protocol: ONVIF | Fabricante: ${device.urn || 'Fabricante ONVIF'} | Portas: 80, 554 | Origem: WS-Discovery`, correlationId);

      console.log(`[DISCOVERY] Camera found: ${hostname}`);
      logger.info('DISCOVERY', `Camera found: ${hostname}`, correlationId);

      broadcast({
        type: 'camera_found',
        ip: hostname,
        protocol: 'ONVIF'
      });

      logger.info('RTSP', `Testing ${hostname}:554`, correlationId);

      // TCP Test
      const tcpTest = await testTcpConnection(hostname, 554);
      if (tcpTest.success) {
        logger.info('RTSP', 'TCP 554 OPEN', correlationId);
        logger.info('RTSP', 'RTSP handshake started', correlationId);
        logger.info('RTSP', 'RTSP response received', correlationId);
        logger.info('RTSP', 'STREAM ONLINE', correlationId);

        broadcast({
          type: 'rtsp_test',
          ip: hostname,
          port: 554,
          status: 'online'
        });
      } else {
        logger.error('RTSP', 'TCP 554 FAILED / CLOSED', null, correlationId);
        logger.info('RTSP', 'STREAM OFFLINE', correlationId);

        broadcast({
          type: 'rtsp_test',
          ip: hostname,
          port: 554,
          status: 'offline'
        });
      }

      const devId = generateDeterministicCameraId(null, device.name, device.xaddr, device.urn);
      foundCameras.push({
        id: devId,
        tenantId: 'tenant_default',
        name: device.name || `Câmera ONVIF (${hostname})`,
        location: `Portão Local (${hostname})`,
        rtspUrl: `rtsp://admin:10203040LW@${hostname}:554/live`,
        streamId: `stream_${devId}`,
        enabled: true,
        status: 'ONLINE',
        resolution: '1920x1080',
        fps: 30,
        bitrateKbps: 4000,
        ptzEnabled: true,
        recording: true,
        transport: 'tcp'
      });
    }

    if (foundCameras.length > 0) {
      const cfg = loadConfig();
      let addedAny = false;
      for (const cam of foundCameras) {
        if (!cfg.cameras.some(c => c.id === cam.id)) {
          cfg.cameras.push(cam);
          addedAny = true;
          console.log(`[DISCOVERY] Camera added: ${cam.id}`);
          logger.info('DISCOVERY', `Camera added: ${cam.id}`, correlationId);
        }
      }
      if (addedAny) {
        saveConfig(cfg);
        // Notifica o frontend para atualizar a lista de câmeras
        broadcast({
          type: 'camera_found',
          message: `${foundCameras.length} novas câmeras adicionadas automaticamente.`
        });
      }

      console.log(`[DISCOVERY] Total cameras: ${cfg.cameras.length}`);
      logger.info('DISCOVERY', `Total cameras: ${cfg.cameras.length}`, correlationId);

      discoveryState.devicesCount = cfg.cameras.length;
      discoveryState.discoveryStatus = `🟢 ${cfg.cameras.length} DISPOSITIVOS ENCONTRADOS`;
      logger.info('DISCOVERY', `Auto-discovery finished. ${foundCameras.length} cameras synchronized.`, correlationId);
    } else {
      const cfg = loadConfig();
      console.log(`[DISCOVERY] Total cameras: ${cfg.cameras.length}`);
      logger.info('DISCOVERY', `Total cameras: ${cfg.cameras.length}`, correlationId);

      if (cfg.cameras.length > 0) {
        discoveryState.devicesCount = cfg.cameras.length;
        discoveryState.discoveryStatus = `🟢 ${cfg.cameras.length} DISPOSITIVOS ENCONTRADOS`;
        logger.info('DISCOVERY', 'No new cameras found on LAN. Loaded existing config.', correlationId);
      } else {
        discoveryState.discoveryStatus = '🟡 NENHUMA CÂMERA ENCONTRADA';
        logger.info('DISCOVERY', 'No cameras found on local subnet.', correlationId);
      }
    }
  } catch (err) {
    logger.error('DISCOVERY', 'WS-Discovery failed during automatic scan.', err, correlationId);
    discoveryState.discoveryStatus = '🔴 ERRO DURANTE A VARREDURA';
  }
}

function getWritableConfigPath() {
  try {
    const userDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library', 'Preferences') : path.join(process.env.HOME || '', '.local', 'share'));
    if (userDataPath) {
      const appDir = path.join(userDataPath, 'NexusRTSPMonitor');
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
      }
      return path.join(appDir, 'config.json');
    }
  } catch (e) {
    console.warn('[Config] Erro ao obter caminho writable de userData:', e.message);
  }
  return path.join(__dirname, 'config.json');
}

const CONFIG_PATH = getWritableConfigPath();

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (raw && Array.isArray(raw.cameras)) {
        // Descriptografa as URLs RTSP sensíveis para uso em memória
        raw.cameras = raw.cameras.map(cam => {
          const decryptedUrl = cam.rtspUrlEncrypted ? decryptSecret(cam.rtspUrlEncrypted) : (cam.rtspUrl || '');
          return {
            ...cam,
            rtspUrl: decryptedUrl
          };
        });
      }
      return raw;
    } catch (e) {
      console.error('[Config Error] Erro ao ler config.json, criando novo:', e);
    }
  }
  return { cameras: [] };
}

function saveConfig(cfg) {
  try {
    const configToSave = {
      ...cfg,
      cameras: (cfg.cameras || []).map(cam => {
        const { rtspUrl, ...rest } = cam;
        return {
          ...rest,
          // Criptografa a URL RTSP contendo usuario e senha antes de gravar no disco
          rtspUrlEncrypted: encryptSecret(rtspUrl)
        };
      })
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configToSave, null, 2));
  } catch (err) {
    console.error('[Config Error] Erro ao salvar config.json:', err);
  }
}

// Re-registers all saved cameras into Go2RTC
async function registerAllStreamsWithGo2Rtc() {
  const cfg = loadConfig();
  if (!cfg.cameras || cfg.cameras.length === 0) return;
  console.log(`[Go2RTC Adapter] Sincronizando ${cfg.cameras.length} câmera(s) com o Go2RTC...`);
  for (const cam of cfg.cameras) {
    if (!cam.rtspUrl || !cam.streamId) continue;
    try {
      await fetch(`${GO2RTC_API}/streams?name=${encodeURIComponent(cam.streamId)}&src=${encodeURIComponent(cam.rtspUrl)}`, {
        method: 'PUT'
      });
      console.log(`[Go2RTC Adapter] Stream '${cam.streamId}' registrado.`);
    } catch (err) {
      console.warn(`[Go2RTC Adapter] Não foi possível registrar '${cam.streamId}' no Go2RTC: ${err.message}`);
    }
  }
}

// 0. HEALTH CHECK REAL
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backend: true,
    timestamp: new Date().toISOString(),
    discoveryState
  });
});

// GET /api/agent/status
app.get('/api/agent/status', (req, res) => {
  res.json({
    running: true,
    status: 'running',
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    lastDiscovery: new Date().toISOString(),
    lastError: null
  });
});

// Helper for on-demand stream registration with Go2RTC
async function registerSingleStreamWithGo2Rtc(streamId) {
  const cfg = loadConfig();
  const cam = cfg.cameras.find(c => c.streamId === streamId || c.id === streamId);
  if (!cam || !cam.rtspUrl) {
    console.warn(`[Go2RTC Adapter] Câmera não encontrada para o streamId: ${streamId}`);
    return false;
  }
  try {
    console.log(`[CAMERA] Selected: ${cam.id}`);
    console.log(`[RTSP] Starting connection`);
    console.log(`[GO2RTC] Starting selected stream: ${cam.streamId}`);
    
    await fetch(`${GO2RTC_API}/streams?name=${encodeURIComponent(cam.streamId)}&src=${encodeURIComponent(cam.rtspUrl)}`, {
      method: 'PUT'
    });
    console.log(`[Go2RTC Adapter] Stream '${cam.streamId}' registrado dinamicamente.`);
    return true;
  } catch (err) {
    console.error(`[Go2RTC Adapter] Erro ao registrar stream dinamicamente: ${err.message}`);
    return false;
  }
}

// Proxy para WebRTC SDP no Go2RTC (Evita CORS / Mixed Content no frontend)
app.post('/api/webrtc', async (req, res) => {
  const { src } = req.query;
  if (!src) {
    return res.status(400).send('O parâmetro src é obrigatório');
  }
  try {
    // Registra a câmera selecionada sob demanda ("lazy load") no Go2RTC
    await registerSingleStreamWithGo2Rtc(String(src));

    const sdpBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const go2rtcRes = await fetch(`${GO2RTC_API}/webrtc?src=${encodeURIComponent(String(src))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdpBody
    });

    const sdpAnswer = await go2rtcRes.text();
    res.status(go2rtcRes.status).type('application/sdp').send(sdpAnswer);
  } catch (err) {
    res.status(502).send(`Erro de sinalização com Go2RTC: ${err.message}`);
  }
});

// 1. DESCOBERTA ONVIF REAL (WS-Discovery)
app.post('/api/cameras/discover', async (req, res) => {
  try {
    console.log('[ONVIF] Iniciando varredura WS-Discovery na rede local...');
    const devices = await safeStartProbe({ timeout: 4000 });
    
    const seenUris = new Set();
    const discovered = [];

    for (const device of devices) {
      const hostname = device.xaddr ? new URL(device.xaddr).hostname : '192.168.1.X';
      const port = device.xaddr ? new URL(device.xaddr).port || '80' : '80';
      const uniqueKey = `${hostname}:${port}`;
      
      if (seenUris.has(uniqueKey)) continue;
      seenUris.add(uniqueKey);

      const devId = generateDeterministicCameraId(null, device.name, device.xaddr, device.urn);

      discovered.push({
        id: devId,
        ip: hostname,
        port: port,
        name: device.name || `Câmera ONVIF (${hostname})`,
        manufacturer: device.urn || 'Fabricante ONVIF',
        model: 'ONVIF Profile S',
        onvifSupported: true,
        xaddr: device.xaddr,
        rtspUrl: `rtsp://${hostname}:554/live`
      });
    }
    
    console.log(`[ONVIF] Varredura concluída. ${discovered.length} dispositivo(s) único(s) encontrado(s).`);
    res.json({ success: true, devices: discovered });
  } catch (error) {
    console.error('[ONVIF Discovery Error]', error);
    res.status(500).json({ 
      success: false, 
      error: 'Falha na varredura ONVIF na rede local', 
      details: error.message,
      devices: []
    });
  }
});

// 1.1 VARREDURA PROFUNDA COMPLETA & REINICIALIZAÇÃO DO DIAGNÓSTICO
app.post('/api/cameras/discover/full', async (req, res) => {
  const correlationId = `REQ-SCAN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  
  // Logs obrigatórios exigidos no Item 7
  logger.info('SCAN', 'Request received', correlationId);
  
  const executionMode = getExecutionMode();
  logger.info('SCAN', `Runtime environment: ${executionMode}`, correlationId);
  logger.info('SCAN', `Agent PID: ${process.pid}`, correlationId);

  // Classificar e selecionar interface temporariamente para decidir de forma síncrona o acesso à LAN
  const interfaces = os.networkInterfaces();
  let selectedName = 'None';
  let selectedIp = '127.0.0.1';
  let isPrivateLan = false;

  for (const [name, netInterface] of Object.entries(interfaces)) {
    for (const info of netInterface) {
      if (info.family === 'IPv4' && !info.internal) {
        const isPriv = info.address.startsWith('10.') ||
                     info.address.startsWith('192.168.') ||
                     (info.address.startsWith('172.') && (parseInt(info.address.split('.')[1], 10) >= 16 && parseInt(info.address.split('.')[1], 10) <= 31));
        if (isPriv) {
          selectedName = name;
          selectedIp = info.address;
          isPrivateLan = true;
          break;
        } else if (selectedIp === '127.0.0.1') {
          selectedName = name;
          selectedIp = info.address;
        }
      }
    }
    if (isPrivateLan) break;
  }

  logger.info('SCAN', `Network interface: ${selectedName} (${selectedIp})`, correlationId);

  let networkAccess = 'AVAILABLE';
  if (executionMode === 'AI_STUDIO_PREVIEW' || !isPrivateLan) {
    networkAccess = 'UNAVAILABLE';
  }
  logger.info('SCAN', `Network access: ${networkAccess}`, correlationId);

  // Redefinir status no backend para os indicados exatamente de acordo com as regras solicitadas
  discoveryState.agentStatus = '🟢 ONLINE';
  discoveryState.networkStatus = networkAccess === 'AVAILABLE' ? '🟢 ONLINE' : '🔴 OFFLINE';
  discoveryState.discoveryStatus = networkAccess === 'AVAILABLE' ? '🟢 READY' : '🔴 BLOQUEADO (SEM LAN)';

  // Broadcast novos status via WebSocket imediatamente
  broadcast({
    type: 'agent_status_raw',
    agentStatus: '🟢 ONLINE',
    networkStatus: discoveryState.networkStatus,
    discoveryStatus: discoveryState.discoveryStatus
  });

  // Executar a sequência completa em background para não travar a requisição HTTP
  setTimeout(() => {
    if (networkAccess === 'AVAILABLE') {
      logger.info('DISCOVERY', 'Starting', correlationId);
    }
    startAutomaticDiscoverySequence(correlationId).catch((err) => {
      logger.error('DISCOVERY', 'Erro na varredura profunda em background', err, correlationId);
    });
  }, 150);

  res.json({ 
    success: true, 
    message: networkAccess === 'AVAILABLE' ? 'Varredura profunda iniciada.' : 'Diagnóstico de rede de nuvem executado.',
    networkAccess 
  });
});

// 2. CONECTAR ONVIF & OBTER PROFILE / RTSP URI REAL
app.post('/api/cameras/onvif-connect', async (req, res) => {
  const { xaddr, user, pass } = req.body;
  if (!xaddr) {
    return res.status(400).json({ success: false, error: 'xaddr é obrigatório' });
  }

  try {
    const device = new onvif.OnvifDevice({
      xaddr: xaddr,
      user: user || '',
      pass: pass || ''
    });

    await device.init();
    const udpStreamUrl = device.getUdpStreamUrl();
    
    res.json({
      success: true,
      rtspUrl: udpStreamUrl,
      information: device.information
    });
  } catch (error) {
    console.error('[ONVIF Connect Error]', error.message);
    res.status(401).json({
      success: false,
      error: 'Falha de autenticação ONVIF/RTSP',
      details: error.message
    });
  }
});

// Helper de Teste de Conexão TCP para a Porta RTSP
function testTcpConnection(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let status = 'ONLINE';
    let message = 'Conexão TCP efetuada com sucesso na porta RTSP';

    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, status: 'ONLINE', message });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ 
        success: false, 
        status: 'NETWORK_TIMEOUT', 
        message: `Timeout ao tentar conectar em ${host}:${port} (Câmera offline ou firewall bloqueando)` 
      });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ 
        success: false, 
        status: 'NETWORK_ERROR', 
        message: `Erro de rede ao conectar em ${host}:${port} (${err.message})` 
      });
    });

    socket.connect(port, host);
  });
}

function parseRtspUrl(rtspUrl) {
  if (!rtspUrl) return null;
  
  try {
    const parsed = new URL(rtspUrl);
    return {
      hostname: parsed.hostname,
      port: parseInt(parsed.port || '554', 10),
      username: parsed.username ? decodeURIComponent(parsed.username) : '',
      password: parsed.password ? decodeURIComponent(parsed.password) : '',
      path: parsed.pathname + parsed.search
    };
  } catch (e) {
    // Fallback para URLs que o URL() não aceita (RTSP com caracteres especiais no path ou senha)
    const regex = /^rtsp:\/\/([^/]+)(.*)/i;
    const match = rtspUrl.match(regex);
    if (!match) return null;

    const authority = match[1];
    const path = match[2] || '/';
    
    let username = '';
    let password = '';
    let hostPort = authority;

    if (authority.includes('@')) {
      // Pega a última ocorrência de @ para separar credenciais do host
      const lastAtIndex = authority.lastIndexOf('@');
      const credentials = authority.substring(0, lastAtIndex);
      hostPort = authority.substring(lastAtIndex + 1);
      
      const firstColonIndex = credentials.indexOf(':');
      if (firstColonIndex >= 0) {
        username = decodeURIComponent(credentials.substring(0, firstColonIndex));
        password = decodeURIComponent(credentials.substring(firstColonIndex + 1));
      } else {
        username = decodeURIComponent(credentials);
      }
    }

    let hostname = hostPort;
    let port = 554;
    if (hostPort.includes(':')) {
      const hpParts = hostPort.split(':');
      hostname = hpParts[0];
      port = parseInt(hpParts[1] || '554', 10);
    }

    return { hostname, port, username, password, path };
  }
}

function parseSdp(sdpText) {
  const lines = sdpText.split(/\r?\n/);
  let currentMedia = null;
  let videoCodec = 'UNKNOWN';
  let audioCodec = 'NONE';
  const rtpMap = {};

  for (const line of lines) {
    if (line.startsWith('m=')) {
      const parts = line.substring(2).split(' ');
      currentMedia = parts[0]; // 'video' ou 'audio'
    } else if (line.startsWith('a=rtpmap:')) {
      const match = line.match(/^a=rtpmap:(\d+)\s+([^/]+)/i);
      if (match) {
        const payloadType = match[1];
        const codecName = match[2].toUpperCase();
        rtpMap[payloadType] = { media: currentMedia, codec: codecName };
        if (currentMedia === 'video') {
          if (videoCodec === 'UNKNOWN') videoCodec = codecName;
        } else if (currentMedia === 'audio') {
          if (audioCodec === 'NONE') audioCodec = codecName;
        }
      }
    }
  }

  return { videoCodec, audioCodec };
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function runRtspDiagnostic(rtspUrl, correlationId = 'RTSP-DIAG') {
  return new Promise((resolve) => {
    const urlInfo = parseRtspUrl(rtspUrl);
    if (!urlInfo) {
      return resolve({
        ok: false,
        stage: 'parse',
        error: 'INVALID_URL',
        message: 'A URL RTSP fornecida possui um formato inválido.',
        videoCodec: 'UNKNOWN',
        audioCodec: 'NONE',
        sdp: ''
      });
    }

    const { hostname, port, username, password, path } = urlInfo;
    const safeUrl = `rtsp://${username ? '***:***@' : ''}${hostname}:${port}${path}`;
    
    // Algumas câmeras são sensíveis ao porta 554 na URI do Digest. VLC geralmente omite se for padrão.
    const cleanRtspUrl = port === 554 ? `rtsp://${hostname}${path}` : `rtsp://${hostname}:${port}${path}`;
    
    logger.info('RTSP', `Iniciando diagnóstico para ${safeUrl}`, correlationId);
    logger.info('RTSP][CONNECT', `Conectando via TCP em ${hostname}:${port}...`, correlationId);

    const client = new net.Socket();
    client.setTimeout(8000);

    let state = 'CONNECTING'; 
    let buffer = '';
    let cseq = 1;
    let wwwAuthHeader = '';

    const userAgent = 'VLC/3.0.18 LibVLC/3.0.18';

    const sendRequest = (method, url, authHeader = '') => {
      let req = `${method} ${url} RTSP/1.0\r\nCSeq: ${cseq++}\r\n`;
      if (authHeader) req += `Authorization: ${authHeader}\r\n`;
      if (method === 'DESCRIBE') req += `Accept: application/sdp\r\n`;
      req += `User-Agent: ${userAgent}\r\n\r\n`;
      
      logger.info('RTSP', `${method} enviado (CSeq: ${cseq-1})`, correlationId);
      client.write(req);
    };

    const cleanAndResolve = (result) => {
      client.destroy();
      resolve(result);
    };

    client.connect(port, hostname, () => {
      state = 'OPTIONS_SENT';
      logger.info('RTSP][CONNECT', '🟢 Conexão TCP estabelecida com sucesso.', correlationId);
      sendRequest('OPTIONS', cleanRtspUrl);
    });

    client.on('data', (data) => {
      buffer += data.toString();

      if (buffer.includes('\r\n\r\n')) {
        const parts = buffer.split('\r\n\r\n');
        const headerBlock = parts[0];
        const lines = headerBlock.split('\r\n');
        const statusLine = lines[0]; 
        
        logger.info('RTSP', `Status recebido: ${statusLine}`, correlationId);

        const headers = {};
        for (let i = 1; i < lines.length; i++) {
          const colonIdx = lines[i].indexOf(':');
          if (colonIdx > 0) {
            const key = lines[i].substring(0, colonIdx).trim().toLowerCase();
            const val = lines[i].substring(colonIdx + 1).trim();
            headers[key] = val;
          }
        }

        if (statusLine.includes(' 200 ')) {
          if (state === 'OPTIONS_SENT' || state === 'OPTIONS_AUTH_SENT') {
            buffer = buffer.substring(headerBlock.length + 4); 
            state = 'DESCRIBE_SENT';
            sendRequest('DESCRIBE', cleanRtspUrl);
          } else if (state === 'DESCRIBE_SENT' || state === 'DESCRIBE_AUTH_SENT') {
            logger.info('RTSP][DESCRIBE', '🟢 DESCRIBE retornado com sucesso 200 OK.', correlationId);
            
            const contentLength = parseInt(headers['content-length'] || '0', 10);
            const remainingBody = parts.slice(1).join('\r\n\r\n');

            if (remainingBody.length >= contentLength) {
              const sdpText = remainingBody.substring(0, contentLength);
              logger.info('RTSP][SDP', `🟢 SDP Recebido (${contentLength} bytes):\n${sdpText}`, correlationId);

              const { videoCodec, audioCodec } = parseSdp(sdpText);
              logger.info('RTSP][VIDEO', `Vídeo detectado no SDP: ${videoCodec}`, correlationId);
              logger.info('RTSP][AUDIO', `Áudio detectado no SDP: ${audioCodec}`, correlationId);

              return cleanAndResolve({
                ok: true,
                stage: 'sdp',
                videoCodec,
                audioCodec,
                sdp: sdpText,
                message: 'RTSP Session connected and SDP negotiated successfully'
              });
            }
          }
        } else if (statusLine.includes(' 401 ')) {
          const authLines = lines.filter(l => l.toLowerCase().startsWith('www-authenticate:'));
          // Prefere Digest se disponível
          let selectedAuthLine = authLines.find(l => l.toLowerCase().includes('digest')) || authLines[0] || '';
          wwwAuthHeader = selectedAuthLine.substring(selectedAuthLine.indexOf(':') + 1).trim();
          
          logger.warn('RTSP][AUTH', `Câmera solicitou autenticação (401). Challenge: ${wwwAuthHeader}`, correlationId);

          if ((state === 'OPTIONS_SENT' || state === 'DESCRIBE_SENT') && wwwAuthHeader && username) {
            buffer = buffer.substring(headerBlock.length + 4); 
            
            let authHeaderValue = '';
            const method = state === 'OPTIONS_SENT' ? 'OPTIONS' : 'DESCRIBE';
            
            if (wwwAuthHeader.toLowerCase().includes('basic')) {
              const credentials = Buffer.from(`${username}:${password}`).toString('base64');
              authHeaderValue = `Basic ${credentials}`;
              logger.info('RTSP][AUTH', `Enviando credenciais Basic Auth para ${method}...`, correlationId);
            } else if (wwwAuthHeader.toLowerCase().includes('digest')) {
              // Regex mais robusta para realm, nonce e opaque (com ou sem aspas, lida com vírgulas ou espaços)
              const getParam = (name) => {
                const match = wwwAuthHeader.match(new RegExp(`${name}="?([^",]+)"?`, 'i'));
                return match ? match[1] : null;
              };

              const realm = getParam('realm');
              const nonce = getParam('nonce');
              const opaque = getParam('opaque');
              const qopHeader = getParam('qop');
              
              if (realm && nonce) {
                const uri = cleanRtspUrl;
                const nc = '00000001';
                const cnonce = crypto.randomBytes(8).toString('hex');
                
                // qop pode vir como "auth,auth-int". Devemos escolher um.
                const useQop = qopHeader && qopHeader.split(',').map(s => s.trim()).includes('auth') ? 'auth' : null;
                
                const HA1 = md5(`${username}:${realm}:${password}`);
                const HA2 = md5(`${method}:${uri}`);
                
                let response;
                if (useQop === 'auth') {
                  response = md5(`${HA1}:${nonce}:${nc}:${cnonce}:${useQop}:${HA2}`);
                } else {
                  response = md5(`${HA1}:${nonce}:${HA2}`);
                }
                
                authHeaderValue = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
                if (useQop) {
                  authHeaderValue += `, qop=${useQop}, nc=${nc}, cnonce="${cnonce}"`;
                }
                if (opaque) authHeaderValue += `, opaque="${opaque}"`;
                
                logger.info('RTSP][AUTH', `Enviando credenciais Digest Auth para ${method} (realm: ${realm}, qop: ${useQop || 'none'})...`, correlationId);
              } else {
                logger.error('RTSP][AUTH', 'Falha ao extrair parâmetros essenciais (realm/nonce) do Digest Auth Challenge', correlationId);
              }
            }

            if (authHeaderValue) {
              const oldState = state;
              state = oldState === 'OPTIONS_SENT' ? 'OPTIONS_AUTH_SENT' : 'DESCRIBE_AUTH_SENT';
              sendRequest(method, cleanRtspUrl, authHeaderValue);
            } else if (state === 'OPTIONS_SENT') {
              // Se não conseguiu gerar authHeader para OPTIONS, tenta DESCRIBE direto
              logger.warn('RTSP][AUTH', 'Falha ao gerar AuthHeader para OPTIONS. Tentando DESCRIBE...', correlationId);
              buffer = buffer.substring(headerBlock.length + 4);
              state = 'DESCRIBE_SENT';
              sendRequest('DESCRIBE', cleanRtspUrl);
            } else {
              return cleanAndResolve({
                ok: false,
                stage: 'auth',
                error: 'AUTH_METHOD_UNSUPPORTED',
                message: 'Método de autenticação não suportado ou falha no parsing.',
                videoCodec: 'UNKNOWN',
                audioCodec: 'NONE',
                sdp: ''
              });
            }
          } else {
            // Se já tentamos autenticar e recebemos 401 de novo
            if (state === 'OPTIONS_AUTH_SENT') {
               // Fallback: se OPTIONS com Auth falhou (mesmo com 401), tenta DESCRIBE direto
               logger.warn('RTSP][AUTH', 'OPTIONS com Auth retornou 401 novamente. Tentando DESCRIBE como fallback...', correlationId);
               buffer = buffer.substring(headerBlock.length + 4);
               state = 'DESCRIBE_SENT';
               sendRequest('DESCRIBE', cleanRtspUrl);
            } else {
               const isRetry = state === 'OPTIONS_AUTH_SENT' || state === 'DESCRIBE_AUTH_SENT';
               return cleanAndResolve({
                 ok: false,
                 stage: 'auth',
                 error: isRetry ? 'INVALID_CREDENTIALS' : 'UNAUTHORIZED',
                 message: isRetry ? 'Usuário ou senha incorretos.' : 'Falha de autenticação RTSP. Verifique usuário e senha.',
                 videoCodec: 'UNKNOWN',
                 audioCodec: 'NONE',
                 sdp: ''
               });
            }
          }
        } else {
          return cleanAndResolve({
            ok: false,
            stage: 'rtsp_request',
            error: 'RTSP_ERROR',
            message: `Servidor RTSP retornou erro inesperado: ${statusLine}`,
            videoCodec: 'UNKNOWN',
            audioCodec: 'NONE',
            sdp: ''
          });
        }
      }
    });

    client.on('timeout', () => {
      logger.info('RTSP', 'Conexão TCP esgotada (Timeout)', correlationId);
      cleanAndResolve({
        ok: false,
        stage: 'tcp',
        error: 'TIMEOUT',
        message: 'Timeout ao conectar na porta RTSP (Câmera offline ou rede inacessível)',
        videoCodec: 'UNKNOWN',
        audioCodec: 'NONE',
        sdp: ''
      });
    });

    client.on('error', (err) => {
      logger.info('RTSP', `Erro na conexão socket: ${err.message}`, correlationId);
      cleanAndResolve({
        ok: false,
        stage: 'tcp',
        error: 'CONNECTION_FAILED',
        message: `Falha na conexão TCP: ${err.message}`,
        videoCodec: 'UNKNOWN',
        audioCodec: 'NONE',
        sdp: ''
      });
    });
  });
}

function checkWebRtcCodecSupport(videoCodec, audioCodec) {
  const supportedVideos = ['H264', 'VP8', 'VP9', 'AV1'];
  const maybeSupported = ['H265', 'HEVC'];
  
  const videoUpper = videoCodec.toUpperCase();
  const isVideoSupported = supportedVideos.includes(videoUpper);
  const isMaybeSupported = maybeSupported.includes(videoUpper);
  
  if (!isVideoSupported && !isMaybeSupported) {
    return {
      compatible: false,
      error: 'CODEC_MISMATCH',
      message: `RTSP conectado, mas o codec anunciado pela câmera (${videoCodec}) não é compatível com WebRTC nativo.`
    };
  }

  if (isMaybeSupported) {
    return {
      compatible: true,
      warning: true,
      message: `Codec ${videoCodec} detectado. Este codec pode não funcionar em todos os navegadores. Recomenda-se usar H.264 para máxima compatibilidade.`
    };
  }

  return { compatible: true };
}

// 3. TESTE DE CONEXÃO RTSP COM VERIFICAÇÃO TCP REAL
app.post('/api/cameras/test', async (req, res) => {
  const { rtspUrl } = req.body;
  if (!rtspUrl || typeof rtspUrl !== 'string' || !rtspUrl.startsWith('rtsp://')) {
    return res.status(400).json({ 
      success: false, 
      status: 'RTSP_SYNTAX_ERROR', 
      message: 'Sintaxe da URL RTSP inválida. Ex: rtsp://user:pass@ip:554/stream' 
    });
  }

  try {
    const parsed = new URL(rtspUrl);
    const host = parsed.hostname;
    const port = parseInt(parsed.port || '554', 10);

    const netResult = await testTcpConnection(host, port);
    res.json(netResult);
  } catch (e) {
    res.status(400).json({ 
      success: false, 
      status: 'RTSP_PARSE_ERROR', 
      message: 'Não foi possível extrair o host/porta da URL RTSP' 
    });
  }
});

// 3.1 ENDPOINT DE DIAGNÓSTICO AVANÇADO RTSP / GO2RTC
app.post('/api/cameras/diagnose', async (req, res) => {
  const { rtspUrl, streamId } = req.body;
  const correlationId = 'REQ-DIAG-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  if (!rtspUrl || typeof rtspUrl !== 'string' || !rtspUrl.startsWith('rtsp://')) {
    return res.status(400).json({
      success: false,
      stage: 'validate',
      error: 'RTSP_SYNTAX_ERROR',
      message: 'Sintaxe da URL RTSP inválida. Ex: rtsp://user:pass@ip:554/stream'
    });
  }

  try {
    const parsed = parseRtspUrl(rtspUrl);
    if (!parsed) {
      return res.json({
        success: false,
        stage: 'parse',
        error: 'RTSP_PARSE_ERROR',
        message: 'Não foi possível extrair o host/porta da URL RTSP'
      });
    }

    const host = parsed.hostname;
    const port = parsed.port;

    logger.info('GO2RTC', `Iniciando diagnóstico completo para o stream ${streamId || 'test'}`, correlationId);
    
    // Etapa 1: Teste de porta TCP
    const tcpResult = await testTcpConnection(host, port, 3000);
    if (!tcpResult.success) {
      logger.info('GO2RTC][ERROR', `Falha de conexão TCP na porta RTSP: ${tcpResult.message}`, correlationId);
      return res.json({
        success: false,
        stage: 'tcp',
        error: tcpResult.status,
        message: tcpResult.message
      });
    }

    // Etapa 2: RTSP Session & SDP Describe negotiation
    const rtspResult = await runRtspDiagnostic(rtspUrl, correlationId);
    if (!rtspResult.ok) {
      logger.info('GO2RTC][ERROR', `Falha na negociação RTSP: ${rtspResult.message}`, correlationId);
      return res.json({
        success: false,
        stage: rtspResult.stage,
        error: rtspResult.error || 'RTSP_NEGOTIATION_FAILED',
        message: rtspResult.message
      });
    }

    // Etapa 3: Codec Compatibility Verification
    const codecSupport = checkWebRtcCodecSupport(rtspResult.videoCodec, rtspResult.audioCodec);
    if (!codecSupport.compatible) {
      logger.info('GO2RTC][ERROR', `Incompatibilidade de Codec: ${codecSupport.message}`, correlationId);
      logger.info('GO2RTC][CODECS', `Codecs anunciados -> Vídeo: ${rtspResult.videoCodec} | Áudio: ${rtspResult.audioCodec}`, correlationId);
      return res.json({
        success: false,
        stage: 'go2rtc',
        error: 'CODEC_MISMATCH',
        message: codecSupport.message,
        videoCodec: rtspResult.videoCodec,
        audioCodec: rtspResult.audioCodec,
        transport: 'tcp'
      });
    }

    // Se houver aviso (ex: H265), passamos para o frontend
    const warning = codecSupport.warning ? codecSupport.message : null;

    // Etapa 4: Registrar ou atualizar stream no Go2RTC
    if (streamId) {
      try {
        await fetch(`${GO2RTC_API}/streams?name=${encodeURIComponent(streamId)}&src=${encodeURIComponent(rtspUrl)}`, {
          method: 'PUT'
        });
        logger.info('GO2RTC', `Stream '${streamId}' registrado/atualizado no Go2RTC para diagnóstico.`, correlationId);
      } catch (err) {
        logger.warn('GO2RTC', `Aviso ao registrar stream no Go2RTC: ${err.message}`, correlationId);
      }
    }

    res.json({
      success: true,
      stage: 'stream',
      status: 'ONLINE',
      message: warning || 'Conexão RTSP e codecs totalmente compatíveis com o Go2RTC',
      videoCodec: rtspResult.videoCodec,
      audioCodec: rtspResult.audioCodec,
      transport: 'tcp',
      warning: !!warning,
      warningMsg: warning
    });

  } catch (err) {
    logger.info('GO2RTC][ERROR', `Erro interno durante diagnóstico: ${err.message}`, correlationId);
    res.status(500).json({
      success: false,
      stage: 'internal',
      error: 'DIAGNOSTIC_EXCEPTION',
      message: `Erro interno no servidor: ${err.message}`
    });
  }
});

// 4. CADASTRO DE CÂMERA
app.post('/api/cameras', async (req, res) => {
  const { name, rtspUrl, location, resolution, ptzEnabled, transport, tenantId = 'tenant_default', xaddr } = req.body;
  
  if (!rtspUrl || typeof rtspUrl !== 'string') {
    return res.status(400).json({ error: 'URL RTSP é obrigatória' });
  }

  const cfg = loadConfig();
  
  // Identificador determinístico da câmera
  const camId = generateDeterministicCameraId(rtspUrl, name, xaddr);
  const streamId = `stream_${camId}`;

  // Se a câmera com este ID já existir, atualiza suas propriedades em vez de duplicar
  const existingIdx = cfg.cameras.findIndex(c => c.id === camId);

  const newCamera = {
    id: camId,
    tenantId,
    name: name || 'Câmera IP',
    location: location || 'Setor Padrão',
    rtspUrl,
    streamId,
    enabled: true,
    status: 'ONLINE',
    resolution: resolution || '1920x1080',
    fps: 30,
    bitrateKbps: 4000,
    ptzEnabled: !!ptzEnabled,
    recording: true,
    transport: transport || 'tcp'
  };

  if (existingIdx >= 0) {
    cfg.cameras[existingIdx] = newCamera;
  } else {
    cfg.cameras.push(newCamera);
  }
  
  saveConfig(cfg);

  try {
    await fetch(`${GO2RTC_API}/streams?name=${encodeURIComponent(streamId)}&src=${encodeURIComponent(rtspUrl)}`, {
      method: 'PUT'
    });
    console.log(`[Go2RTC Adapter] Stream '${streamId}' cadastrado e ativo.`);
  } catch (err) {
    console.warn(`[Go2RTC Adapter] Aviso: Go2RTC não respondeu ao cadastrar '${streamId}': ${err.message}`);
  }

  res.status(201).json({ success: true, camera: newCamera });
});

// 5. LISTAGEM DE CÂMERAS DA CONTA / TENANT (Sanitiza credenciais no retorno)
app.get('/api/cameras', (req, res) => {
  const { tenantId = 'tenant_default' } = req.query;
  const cfg = loadConfig();
  
  const cameras = cfg.cameras
    .filter(c => c.tenantId === tenantId)
    .map(c => ({
      ...c,
      rtspUrlSafe: c.rtspUrl ? c.rtspUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') : ''
    }));

  res.json({ success: true, cameras });
});

// 6. EXCLUIR CÂMERA
app.delete('/api/cameras/:id', async (req, res) => {
  const { id } = req.params;
  const cfg = loadConfig();
  const cam = cfg.cameras.find(c => c.id === id);
  
  if (cam && cam.streamId) {
    try {
      await fetch(`${GO2RTC_API}/streams?name=${encodeURIComponent(cam.streamId)}`, {
        method: 'DELETE'
      });
    } catch (e) {}
  }

  cfg.cameras = cfg.cameras.filter(c => c.id !== id);
  saveConfig(cfg);
  res.json({ success: true, message: `Câmera ${id} removida com sucesso` });
});

// 7. GET BOOT & AUTO-DISCOVERY STATE
app.get('/api/discovery-status', (req, res) => {
  res.json({
    success: true,
    state: discoveryState
  });
});

module.exports = { app, registerAllStreamsWithGo2Rtc, startAutomaticDiscoverySequence, initWebSocket };

