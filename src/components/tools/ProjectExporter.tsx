import { useState } from 'react';
import JSZip from 'jszip';
import { Download, Copy, Check, Terminal, FileCode, X, Cloud, Monitor } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';

interface ProjectExporterProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProjectExporter({ isOpen, onClose }: ProjectExporterProps) {
  const [activeFile, setActiveFile] = useState<string>('backend/Dockerfile');
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  if (!isOpen) return null;

  const fileContents: Record<string, string> = {
    'backend/Dockerfile': `# ==============================================================================
# 🚀 DOCKERFILE - NEXUS RTSP MONITOR BACKEND (Google Cloud Run)
# ==============================================================================
FROM node:20-alpine

RUN apk add --no-cache \\
    ffmpeg \\
    bash \\
    ca-certificates \\
    tzdata

WORKDIR /app
COPY package*.json ./
RUN npm install --only=production --ignore-scripts
COPY server.js config.json ./

ENV NODE_ENV=production
ENV PORT=8080
ENV STREAMS_DIR=/tmp/streams

RUN mkdir -p /tmp/streams && chown -R node:node /tmp/streams /app
USER node
EXPOSE 8080
CMD ["node", "server.js"]`,

    'backend/server.js': `/**
 * ============================================================================
 * 🧠 NEXUS RTSP MONITOR - BACKEND PARA GOOGLE CLOUD RUN (Node.js + FFmpeg)
 * ============================================================================
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8080;
const CONFIG_PATH = path.join(__dirname, 'config.json');
const STREAMS_DIR = process.env.STREAMS_DIR || '/tmp/streams';

if (!fs.existsSync(STREAMS_DIR)) {
  fs.mkdirSync(STREAMS_DIR, { recursive: true });
}

app.use(cors({ origin: '*' }));
app.use(express.json());

const setHlsHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Access-Control-Allow-Origin', '*');
};

const activeStreams = new Map();

function loadConfig() {
  try {
    if (process.env.CAMERAS_CONFIG) return JSON.parse(process.env.CAMERAS_CONFIG);
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    return { server: { port: 8080 }, cameras: [] };
  }
}

function startHlsPipeline(camera) {
  if (activeStreams.has(camera.id)) {
    const s = activeStreams.get(camera.id);
    s.lastRequestedAt = Date.now();
    return s;
  }

  const camDir = path.join(STREAMS_DIR, camera.id);
  if (!fs.existsSync(camDir)) fs.mkdirSync(camDir, { recursive: true });

  const playlistFile = path.join(camDir, 'index.m3u8');
  const segmentPattern = path.join(camDir, 'segment_%03d.ts');

  const args = [
    '-rtsp_transport', camera.protocol || 'tcp',
    '-fflags', 'nobuffer+flush_packets',
    '-flags', 'low_delay',
    '-i', camera.rtspUrl,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '64k',
    '-f', 'hls',
    '-hls_time', '1',
    '-hls_list_size', '3',
    '-hls_flags', 'delete_segments+split_by_time',
    '-hls_segment_filename', segmentPattern,
    playlistFile
  ];

  const ffmpeg = spawn('ffmpeg', args);
  const streamInfo = { id: camera.id, process: ffmpeg, playlistFile, camDir };
  activeStreams.set(camera.id, streamInfo);
  return streamInfo;
}

app.get('/health', (req, res) => {
  res.json({ status: 'online', activeStreams: activeStreams.size });
});

app.get('/stream/:id/index.m3u8', (req, res) => {
  const config = loadConfig();
  const camera = (config.cameras || []).find(c => c.id === req.params.id);
  if (!camera) return res.status(404).send('Camera não encontrada');

  startHlsPipeline(camera);
  const filePath = path.join(STREAMS_DIR, camera.id, 'index.m3u8');

  let tries = 0;
  const check = () => {
    if (fs.existsSync(filePath)) {
      setHlsHeaders(res);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return fs.createReadStream(filePath).pipe(res);
    }
    if (++tries > 20) return res.status(503).send('Stream iniciando...');
    setTimeout(check, 250);
  };
  check();
});

app.get('/stream/:id/:segment', (req, res) => {
  const filePath = path.join(STREAMS_DIR, req.params.id, req.params.segment);
  if (!fs.existsSync(filePath)) return res.status(404).send('Segmento não encontrado');
  setHlsHeaders(res);
  res.setHeader('Content-Type', 'video/MP2T');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(\`Nexus Cloud Run Backend rodando na porta \${PORT}\`);
});`,

    'backend/config.json': JSON.stringify({
      server: { port: 8080 },
      cameras: [
        {
          id: "cam-1",
          name: "Portaria Principal - Entrada",
          rtspUrl: "rtsp://admin:admin123@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0",
          protocol: "tcp"
        }
      ]
    }, null, 2),

    'backend/package.json': JSON.stringify({
      name: "nexus-rtsp-cloudrun-backend",
      version: "2.4.0",
      main: "server.js",
      scripts: { start: "node server.js" },
      dependencies: { express: "^4.19.2", cors: "^2.8.5", ws: "^8.18.0" }
    }, null, 2),

    'electron/main.js': `const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#030712',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(createWindow);`,

    'electron/package.json': JSON.stringify({
      name: "nexus-cftv-desktop",
      version: "2.4.0",
      main: "electron/main.js",
      dependencies: { electron: "^30.0.0" }
    }, null, 2)
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fileContents[activeFile] || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      const zip = new JSZip();
      Object.entries(fileContents).forEach(([filepath, content]) => {
        zip.file(filepath, content);
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nexus-rtsp-cloudrun-electron.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Erro ao gerar ZIP:', err);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div
      id="modal-project-exporter"
      className="cftv-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exporter-title"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col">
        <GlassCard id="modal-project-exporter-card" className="p-5 sm:p-6 flex flex-col gap-4 overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 flex items-center justify-center bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 flex-shrink-0">
                <Cloud className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 id="exporter-title" className="text-sm sm:text-base font-rajdhani font-bold text-cyan-400 uppercase tracking-wider truncate">
                  Backend Google Cloud Run + Electron
                </h2>
                <p className="text-xs text-zinc-400 truncate font-sans">
                  Arquivos do backend com Dockerfile, endpoints /stream/:camId e cliente Electron
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                id="btn-download-zip"
                onClick={handleDownloadZip}
                disabled={isZipping}
                className="cftv-btn-action"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isZipping ? 'GERANDO ZIP...' : 'BAIXAR PACOTE (.ZIP)'}</span>
              </button>

              <button
                id="btn-close-exporter"
                onClick={onClose}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Fechar exportador"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 min-h-0 flex-1 overflow-hidden">
            <aside className="md:col-span-4 flex flex-col gap-4 overflow-y-auto pr-1">
              <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 font-rajdhani font-bold text-xs text-cyan-400 uppercase tracking-wider">
                  <Cloud className="w-3.5 h-3.5" />
                  <span>Backend (Cloud Run)</span>
                </h3>
                <nav className="flex flex-col gap-1">
                  {Object.keys(fileContents)
                    .filter(f => f.startsWith('backend/'))
                    .map((file) => (
                      <button
                        key={file}
                        onClick={() => setActiveFile(file)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs font-mono transition-colors text-left truncate ${
                          activeFile === file 
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold' 
                            : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/5'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                        <span className="truncate">{file}</span>
                      </button>
                  ))}
                </nav>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="flex items-center gap-1.5 font-rajdhani font-bold text-xs text-purple-400 uppercase tracking-wider">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Desktop (Electron)</span>
                </h3>
                <nav className="flex flex-col gap-1">
                  {Object.keys(fileContents)
                    .filter(f => !f.startsWith('backend/'))
                    .map((file) => (
                      <button
                        key={file}
                        onClick={() => setActiveFile(file)}
                        className={`flex items-center gap-2 px-3 py-2 text-xs font-mono transition-colors text-left truncate ${
                          activeFile === file 
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold' 
                            : 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/5'
                        }`}
                      >
                        <FileCode className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                        <span className="truncate">{file}</span>
                      </button>
                  ))}
                </nav>
              </section>

              <div className="p-3 bg-black/60 border border-white/10 text-xs flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-rajdhani font-bold">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Deploy Cloud Run:</span>
                </div>
                <p className="text-zinc-400 text-[11px] font-sans">Comando via Google Cloud CLI:</p>
                <code className="p-2 bg-black/90 text-cyan-300 font-mono text-[10px] break-all border border-cyan-500/20">
                  gcloud run deploy rtsp-backend --source backend --allow-unauthenticated --memory 512Mi --min-instances 0
                </code>
              </div>
            </aside>

            <main className="md:col-span-8 flex flex-col bg-black/70 border border-white/10 min-h-[300px] overflow-hidden">
              <header className="flex items-center justify-between px-3 py-2 bg-black/80 border-b border-white/10">
                <span className="font-mono text-xs font-semibold text-cyan-400">{activeFile}</span>
                <button
                  onClick={handleCopy}
                  className="cftv-btn-outline"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'COPIADO' : 'COPIAR'}</span>
                </button>
              </header>

              <pre className="p-4 overflow-auto flex-1 font-mono text-xs text-zinc-200 leading-relaxed max-h-[480px]">
                <code>{fileContents[activeFile]}</code>
              </pre>
            </main>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
