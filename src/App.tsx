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
  const [editingCamera, setEditingCamera] = useState<CameraStream | null>(null);
  const [selectedPtzCam, setSelectedPtzCam] = useState<CameraStream | null>(null);

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
      
      if (agentBase && agentBase.startsWith('http')) {
        // Converte http://... para ws://... ou https:// para wss://
        wsUrl = agentBase.replace(/^http/, 'ws') + '/ws';
      } else if (window.electronAPI) {
        wsUrl = 'ws://127.0.0.1:8080/ws';
      } else {
        // Fallback para o próprio servidor que serve o frontend
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

  const handleEditCamera = (cam: CameraStream) => {
    setEditingCamera(cam);
    setIsAddModalOpen(true);
  };

  const handleSnapshotCaptured = (camera: CameraStream, dataUrl: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `cftv-snapshot-${camera.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}.jpg`;
    link.click();
  };

  const handleModalClose = () => {
    setIsAddModalOpen(false);
    setEditingCamera(null);
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

  return (
    <div id="cftv-app-root" className="cftv-app-root flex flex-col min-h-screen">
      {/* Malha Neural de Partículas */}
      <ParticleCanvas />

      <div className="relative z-10 flex flex-col flex-1">
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
          onEdit={handleEditCamera}
          onOpenAddModal={() => setIsAddModalOpen(true)}
        />
      </div>

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
        onClose={handleModalClose}
        onAdd={handleAddCamera}
        initialData={editingCamera}
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
