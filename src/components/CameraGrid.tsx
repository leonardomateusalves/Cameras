import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CameraStream } from '../types';
import { CameraCard } from './CameraCard';
import { GlassCard } from './GlassCard';
import { 
  PlusCircle, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Globe, 
  Settings2,
  Activity, 
  Network, 
  Search, 
  Terminal,
  Server,
  Zap
} from 'lucide-react';
import { getAgentBaseUrl, setManualAgentUrl } from '../api/cameras';

interface CameraGridProps {
  cameras: CameraStream[];
  focusedCameraId: string | null;
  cameraZooms: Record<string, number>;
  agentOffline?: boolean;
  agentError?: string;
  bootState?: {
    agentStatus: string;
    networkStatus: string;
    discoveryStatus: string;
    logs: { timestamp: string; prefix: string; message: string }[];
  };
  onRetryConnection?: () => void;
  onFocusToggle: (id: string) => void;
  onSnapshot: (camera: CameraStream, dataUrl: string) => void;
  onOpenPtz: (camera: CameraStream) => void;
  onEdit?: (camera: CameraStream) => void;
  onDelete?: (id: string) => void;
  onOpenAddModal?: () => void;
}

export function CameraGrid({
  cameras,
  focusedCameraId,
  cameraZooms,
  agentOffline,
  agentError,
  bootState,
  onRetryConnection,
  onFocusToggle,
  onSnapshot,
  onOpenPtz,
  onEdit,
  onDelete,
  onOpenAddModal
}: CameraGridProps) {
  const [manualUrl, setManualUrl] = useState(getAgentBaseUrl() || '127.0.0.1:8080');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const displayedCameras = focusedCameraId
    ? cameras.filter((c) => c.id === focusedCameraId)
    : cameras;

  const handleUpdateUrl = () => {
    setManualAgentUrl(manualUrl);
    if (onRetryConnection) onRetryConnection();
  };

  // Estado: Agente Windows Desconectado
  if (agentOffline) {
    return (
      <main id="cftv-main-viewport" className="cftv-main-viewport flex flex-col items-center justify-center flex-1 min-h-[80vh] p-6 my-auto">
        <GlassCard className="max-w-md w-full !p-8 flex flex-col items-center justify-center text-center font-rajdhani border-amber-500/30 my-auto">
          <div className="relative mb-5 flex items-center justify-center mx-auto">
            <div className="absolute inset-0 bg-amber-500/20 blur-xl rounded-full animate-pulse" />
            <AlertTriangle className="w-16 h-16 text-amber-400 relative z-10" />
          </div>
          <h2 className="text-xl font-orbitron font-bold text-amber-300 tracking-wider uppercase mb-3 text-center">
            Windows Local Agent não conectado
          </h2>
          <p className="text-sm text-zinc-300 font-sans mb-6 leading-relaxed text-center max-w-sm mx-auto">
            {agentError || 'Para descobrir e acessar câmeras da rede local, instale e execute o aplicativo Windows.'}
          </p>
          
          <div className="w-full space-y-4">
            <div className="flex flex-col gap-2">
              <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[10px] text-zinc-500 hover:text-cyan-400 flex items-center gap-1 mx-auto transition-colors font-mono uppercase tracking-widest"
              >
                <Settings2 className="w-3 h-3" />
                {showAdvanced ? 'Ocultar Configurações Avançadas' : 'Configurar IP do Agente Manualmente'}
              </button>

              {showAdvanced && (
                <div className="flex items-center gap-2 mt-2">
                  <div className="relative flex-1">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                    <input 
                      type="text"
                      value={manualUrl}
                      onChange={(e) => setManualUrl(e.target.value)}
                      placeholder="IP:Porta (Ex: 127.0.0.1:8080)"
                      className="w-full bg-black/60 border border-zinc-800 rounded px-9 py-2 text-sm text-cyan-300 font-mono focus:border-cyan-500/50 outline-none"
                    />
                  </div>
                  <button 
                    onClick={handleUpdateUrl}
                    className="p-2 bg-cyan-600/20 hover:bg-cyan-600/40 border border-cyan-500/30 rounded text-cyan-400 transition-all"
                    title="Aplicar URL"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {onRetryConnection && (
              <button
                onClick={onRetryConnection}
                className="cftv-btn-prismatic mx-auto w-full"
              >
                <RefreshCw className="w-5 h-5" />
                <span>Verificar Conexão</span>
              </button>
            )}
          </div>
        </GlassCard>
      </main>
    );
  }

  // Estado: Nenhuma Câmera Conectada
  if (cameras.length === 0) {
    const isWorking = bootState?.discoveryStatus.includes('🔍') || 
                     bootState?.agentStatus.includes('🟡') ||
                     bootState?.agentStatus.includes('VINCULANDO');

    return (
      <main id="cftv-main-viewport" className="cftv-main-viewport flex flex-col items-center justify-center flex-1 min-h-[80vh] p-6 my-auto">
        <GlassCard className="max-w-2xl w-full !p-8 flex flex-col items-center justify-center text-center font-rajdhani border-cyan-500/30 my-auto overflow-hidden relative">
          {isWorking && <div className="cftv-boot-scan-line" />}
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative mb-6"
          >
            <div className={`absolute inset-0 bg-cyan-500/20 blur-xl rounded-full ${isWorking ? 'animate-pulse' : ''}`} />
            <div className="relative z-10 w-20 h-20 bg-black/40 border border-cyan-500/30 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <ShieldCheck className={`w-12 h-12 ${isWorking ? 'text-cyan-400 animate-pulse' : 'text-zinc-500'}`} />
            </div>
          </motion.div>
          
          <motion.h2 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-orbitron font-bold text-cyan-300 tracking-[0.2em] uppercase mb-2 text-center"
          >
            {isWorking ? 'Identificando Ambiente' : 'Monitoramento Inativo'}
          </motion.h2>
          
          <div className="cftv-boot-container">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="cftv-boot-status-card"
            >
              <div className="cftv-boot-status-item">
                <div className="flex items-center gap-3">
                  <Server className="w-4 h-4 text-zinc-500" />
                  <span className="cftv-boot-status-label">Windows Agent</span>
                </div>
                <div className="cftv-boot-status-value">
                  {bootState?.agentStatus.includes('🟢') && <div className="cftv-boot-status-dot" />}
                  <span>{bootState?.agentStatus || 'AGUARDANDO...'}</span>
                </div>
              </div>

              <div className="cftv-boot-status-item">
                <div className="flex items-center gap-3">
                  <Network className="w-4 h-4 text-zinc-500" />
                  <span className="cftv-boot-status-label">Conectividade Rede</span>
                </div>
                <div className="cftv-boot-status-value">
                  {bootState?.networkStatus.includes('🟢') && <div className="cftv-boot-status-dot" />}
                  <span>{bootState?.networkStatus || 'ANALISANDO...'}</span>
                </div>
              </div>

              <div className="cftv-boot-status-item">
                <div className="flex items-center gap-3">
                  <Search className="w-4 h-4 text-zinc-500" />
                  <span className="cftv-boot-status-label">Deep Discovery</span>
                </div>
                <div className="cftv-boot-status-value">
                  {isWorking && <Activity className="w-3 h-3 text-cyan-500 animate-spin" />}
                  <span>{bootState?.discoveryStatus || 'INATIVO'}</span>
                </div>
              </div>
            </motion.div>

            {bootState && bootState.logs && bootState.logs.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="cftv-boot-log-panel"
              >
                <div className="cftv-boot-log-header">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-cyan-500" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Console de Atividade</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-800" />
                  </div>
                </div>
                <div className="cftv-boot-log-content">
                  <AnimatePresence initial={false}>
                    {bootState.logs.slice(-5).map((log, idx) => {
                      const tagClass = log.prefix === 'NETWORK' ? 'tag-network' : 
                                     log.prefix === 'ONVIF' ? 'tag-onvif' :
                                     log.prefix === 'AGENT' ? 'tag-agent' : 'tag-discovery';
                      return (
                        <motion.div 
                          key={idx}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="cftv-boot-log-line"
                        >
                          <span className="cftv-boot-log-time">[{log.timestamp}]</span>
                          <span className={`cftv-boot-log-tag ${tagClass}`}>{log.prefix}</span>
                          <span className="text-zinc-300 truncate">{log.message}</span>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </div>

          {!isWorking && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-10"
            >
              <p className="text-sm text-zinc-400 font-sans mb-8 leading-relaxed text-center max-w-sm mx-auto">
                O Nexus não identificou nenhuma câmera na rede local. Você pode tentar uma nova busca ou cadastrar manualmente.
              </p>
              {onOpenAddModal && (
                <button
                  onClick={onOpenAddModal}
                  className="cftv-btn-prismatic mx-auto group"
                >
                  <Zap className="w-5 h-5 group-hover:text-amber-400 transition-colors" />
                  <span>Vincular Nova Câmera</span>
                </button>
              )}
            </motion.div>
          )}
        </GlassCard>
      </main>
    );
  }

  return (
    <main id="cftv-main-viewport" className="cftv-main-viewport">
      <div className="cftv-viewport-container">
        <section
          id="cftv-camera-grid"
          className={`cftv-camera-grid ${
            focusedCameraId ? 'cftv-camera-grid-focused' : ''
          }`}
        >
          {displayedCameras.map((cam) => (
            <div key={cam.id} className="cftv-camera-wrapper">
              <CameraCard
                camera={cam}
                isFocused={focusedCameraId === cam.id}
                onFocusToggle={onFocusToggle}
                onSnapshot={onSnapshot}
                onOpenPtz={onOpenPtz}
                onEdit={onEdit}
                onDelete={onDelete}
                zoomLevel={cameraZooms[cam.id] || 1}
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
