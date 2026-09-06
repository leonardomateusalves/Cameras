import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CameraStream } from '../../types';
import { CameraCard } from './CameraCard';
import { GlassCard } from '../ui/GlassCard';
import { BootEnvironmentHud } from '../radar/BootEnvironmentHud';
import { 
  PlusCircle, 
  ShieldCheck, 
  AlertTriangle, 
  RefreshCw, 
  Globe, 
  Settings2,
  Zap
} from 'lucide-react';
import { getAgentBaseUrl, setManualAgentUrl } from '../../api/cameras';

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
  isManualScanning?: boolean;
  isTimedOut?: boolean;
  addLog?: (prefix: string, message: string) => void;
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
  isManualScanning,
  isTimedOut,
  addLog
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

  // Estado: Nenhuma Câmera Conectada (Exibe o HUD Tático de Descoberta / Ambiente)
  if (cameras.length === 0) {
    return (
      <BootEnvironmentHud
        cameras={cameras}
        bootState={bootState}
        onRetryConnection={onRetryConnection}
        isManualScanning={isManualScanning}
        isTimedOut={isTimedOut}
        addLog={addLog}
      />
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
