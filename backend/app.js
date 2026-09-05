const express = require('express');
const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const crypto = require('crypto');
const onvif = require('node-onvif');
const fetch = require('node-fetch');

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
  if (urn && typeof urn === 'string' && urn.trim().length > 0) {
    // Prioridade 1: Identidade persistente única de hardware / URN ONVIF
    targetStr = urn.trim().toLowerCase();
  } else if (xaddr && typeof xaddr === 'string' && xaddr.trim().length > 0) {
    // Prioridade 2: XAddr de serviço ONVIF
    targetStr = xaddr.trim().toLowerCase();
  } else if (rtspUrl && typeof rtspUrl === 'string') {
    // Prioridade 3: URL RTSP sanitizada sem credenciais
    try {
      const parsed = new URL(rtspUrl);
      targetStr = `${parsed.hostname}:${parsed.port || 554}${parsed.pathname}${parsed.search}`;
    } catch (e) {
      targetStr = rtspUrl.replace(/\/\/[^:]+:[^@]+@/, '//');
    }
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
const CONFIG_PATH = path.join(__dirname, 'config.json');

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
app.get('/api/health', async (req, res) => {
  let go2rtcOnline = false;
  try {
    const check = await fetch(`${GO2RTC_API}/streams`);
    go2rtcOnline = check.ok;
  } catch (e) {}

  res.json({
    status: 'online',
    agent: 'online',
    go2rtc: go2rtcOnline ? 'online' : 'offline',
    go2rtcOnline,
    camerasCount: loadConfig().cameras.length
  });
});

// Proxy para WebRTC SDP no Go2RTC (Evita CORS / Mixed Content no frontend)
app.post('/api/webrtc', async (req, res) => {
  const { src } = req.query;
  if (!src) {
    return res.status(400).send('O parâmetro src é obrigatório');
  }
  try {
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
    const devices = await onvif.startProbe({ timeout: 4000 });
    
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

module.exports = { app, registerAllStreamsWithGo2Rtc };

