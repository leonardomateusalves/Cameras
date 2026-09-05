import { CameraStream } from '../types';
import { CameraCard } from './CameraCard';
import { GlassCard } from './GlassCard';
import { PlusCircle, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';

interface CameraGridProps {
  cameras: CameraStream[];
  focusedCameraId: string | null;
  cameraZooms: Record<string, number>;
  agentOffline?: boolean;
  agentError?: string;
  onRetryConnection?: () => void;
  onFocusToggle: (id: string) => void;
  onSnapshot: (camera: CameraStream, dataUrl: string) => void;
  onOpenPtz: (camera: CameraStream) => void;
  onEdit?: (camera: CameraStream) => void;
  onOpenAddModal?: () => void;
}

export function CameraGrid({
  cameras,
  focusedCameraId,
  cameraZooms,
  agentOffline,
  agentError,
  onRetryConnection,
  onFocusToggle,
  onSnapshot,
  onOpenPtz,
  onEdit,
  onOpenAddModal
}: CameraGridProps) {
  const displayedCameras = focusedCameraId
    ? cameras.filter((c) => c.id === focusedCameraId)
    : cameras;

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
          {onRetryConnection && (
            <button
              onClick={onRetryConnection}
              className="cftv-btn-prismatic mx-auto"
            >
              <RefreshCw className="w-5 h-5" />
              <span>Verificar Conexão</span>
            </button>
          )}
        </GlassCard>
      </main>
    );
  }

  // Estado: Nenhuma Câmera Conectada
  if (cameras.length === 0) {
    return (
      <main id="cftv-main-viewport" className="cftv-main-viewport flex flex-col items-center justify-center flex-1 min-h-[80vh] p-6 my-auto">
        <GlassCard className="max-w-md w-full !p-8 flex flex-col items-center justify-center text-center font-rajdhani border-cyan-500/30 my-auto">
          <div className="relative mb-5 flex items-center justify-center mx-auto">
            <div className="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full animate-pulse" />
            <ShieldCheck className="w-16 h-16 text-cyan-400 relative z-10" />
          </div>
          <h2 className="text-xl font-orbitron font-bold text-cyan-300 tracking-wider uppercase mb-3 text-center">
            Nenhuma Câmera Conectada
          </h2>
          <p className="text-sm text-zinc-300 font-sans mb-8 leading-relaxed text-center max-w-sm mx-auto">
            Nenhuma câmera IP foi cadastrada ainda. Utilize o botão abaixo para executar a varredura ONVIF na sua rede local ou cadastrar um endereço RTSP.
          </p>
          {onOpenAddModal && (
            <button
              onClick={onOpenAddModal}
              className="cftv-btn-prismatic mx-auto"
            >
              <PlusCircle className="w-5 h-5" />
              <span>Vincular Primeira Câmera</span>
            </button>
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
                zoomLevel={cameraZooms[cam.id] || 1}
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
