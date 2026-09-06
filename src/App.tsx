import { useState, useEffect, useCallback } from 'react';
import { CameraStream } from './types';
import { fetchCameras, checkHealth, getDiscoveryStatus, getAgentBaseUrl, deleteCamera, discoverCamerasFull } from './api/cameras';
import { ParticleCanvas } from './components/ui/ParticleCanvas';
import { CameraGrid } from './components/camera/CameraGrid';
import { AddCameraModal } from './components/modals/AddCameraModal';
import { PtzModal } from './components/modals/PtzModal';
import { LogTerminalModal } from './components/modals/LogTerminalModal';
import { TacticalCommandCenter } from './components/ui/TacticalCommandCenter';
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
  const [showConsole, setShowConsole] = useState(false);
  const [isManualScanning, setIsManualScanning] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);

  // Auto-Discovery and network state
  const [bootState, setBootState] = useState({
    agentStatus: '🟡 INICIANDO...',
    networkStatus: '🟡 DETECTANDO...',
    discoveryStatus: '🟡 AGUARDANDO REDE...',
    devicesCount: 0,
    logs: [] as LogEntry[]
  });

  // Função para adicionar log ao bootState
  const addLog = (prefix: string, message: string) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    setBootState(prev => {
      // Evita logs duplicados idênticos em sequência
      if (prev.logs.length > 0 && prev.logs[prev.logs.length - 1].message === message) {
        return prev;
      }
      return {
        ...prev,
        logs: [...prev.logs, { timestamp, prefix, message }]
      };
    });
  };

  // Função para inicializar o estado e carregar câmeras
  const initAgentAndCameras = async () => {
    try {
      setLoading(true);
      // Sempre tenta limpar o estado de timeout ao iniciar uma nova busca
      setIsTimedOut(false);
      
      addLog('SYSTEM', 'Iniciando sequência de boot tático...');
      
      const health = await checkHealth();
      if (!health.online) {
        setAgentOffline(true);
        setAgentError(health.error || 'Software Nexus Agent não detectado no Windows (porta 8080).');
        addLog('ERROR', `AGENT_NOT_FOUND: ${health.error || 'Nexus Agent offline. Verifique a porta 8080.'}`);
        if (health.discoveryState) {
          setBootState(prev => ({
            ...prev,
            agentStatus: health.discoveryState!.agentStatus,
            networkStatus: health.discoveryState!.networkStatus,
            discoveryStatus: health.discoveryState!.discoveryStatus,
            logs: health.discoveryState!.logs || prev.logs
          }));
        } else {
          const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
          const errorLog: LogEntry = {
            timestamp,
            prefix: 'ERROR',
            message: `AGENT_NOT_FOUND: ${health.error || 'Software Nexus Agent não detectado. Verifique se o .exe está em execução e a porta 8080 está liberada no Firewall do Windows.'}`
          };
          setBootState(prev => ({
            ...prev,
            agentStatus: '🔴 NÃO DETECTADO',
            networkStatus: '🔴 OFFLINE',
            discoveryStatus: '🔴 AGUARDANDO AGENTE WINDOWS',
            logs: [...prev.logs, errorLog]
          }));
        }
        setCameras([]);
        return;
      }

      setAgentOffline(false);
      setAgentError('');
      addLog('AGENT', 'NEXUS_AGENT_ONLINE: Conectado ao broker local (127.0.0.1:8080).');
      addLog('NETWORK', 'MAPEANDO_ADAPTADORES: Identificando interfaces de rede IPv4 ativas...');
      addLog('ONVIF', 'WS_DISCOVERY: Enviando sondagem multicast (239.255.255.250:3702)...');

      if (health.discoveryState) {
        setBootState(prev => ({
          ...prev,
          agentStatus: health.discoveryState.agentStatus,
          networkStatus: health.discoveryState.networkStatus,
          discoveryStatus: health.discoveryState.discoveryStatus,
          logs: health.discoveryState.logs || []
        }));
      }

      const res = await fetchCameras();
      if (res && res.cameras) {
        setCameras(res.cameras);
        if (res.cameras.length === 0) {
          addLog('DISCOVERY', 'Agente conectado, mas nenhum dispositivo foi identificado na varredura inicial.');
        } else {
          addLog('DISCOVERY', `${res.cameras.length} dispositivo(s) prontos para transmissão.`);
        }
      }
    } catch (err: any) {
      logger.error('FRONTEND', 'Erro de conexão com o agente local', err);
      setAgentOffline(true);
      setAgentError('Windows Local Agent não conectado.');
      
      const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
      const errorLog: LogEntry = {
        timestamp,
        prefix: 'ERROR',
        message: `CONNECTION_FAILED: Falha crítica ao contactar agente local. Motivo: ${err.message || 'Timeout/Recusa de Conexão'}. Certifique-se de que o Agente Windows está aberto e operando na porta 8080.`
      };
      setBootState(prev => ({
        ...prev,
        agentStatus: '🔴 NÃO DETECTADO',
        networkStatus: '🔴 OFFLINE',
        discoveryStatus: '🔴 FALHA NA COMUNICAÇÃO',
        logs: [...prev.logs, errorLog]
      }));
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
    setCameras((prev) => {
      const exists = prev.find(c => c.id === newCam.id);
      if (exists) {
        return prev.map(c => c.id === newCam.id ? newCam : c);
      }
      return [...prev, newCam];
    });
    initAgentAndCameras();
  };

  const handleDeleteCamera = async (id: string) => {
    try {
      const res = await deleteCamera(id);
      if (res.success) {
        setCameras((prev) => prev.filter((c) => c.id !== id));
        if (focusedCameraId === id) setFocusedCameraId(null);
      }
    } catch (err: any) {
      alert('Erro ao excluir câmera: ' + err.message);
    }
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

  const handleForceDiscovery = async () => {
    try {
      setIsTimedOut(false);
      setIsManualScanning(true);
      await discoverCamerasFull();
      
      // Aguarda o backend processar e então tenta carregar os resultados
      setTimeout(async () => {
        await initAgentAndCameras();
        setIsManualScanning(false);
      }, 5000); // 5 segundos de varredura profunda
    } catch (err) {
      logger.error('RESCAN', 'Erro ao forçar descoberta', err);
      setIsManualScanning(false);
      setIsTimedOut(true);
    }
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
          bootState={bootState}
          onRetryConnection={initAgentAndCameras}
          onFocusToggle={handleFocusToggle}
          onSnapshot={handleSnapshotCaptured}
          onOpenPtz={(c) => setSelectedPtzCam(c)}
          onEdit={handleEditCamera}
          onDelete={handleDeleteCamera}
          isManualScanning={isManualScanning}
          isTimedOut={isTimedOut}
          addLog={addLog}
        />
      </div>

      {selectedPtzCam && (
        <PtzModal
          camera={selectedPtzCam}
          isOpen={!!selectedPtzCam}
          onClose={() => setSelectedPtzCam(null)}
        />
      )}

      <AddCameraModal
        isOpen={isAddModalOpen}
        onClose={handleModalClose}
        onAdd={handleAddCamera}
        initialData={editingCamera}
        bootState={bootState}
        onResetDiagnostic={handleResetDiagnostic}
      />

      <LogTerminalModal
        isOpen={showConsole}
        onClose={() => setShowConsole(false)}
        logs={bootState.logs}
      />

      {/* Tactical Command Center - Centralized Global Controls */}
      <TacticalCommandCenter
        onRescan={handleForceDiscovery}
        onAddCamera={() => setIsAddModalOpen(true)}
        onOpenLogs={() => setShowConsole(true)}
        isScanning={isManualScanning}
        isTimedOut={isTimedOut}
      />
    </div>
  );
}
