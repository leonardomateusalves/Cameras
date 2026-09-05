import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { CameraStream } from './types';
import { fetchCameras, checkHealth } from './api/cameras';
import { ParticleCanvas } from './components/ParticleCanvas/ParticleCanvas';
import { CameraGrid } from './components/CameraGrid';
import { AddCameraModal } from './components/AddCameraModal';
import { PtzModal } from './components/PtzModal';

export default function App() {
  const [cameras, setCameras] = useState<CameraStream[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentOffline, setAgentOffline] = useState(false);
  const [agentError, setAgentError] = useState<string>('');
  const [focusedCameraId, setFocusedCameraId] = useState<string | null>(null);
  const [cameraZooms] = useState<Record<string, number>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedPtzCam, setSelectedPtzCam] = useState<CameraStream | null>(null);

  const initAgentAndCameras = async () => {
    try {
      setLoading(true);
      // 1. Health Check
      const health = await checkHealth();
      if (!health.online) {
        setAgentOffline(true);
        setAgentError(health.error || 'Windows Local Agent não conectado. Para descobrir e acessar câmeras da rede local, instale e execute o aplicativo Windows.');
        setCameras([]);
        return;
      }

      setAgentOffline(false);
      setAgentError('');

      // 2. Fetch Cameras from Local Agent / Server
      const res = await fetchCameras();
      if (res && res.cameras) {
        setCameras(res.cameras);
      }
    } catch (err: any) {
      console.warn('[App] Erro de conexão com o agente local:', err);
      setAgentOffline(true);
      setAgentError('Windows Local Agent não conectado. Para descobrir e acessar câmeras da rede local, instale e execute o aplicativo Windows.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initAgentAndCameras();
  }, []);

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

  return (
    <div id="cftv-app-root" className="cftv-app-root">
      {/* Malha Neural de Partículas */}
      <ParticleCanvas />

      {/* Grade de Câmeras Modular */}
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

      {/* Modais */}
      <AddCameraModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={handleAddCamera}
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
