import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { CameraStream } from './types';
import { fetchCameras, checkHealth, getDiscoveryStatus, getAgentBaseUrl } from './api/cameras';
import { ParticleCanvas } from './components/ParticleCanvas/ParticleCanvas';
import { CameraGrid } from './components/CameraGrid';
import { AddCameraModal } from './components/AddCameraModal';
import { PtzModal } from './components/PtzModal';
import { CameraSelector } from './components/CameraSelector';
import { logger } from './utils/logger';

interface LogEntry {
  timestamp: string;
  prefix: string;
  message: string;
}

export default function App() {
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentOffline, setAgentOffline] = useState(false);
  const [agentError, setAgentError] = useState<string>('');
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [cameraZooms] = useState<Record<string, number>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPtzCam, setSelectedPtzCam] = useState<CameraStream | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // Auto-Discovery and network state
  const [bootState, setBootState] = useState({
    agentStatus: '🟡 INICIANDO...',
    networkStatus: '🟡 DETECTANDO...',
    discoveryStatus: '🟡 AGUARDANDO REDE...',
    devicesCount: 0,
    logs: [] as LogEntry[]
  });

  const initAgentAndCameras = async () => {
    try {
      setLoading(true);
      const health = await checkHealth();
      if (!health.online) {
        setAgentOffline(true);
        setAgentError(health.error || 'Windows Local Agent não conectado.');
        setCameras([]);
        return;
      }

      setAgentOffline(false);
      setAgentError('');

      const res = await fetchCameras();
      if (res && res.cameras) {
        setCameras(res.cameras);
      }
    } catch (err: any) {
      logger.error('FRONTEND', 'Erro de conexão com o agente local', err);
      setAgentOffline(true);
      setAgentError('Windows Local Agent não conectado.');
    } finally {
      setLoading(false);
    }
  };

  // Central WebSocket connection for real-time diagnostic event streaming
  useEffect(() => {
    const correlationId = 'WS-CONN';
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    let socket: WebSocket;
    let reconnectTimeout: any;

    function connect() {
      const agentBase = getAgentBaseUrl();
      let wsUrl = '';
      if (window.electronAPI || agentBase.includes('127.0.0.1') || agentBase.includes('localhost')) {
        wsUrl = 'ws://127.0.0.1:8080/ws';
      } else {
        wsUrl = `${wsProto}//${window.location.host}/ws`;
      }

      logger.info('WS', `CONNECTING ${wsUrl}`, correlationId);
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        logger.info('WS', 'CONNECTED', correlationId);
        const pingMsg = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() });
        socket.send(pingMsg);
        logger.info('WS][TX', pingMsg, correlationId);
      };

      socket.onmessage = (event) => {
        const dataText = event.data;
        logger.info('WS][RX', dataText, correlationId);
        try {
          const parsed = JSON.parse(dataText);
          
          if (parsed.type === 'log') {
            // Forward backend log events straight to browser F12 Console beautifully!
            if (parsed.prefix === 'ERROR') {
              logger.error('BACKEND', parsed.message, null, parsed.correlationId);
            } else {
              logger.info(parsed.prefix, parsed.message, parsed.correlationId);
            }

            setBootState((prev) => {
              // Deduplicate logs
              if (prev.logs.some(l => l.message === parsed.message && l.timestamp === parsed.timestamp)) {
                return prev;
              }
              return {
                ...prev,
                logs: [...prev.logs, {
                  timestamp: parsed.timestamp || new Date().toLocaleTimeString(),
                  prefix: parsed.prefix,
                  message: parsed.message
                }]
              };
            });
          } else if (parsed.type === 'agent_status') {
            setBootState((prev) => ({
              ...prev,
              agentStatus: parsed.status === 'running' ? '🟢 ONLINE' : '🔴 OFFLINE'
            }));
          } else if (parsed.type === 'agent_status_raw') {
            setBootState((prev) => ({
              ...prev,
              agentStatus: parsed.agentStatus,
              networkStatus: parsed.networkStatus,
              discoveryStatus: parsed.discoveryStatus
            }));
          } else if (parsed.type === 'network_interface') {
            setBootState((prev) => ({
              ...prev,
              networkStatus: `🟢 ${parsed.ip} DETECTADA`
            }));
          } else if (parsed.type === 'discovery_started') {
            setBootState((prev) => ({
              ...prev,
              discoveryStatus: '🔍 PROCURANDO CÂMERAS...'
            }));
          } else if (parsed.type === 'camera_found') {
            // Re-fetch cameras list so discovered device is shown instantly
            fetchCameras().then((res) => {
              if (res && res.cameras) {
                setCameras(res.cameras);
              }
            }).catch(() => {});
          }
        } catch (e) {
          logger.error('WS', 'Erro ao processar mensagem do WebSocket', e, correlationId);
        }
      };

      socket.onclose = () => {
        logger.info('WS', 'CLOSED', correlationId);
        reconnectTimeout = setTimeout(() => {
          if (socket.readyState === WebSocket.CLOSED) {
            connect();
          }
        }, 5000);
      };

      socket.onerror = () => {
        // Conexão em transição ou ambiente restrito. A reconexão automática já lida no onclose.
        logger.info('WS', 'Conexão em transição ou aguardando agente local.', correlationId);
      };
    }

    connect();

    return () => {
      if (socket) socket.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Poll fallback for network robustness
  useEffect(() => {
    let active = true;

    const pollDiscovery = async () => {
      try {
        const res = await getDiscoveryStatus();
        if (res && res.success && res.state && active) {
          const prevCount = bootState.devicesCount;
          
          setBootState((prev) => ({
            ...res.state,
            // Guard logs state to prioritize realtime WS updates
            logs: res.state.logs.length > prev.logs.length ? res.state.logs : prev.logs
          }));

          if (res.state.devicesCount !== prevCount) {
            const listRes = await fetchCameras();
            if (listRes && listRes.cameras && active) {
              setCameras(listRes.cameras);
            }
          }
        }
      } catch (err) {
        // Quiet fallback log
      }
    };

    pollDiscovery();
    const interval = setInterval(pollDiscovery, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [bootState.devicesCount]);

  useEffect(() => {
    logger.info('BOOT', 'Nexus RTSP Monitor starting', 'REQ-BOOT');
    logger.info('FRONTEND', 'Interface carregada', 'REQ-BOOT');
    initAgentAndCameras();

    const healthInterval = setInterval(() => {
      // Força verificação se o agente estiver offline para reconexão em background ativa
      checkHealth().then((h) => {
        if (h.online) {
          initAgentAndCameras();
        }
      }).catch(() => {});
    }, 6000);

    return () => clearInterval(healthInterval);
  }, [agentOffline]);

  const handleFocusToggle = (id: string) => {
    setFocusedCameraId((prev) => (prev === id ? null : id));
  };

  const handleSnapshotCaptured = (camera: CameraStream, dataUrl: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `cftv-snapshot-${camera.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.jpg`;
    link.click();
  };

  const handleAddCamera = (newCam: CameraStream) => {
    setCameras((prev) => [...prev, newCam]);
    initAgentAndCameras();
  };

  const handleResetDiagnostic = () => {
    setBootState((prev) => ({
      ...prev,
      agentStatus: '🟡 INICIANDO...',
      networkStatus: '🟡 DETECTANDO...',
      discoveryStatus: '🟡 AGUARDANDO REDE...',
      logs: [] // Limpa logs anteriores para iniciar a nova varredura do zero
    }));
  };

  const handleSelectCamera = (id: string) => {
    console.log(`[CAMERA] Selected: ${id}`);
    console.log(`[RTSP] Starting connection`);
    console.log(`[GO2RTC] Starting selected stream`);

    logger.info('CAMERA', `Selected: ${id}`, 'FRONT-SELECT');
    logger.info('RTSP', 'Starting connection', 'FRONT-SELECT');
    logger.info('GO2RTC', 'Starting selected stream', 'FRONT-SELECT');

    setSelectedCameraId(id);
  };

  const activeCameras = selectedCameraId
    ? cameras.filter((c) => c.id === selectedCameraId)
    : [];

  return (
    <div id="cftv-app-root" className="cftv-app-root flex flex-col min-h-screen">
      {/* Malha Neural de Partículas */}
      <ParticleCanvas />

      {/* Seletor de Câmera Descoberta ou Visualização de Grade */}
      {agentOffline || cameras.length === 0 ? (
        <CameraGrid
          cameras={cameras}
          focusedCameraId={focusedCameraId}
          cameraZooms={cameraZooms}
          agentOffline={agentOffline}
          agentError={agentError}
          onRetryConnection={initAgentAndCameras}
          onFocusToggle={handleFocusToggle}
          onSnapshot={handleSnapshotCaptured}
          onOpenPtz={(c) => setSelectedPtzCam(c)}
          onOpenAddModal={() => setIsAddModalOpen(true)}
        />
      ) : selectedCameraId === null ? (
        <CameraSelector cameras={cameras} onSelect={handleSelectCamera} />
      ) : (
        <>
          {/* Barra de Controle Tática de Exibição */}
          <div className="flex items-center justify-between px-6 py-2.5 border-b border-zinc-800/60 bg-zinc-950/20 backdrop-blur-md select-none font-rajdhani">
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-zinc-500 font-mono tracking-wider">CÂMERA ATIVA:</span>
              <span className="text-xs font-bold font-orbitron text-cyan-400 tracking-wider">
                {cameras.find((c) => c.id === selectedCameraId)?.name || 'Câmera'}
              </span>
            </div>
            {cameras.length > 1 && (
              <button
                onClick={() => setSelectedCameraId(null)}
                className="px-3 py-1 bg-zinc-900/60 hover:bg-cyan-950/20 border border-zinc-800 hover:border-cyan-500/25 text-zinc-400 hover:text-cyan-300 font-orbitron text-[10px] tracking-widest rounded transition-all cursor-pointer uppercase font-bold"
              >
                Mudar Câmera / Lista
              </button>
            )}
          </div>

          <CameraGrid
            cameras={activeCameras}
            focusedCameraId={focusedCameraId}
            cameraZooms={cameraZooms}
            agentOffline={agentOffline}
            agentError={agentError}
            onRetryConnection={initAgentAndCameras}
            onFocusToggle={handleFocusToggle}
            onSnapshot={handleSnapshotCaptured}
            onOpenPtz={(c) => setSelectedPtzCam(c)}
            onOpenAddModal={() => setIsAddModalOpen(true)}
          />
        </>
      )}

      {/* Botão Flutuante (FAB) para Adicionar Câmera */}
      {!agentOffline && (
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="cftv-btn-fab"
          title="Adicionar / Vincular Nova Câmera"
        >
          <Plus className="w-6 h-6 stroke-[2.5]" />
        </button>
      )}

      {/* Modais de controle */}
      <AddCameraModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddCamera}
        bootState={bootState}
        onResetDiagnostic={handleResetDiagnostic}
      />

      {selectedPtzCam && (
        <PtzModal
          camera={selectedPtzCam}
          isOpen={!!selectedPtzCam}
          onClose={() => setSelectedPtzCam(null)}
        />
      )}
    </div>
  );
}
