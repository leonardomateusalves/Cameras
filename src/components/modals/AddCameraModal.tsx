import { useState, FormEvent, useEffect } from 'react';
import { X, Radio, Search, ShieldCheck, Wifi, RefreshCw, Edit3 } from 'lucide-react';
import { CameraStream } from '../../types';
import { GlassCard } from '../ui/GlassCard';
import { CustomSelect } from '../ui/CustomSelect';
import { discoverCameras, discoverCamerasFull, testCamera, addCamera } from '../../api/cameras';
import { DiagnosticViewer } from '../tools/DiagnosticViewer';

interface LogEntry {
  timestamp: string;
  prefix: string;
  message: string;
}

interface AddCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (newCam: CameraStream) => void;
  initialData?: CameraStream | null;
  bootState: {
    agentStatus: string;
    networkStatus: string;
    discoveryStatus: string;
    devicesCount: number;
    logs: LogEntry[];
  };
  onResetDiagnostic: () => void;
}

interface DiscoveredDevice {
  id: string;
  name: string;
  ip: string;
  model: string;
  rtspUrl: string;
  resolution: string;
  ptz: boolean;
  onvifSupported?: boolean;
}

export function AddCameraModal({ isOpen, onClose, onAdd, initialData, bootState, onResetDiagnostic }: AddCameraModalProps) {
  const [activeTab, setActiveTab] = useState<'scan' | 'manual'>('scan');
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredList, setDiscoveredList] = useState<DiscoveredDevice[]>([]);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Manual form state
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [location, setLocation] = useState('');
  const [resolution, setResolution] = useState('1920x1080');
  const [transport, setTransport] = useState<'tcp' | 'udp'>('tcp');
  const [ptzEnabled, setPtzEnabled] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isAddingAll, setIsAddingAll] = useState(false);

  // Split fields for better UX
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('554');
  const [path, setPath] = useState('/live/ch0');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const parseUrlToFields = (url: string) => {
    try {
      if (!url) return;
      // Regex para extrair componentes da URL RTSP
      const regex = /^rtsp:\/\/([^/]+)(.*)/i;
      const match = url.match(regex);
      if (!match) return;

      const authority = match[1];
      const urlPath = match[2] || '/';
      setPath(urlPath);
      
      let username = '';
      let pass = '';
      let hostPort = authority;

      if (authority.includes('@')) {
        const lastAtIndex = authority.lastIndexOf('@');
        const credentials = authority.substring(0, lastAtIndex);
        hostPort = authority.substring(lastAtIndex + 1);
        
        const firstColonIndex = credentials.indexOf(':');
        if (firstColonIndex >= 0) {
          username = decodeURIComponent(credentials.substring(0, firstColonIndex));
          pass = decodeURIComponent(credentials.substring(firstColonIndex + 1));
        } else {
          username = decodeURIComponent(credentials);
        }
      }
      setUser(username);
      setPassword(pass);

      if (hostPort.includes(':')) {
        const hpParts = hostPort.split(':');
        setHost(hpParts[0]);
        setPort(hpParts[1] || '554');
      } else {
        setHost(hostPort);
        setPort('554');
      }
    } catch (e) {
      console.error('Erro ao parsear URL para campos:', e);
    }
  };

  const syncFieldsToUrl = () => {
    const encodedUser = encodeURIComponent(user);
    const encodedPass = encodeURIComponent(password);
    const auth = user ? `${encodedUser}${password ? `:${encodedPass}` : ''}@` : '';
    const portStr = port && port !== '554' ? `:${port}` : '';
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const newUrl = `rtsp://${auth}${host}${portStr}${cleanPath}`;
    setRtspUrl(newUrl);
  };

  useEffect(() => {
    if (isOpen && initialData) {
      setActiveTab('manual');
      setName(initialData.name);
      setRtspUrl(initialData.rtspUrl);
      parseUrlToFields(initialData.rtspUrl);
      setLocation(initialData.location);
      setResolution(initialData.resolution || '1920x1080');
      setTransport(initialData.transport || 'tcp');
      setPtzEnabled(initialData.ptzEnabled || false);
    } else if (isOpen) {
      setName('');
      setRtspUrl('');
      setUser('');
      setPassword('');
      setHost('');
      setPort('554');
      setPath('/live/ch0');
      setLocation('');
      setResolution('1920x1080');
      setTransport('tcp');
      setPtzEnabled(false);
      setActiveTab('scan');
      setShowAdvanced(false);
    }
  }, [isOpen, initialData]);

  // Sync back to URL whenever split fields change
  useEffect(() => {
    if (!showAdvanced && activeTab === 'manual') {
      syncFieldsToUrl();
    }
  }, [user, password, host, port, path, showAdvanced, activeTab]);

  const handleStartScan = async () => {
    setIsScanning(true);
    setScanCompleted(false);
    setDiscoveredList([]);
    setErrorMsg('');

    // 1. Redefinir status no frontend instantaneamente para os indicados pelo usuario
    onResetDiagnostic();

    try {
      // 2. Disparar a varredura profunda no backend (roda em background alimentando o WebSocket)
      await discoverCamerasFull();
      
      // 3. Executa a varredura de busca para obter a lista final de dispositivos descobertos
      const result = await discoverCameras();
      if (result.success) {
        setDiscoveredList(result.devices);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao escanear rede LAN');
    } finally {
      setIsScanning(false);
      setScanCompleted(true);
    }
  };


  const handleLinkDiscovered = async (device: DiscoveredDevice) => {
    try {
      const res = await addCamera({
         name: device.name,
         location: `IP: ${device.ip}`,
         rtspUrl: device.rtspUrl || `rtsp://${device.ip}:554/live`,
         resolution: device.resolution,
         ptzEnabled: device.onvifSupported ?? device.ptz
      });
      if (res.success) {
         onAdd(res.camera);
         // Não fechamos o modal para permitir adicionar outras
         setDiscoveredList(prev => prev.filter(d => d.id !== device.id));
      }
    } catch (err: any) {
      alert('Erro ao vincular: ' + err.message);
    }
  };

  const handleQuickAddLocal = async (ip: string, name: string, location: string) => {
    try {
      const res = await addCamera({
        name,
        location,
        rtspUrl: `rtsp://admin:10203040LW@${ip}:554/live`,
        resolution: '1920x1080',
        ptzEnabled: true
      });
      if (res.success) {
        onAdd(res.camera);
        alert(`Câmera ${name} (${ip}) adicionada com sucesso!`);
      }
    } catch (err: any) {
      alert('Erro ao adicionar câmera: ' + err.message);
    }
  };

  const handleAddAllDiscovered = async () => {
    if (discoveredList.length === 0) return;
    
    setIsAddingAll(true);
    let addedCount = 0;
    
    try {
      for (const device of discoveredList) {
        const res = await addCamera({
          name: device.name,
          location: `IP: ${device.ip}`,
          rtspUrl: device.rtspUrl || `rtsp://${device.ip}:554/live`,
          resolution: device.resolution,
          ptzEnabled: device.onvifSupported ?? device.ptz
        });
        if (res.success) {
          onAdd(res.camera);
          addedCount++;
        }
      }
      setDiscoveredList([]);
      alert(`${addedCount} câmeras foram adicionadas com sucesso!`);
      onClose();
    } catch (err: any) {
      alert('Erro ao adicionar algumas câmeras: ' + err.message);
    } finally {
      setIsAddingAll(false);
    }
  };

  const handleSubmitManual = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !rtspUrl.trim()) return;

    setIsTesting(true);
    try {
      let finalRtspUrl = rtspUrl.trim();
      
      // Se estiver no modo simples, garante que a URL está sincronizada com os campos individuais
      if (!showAdvanced) {
        const encodedUser = encodeURIComponent(user);
        const encodedPass = encodeURIComponent(password);
        const auth = user ? `${encodedUser}${password ? `:${encodedPass}` : ''}@` : '';
        const portStr = port && port !== '554' ? `:${port}` : '';
        const cleanPath = path.startsWith('/') ? path : `/${path}`;
        finalRtspUrl = `rtsp://${auth}${host}${portStr}${cleanPath}`;
      }

      if (!finalRtspUrl) {
        alert('Por favor, preencha os campos da câmera ou a URL RTSP.');
        setIsTesting(false);
        return;
      }

      const testRes = await testCamera(finalRtspUrl);
      if (!testRes.success) {
        alert(`Erro na conexão: ${testRes.message}`);
        setIsTesting(false);
        return;
      }
      
      const newCamData = {
        id: initialData?.id, // Manter o ID se for edição
        name: name.trim(),
        location: location.trim() || 'Setor Não Definido',
        rtspUrl: finalRtspUrl,
        resolution,
        ptzEnabled,
        transport
      };

      const res = await addCamera(newCamData);
      if (res.success) {
        onAdd(res.camera);
        onClose();
      }
    } catch (err: any) {
      alert('Erro ao testar/cadastrar: ' + err.message);
    } finally {
      setIsTesting(false);
    }
  };

  const setPreset = (type: 'intelbras' | 'hikvision' | 'dahua' | 'tapo') => {
    let url = '';
    if (type === 'intelbras') {
      url = 'rtsp://admin:admin123@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0';
      setName('Câmera Intelbras HD');
    } else if (type === 'hikvision') {
      url = 'rtsp://admin:senha123@192.168.1.64:554/Streaming/Channels/101';
      setName('Câmera Hikvision IP');
    } else if (type === 'dahua') {
      url = 'rtsp://admin:admin123@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0';
      setName('Câmera Dahua Dome');
    } else if (type === 'tapo') {
      url = 'rtsp://usuario:senha@192.168.1.50:554/stream1';
      setName('TP-Link Tapo C200');
    }
    setRtspUrl(url);
    parseUrlToFields(url);
  };

  if (!isOpen) return null;

  return (
    <div
      id="modal-add-camera-backdrop"
      className="cftv-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-camera-title"
      onClick={onClose}
    >
      <div className="cftv-modal-wrapper cftv-modal-wrapper-md" onClick={(e) => e.stopPropagation()}>
        <GlassCard id="modal-add-camera-card" className="cftv-glass-modal p-5 sm:p-6">
          <header className="cftv-modal-header">
            <div id="add-camera-title" className="cftv-modal-title text-cyan-400">
              {initialData ? <Edit3 className="w-4 h-4 text-amber-400" /> : <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />}
              <span className={initialData ? 'text-amber-400' : ''}>
                {initialData ? 'Editar Conexão da Câmera' : 'Adicionar e Vincular Câmera CFTV'}
              </span>
            </div>
            <button
              id="btn-close-add-modal"
              onClick={onClose}
              className="cftv-btn-icon"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          <nav className="flex items-center gap-2 mt-4 border-b border-white/10 pb-3" aria-label="Abas de adição">
            {!initialData && (
              <button
                onClick={() => setActiveTab('scan')}
                className={`px-4 py-2 font-rajdhani font-bold text-xs tracking-wider uppercase transition-all flex items-center gap-2 ${
                  activeTab === 'scan'
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/10'
                }`}
              >
                <Search className="w-3.5 h-3.5" />
                <span>Varredura ONVIF & RTSP (Rede Local)</span>
              </button>
            )}
            <button
              onClick={() => setActiveTab('manual')}
              className={`px-4 py-2 font-rajdhani font-bold text-xs tracking-wider uppercase transition-all flex items-center gap-2 ${
                activeTab === 'manual'
                  ? (initialData ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50' : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50')
                  : 'bg-white/5 text-zinc-400 hover:text-zinc-200 border border-white/10'
              }`}
            >
              {initialData ? <Edit3 className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
              <span>{initialData ? 'Configurações de Fluxo' : 'Cadastro Manual RTSP'}</span>
            </button>
          </nav>

          <main className="mt-4">
            {activeTab === 'scan' ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between bg-black/40 p-4 border border-white/10">
                  <div>
                    <h4 className="font-rajdhani font-bold text-sm text-cyan-300 tracking-wider">
                      BUSCA AUTOMÁTICA DE DISPOSITIVOS IP
                    </h4>
                    <p className="text-xs text-zinc-400 font-sans mt-0.5">
                      Procura por protocolos ONVIF Profile S, WS-Discovery e streams RTSP ativos na subnet local.
                    </p>
                  </div>
                  <button
                    onClick={handleStartScan}
                    disabled={isScanning}
                    className="cftv-btn-primary flex items-center gap-2 py-2 px-4 flex-shrink-0"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>{isScanning ? 'Escaneando Rede...' : 'Iniciar Varredura'}</span>
                  </button>
                </div>

                {/* Quick Add Local Cameras Helper */}
                <div className="bg-black/30 border border-white/10 p-3.5 flex flex-col gap-2">
                  <span className="font-rajdhani font-bold text-xs text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5" /> Adição Rápida de Câmeras da Rede Local (192.168.1.x):
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickAddLocal('192.168.1.18', 'NVT (192.168.1.18)', 'Setor Patio / China')}
                      className="p-2 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/40 text-left transition-all cursor-pointer"
                    >
                      <div className="font-orbitron text-xs text-cyan-300">NVT (.18)</div>
                      <div className="text-[10px] font-mono text-zinc-400">192.168.1.18:554</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddLocal('192.168.1.15', 'iM7-M3M-5647 (192.168.1.15)', 'Setor Portaria / Brasil')}
                      className="p-2 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/40 text-left transition-all cursor-pointer"
                    >
                      <div className="font-orbitron text-xs text-cyan-300">iM7 (.15)</div>
                      <div className="text-[10px] font-mono text-zinc-400">192.168.1.15:554</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickAddLocal('192.168.1.13', 'iM6-3161 (192.168.1.13)', 'Setor Perimetral / Brasil')}
                      className="p-2 bg-white/5 hover:bg-cyan-500/10 border border-white/10 hover:border-cyan-500/40 text-left transition-all cursor-pointer"
                    >
                      <div className="font-orbitron text-xs text-cyan-300">iM6 (.13)</div>
                      <div className="text-[10px] font-mono text-zinc-400">192.168.1.13:554</div>
                    </button>
                  </div>
                </div>

                {isScanning && (
                  <DiagnosticViewer
                    agentStatus={bootState.agentStatus}
                    networkStatus={bootState.networkStatus}
                    discoveryStatus={bootState.discoveryStatus}
                    logs={bootState.logs}
                  />
                )}

                {!isScanning && scanCompleted && discoveredList.length === 0 && (
                  <div className="py-8 text-center text-zinc-400 font-rajdhani text-sm">
                    Nenhuma nova câmera encontrada na varredura. Tente o cadastro manual.
                  </div>
                )}

                {!isScanning && discoveredList.length > 0 && (
                  <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto pr-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-rajdhani font-bold text-xs text-zinc-400 uppercase tracking-wider">
                        Dispositivos Encontrados ({discoveredList.length}):
                      </span>
                      <button
                        onClick={handleAddAllDiscovered}
                        disabled={isAddingAll}
                        className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 px-2 py-0.5 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all flex items-center gap-1"
                      >
                        {isAddingAll ? 'Adicionando...' : (
                          <>
                            <ShieldCheck className="w-3 h-3" />
                            Adicionar Todas
                          </>
                        )}
                      </button>
                    </div>
                    {discoveredList.map((dev) => (
                      <div
                        key={dev.id}
                        className="flex items-center justify-between p-3 bg-black/60 border border-white/10 hover:border-cyan-500/40 transition-colors cursor-pointer"
                        onClick={() => handleLinkDiscovered(dev)}
                      >
                        <div className="flex flex-col gap-0.5 min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                            <strong className="font-orbitron text-xs text-cyan-300 truncate">{dev.name}</strong>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                              {dev.resolution}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-zinc-400">
                            IP: <strong className="text-zinc-200">{dev.ip}</strong> | Modelo: {dev.model}
                          </span>
                        </div>
                        <button
                          onClick={() => handleLinkDiscovered(dev)}
                          className="cftv-btn-prismatic !py-1.5 !px-3 text-xs"
                        >
                          Vincular Câmera
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!isScanning && !scanCompleted && (
                  <div className="py-10 text-center flex flex-col items-center justify-center gap-2 text-zinc-500 font-rajdhani">
                    <ShieldCheck className="w-10 h-10 text-cyan-500/40 mb-1" />
                    <span>Clique em "Iniciar Varredura" para detectar câmeras ONVIF e RTSP conectadas na rede.</span>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSubmitManual} className="flex flex-col gap-3.5">
                <section aria-label="Presets de Fabricantes" className="mb-1">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-[11px] font-rajdhani font-bold text-zinc-400 tracking-wider uppercase">
                      Presets de Fabricantes:
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className="text-[10px] font-bold uppercase tracking-tighter text-cyan-500 hover:text-cyan-400"
                    >
                      {showAdvanced ? 'Modo Simples (User/Pass)' : 'Modo Avançado (URL Direta)'}
                    </button>
                  </div>
                  <nav className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => setPreset('intelbras')}
                      className="py-1.5 px-3 text-xs font-rajdhani font-semibold bg-white/5 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/40 transition-colors text-center"
                    >
                      Intelbras
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('hikvision')}
                      className="py-1.5 px-3 text-xs font-rajdhani font-semibold bg-white/5 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/40 transition-colors text-center"
                    >
                      Hikvision
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('dahua')}
                      className="py-1.5 px-3 text-xs font-rajdhani font-semibold bg-white/5 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/40 transition-colors text-center"
                    >
                      Dahua
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreset('tapo')}
                      className="py-1.5 px-3 text-xs font-rajdhani font-semibold bg-white/5 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/40 transition-colors text-center"
                    >
                      Tapo IP
                    </button>
                  </nav>
                </section>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="input-camera-name" className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                    Nome da Câmera / Identificação:
                  </label>
                  <input
                    id="input-camera-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Portaria Norte - Câmera 02"
                    required
                    className="cftv-input font-sans"
                  />
                </div>

                {!showAdvanced ? (
                  <div className="space-y-3.5">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                          Usuário (Login):
                        </label>
                        <input
                          type="text"
                          value={user}
                          onChange={(e) => setUser(e.target.value)}
                          placeholder="admin"
                          className="cftv-input font-sans text-cyan-100"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                          Senha (Password):
                        </label>
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="********"
                          className="cftv-input font-sans text-cyan-100"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="sm:col-span-2 flex flex-col gap-1.5">
                        <label className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                          IP ou Host da Câmera:
                        </label>
                        <input
                          type="text"
                          value={host}
                          onChange={(e) => setHost(e.target.value)}
                          placeholder="192.168.1.108"
                          required={!showAdvanced}
                          className="cftv-input font-mono text-cyan-400"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                          Porta RTSP:
                        </label>
                        <input
                          type="number"
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          placeholder="554"
                          className="cftv-input font-mono text-cyan-400"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                        Caminho do Stream (Path):
                      </label>
                      <input
                        type="text"
                        value={path}
                        onChange={(e) => setPath(e.target.value)}
                        placeholder="/live/ch0"
                        className="cftv-input font-mono text-zinc-400"
                      />
                    </div>
                    
                    <div className="p-2 bg-black/40 border border-white/5 rounded">
                       <span className="text-[10px] text-zinc-500 font-mono block mb-1">URL RTSP Gerada:</span>
                       <span className="text-[10px] text-cyan-600 font-mono break-all line-clamp-1 italic">{rtspUrl}</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="input-camera-url" className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                      URL RTSP do Stream (Completa):
                    </label>
                    <input
                      id="input-camera-url"
                      type="text"
                      value={rtspUrl}
                      onChange={(e) => setRtspUrl(e.target.value)}
                      placeholder="rtsp://usuario:senha@IP_DA_CAMERA:554/live/ch0"
                      required={showAdvanced}
                      className="cftv-input font-mono text-cyan-300"
                    />
                    <p className="text-[11px] text-zinc-500 font-sans">
                      Formato RFC padrão: <code className="text-cyan-400">rtsp://user:pass@host:port/path</code>
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="input-camera-location" className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                      Localização / Setor:
                    </label>
                    <input
                      id="input-camera-location"
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Ex: Portão Principal"
                      className="cftv-input font-sans"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="select-camera-resolution" className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                      Resolução Nativa:
                    </label>
                    <CustomSelect
                      id="select-camera-resolution"
                      value={resolution}
                      onChange={(val) => setResolution(val)}
                      options={[
                        { value: '1920x1080', label: '1080p FHD (1920x1080)' },
                        { value: '2560x1440', label: '2K QHD (2560x1440)' },
                        { value: '3840x2160', label: '4K UHD (3840x2160)' },
                        { value: '1280x720', label: '720p HD (1280x720)' },
                      ]}
                      ariaLabel="Selecionar resolução nativa"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="select-camera-transport" className="text-xs font-rajdhani font-bold text-zinc-300 tracking-wider uppercase">
                      Transporte RTSP:
                    </label>
                    <CustomSelect
                      id="select-camera-transport"
                      value={transport}
                      onChange={(val) => setTransport(val as 'tcp' | 'udp')}
                      options={[
                        { value: 'tcp', label: 'TCP (Confiável / Sem Perda)' },
                        { value: 'udp', label: 'UDP (Menor Latência)' },
                      ]}
                      ariaLabel="Selecionar transporte RTSP"
                    />
                  </div>

                  <div className="flex items-center">
                    <label className="w-full flex items-center gap-2 cursor-pointer p-2 bg-black/40 border border-white/10 hover:border-cyan-500/30 transition-colors">
                      <input
                        type="checkbox"
                        checked={ptzEnabled}
                        onChange={(e) => setPtzEnabled(e.target.checked)}
                        className="accent-cyan-400 w-4 h-4 cursor-pointer"
                      />
                      <span className="font-rajdhani font-semibold text-xs text-zinc-200">
                        Controle PTZ Ativo
                      </span>
                    </label>
                  </div>
                </div>

                <footer className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={onClose}
                    className="cftv-btn-outline"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="cftv-btn-prismatic"
                  >
                    Iniciar Transmissão
                  </button>
                </footer>
              </form>
            )}
          </main>
        </GlassCard>
      </div>
    </div>
  );
}
