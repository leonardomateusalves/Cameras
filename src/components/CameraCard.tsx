import { useEffect, useRef, useState } from 'react';
import { 
  Camera, Clock, Maximize2, Radio, Sliders, Volume2, VolumeX, ZoomIn,
  Plane, Satellite, Server, DoorClosed, Car, Bed, Sofa, Utensils, Home, Video,
  AlertTriangle
} from 'lucide-react';
import { CameraStream } from '../types';
import { GlassCard } from './GlassCard';

const getCameraIcon = (name: string, location: string) => {
  const str = `${name} ${location}`.toLowerCase();
  
  if (str.includes('drone') || str.includes('aéreo') || str.includes('patrulha')) return <Plane className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('satélite') || str.includes('espacial') || str.includes('orbital')) return <Satellite className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('data center') || str.includes('server') || str.includes('rack') || str.includes('ti') || str.includes('rede')) return <Server className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('portão') || str.includes('entrada') || str.includes('recepção')) return <DoorClosed className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('pátio') || str.includes('estacionamento') || str.includes('garagem')) return <Car className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('quarto') || str.includes('dormitório')) return <Bed className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('sala')) return <Sofa className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('cozinha')) return <Utensils className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  if (str.includes('casa') || str.includes('home')) return <Home className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
  
  return <Video className="w-5 h-5 text-cyan-400 flex-shrink-0" />;
};

interface CameraCardProps {
  key?: string;
  camera: CameraStream;
  isFocused: boolean;
  onFocusToggle: (id: string) => void;
  onSnapshot: (cam: CameraStream, dataUrl: string) => void;
  onOpenPtz?: (cam: CameraStream) => void;
  zoomLevel?: number;
}

export function CameraCard({
  camera,
  isFocused,
  onFocusToggle,
  onSnapshot,
  onOpenPtz,
  zoomLevel = 1
}: CameraCardProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [isMuted, setIsMuted] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [currentTimeStr, setCurrentTimeStr] = useState('');

  // Sincroniza o relógio digital no OSD
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Inicialização do WebRTC Real via Go2RTC
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setIsLoaded(false);
    setHasError(false);
    setErrorMessage('');

    const streamId = camera.streamId || `stream_${camera.id}`;
    // Tenta primeiro o proxy do Local Agent (/api/webrtc), depois direct Go2RTC (http://127.0.0.1:1984/api/webrtc)
    const go2rtcApiUrl = '/api/webrtc';

    let isMounted = true;

    async function initWebRTC() {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      pcRef.current = pc;

      try {
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch (e) {}

      pc.ontrack = (event) => {
        if (!isMounted) return;
        if (event.streams && event.streams[0]) {
          video.srcObject = event.streams[0];
          setIsLoaded(true);
          setHasError(false);
          video.play().catch(() => {});
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (!isMounted) return;
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setHasError(true);
          setErrorMessage('FALHA DE CONEXÃO WEBRTC (ICE)');
          setIsLoaded(false);
        }
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Aguarda a coleta de candidatos ICE locais (timeout de segurança 1.2s)
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') resolve();
          else {
            const checkState = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', checkState);
                resolve();
              }
            };
            pc.addEventListener('icegatheringstatechange', checkState);
            setTimeout(resolve, 1200);
          }
        });

        if (!isMounted) return;

        let answerSdp = '';
        if (window.electronAPI?.sendWebrtcSdp) {
          const sdpResult = await window.electronAPI.sendWebrtcSdp(streamId, pc.localDescription?.sdp || '');
          if (!sdpResult.success) {
            throw new Error(sdpResult.error || 'Erro na sinalização WebRTC via Electron');
          }
          answerSdp = sdpResult.sdp;
        } else {
          // Sinalização SDP com o Go2RTC (Web/Cloud Mode)
          const res = await fetch(`${go2rtcApiUrl}?src=${encodeURIComponent(streamId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: pc.localDescription?.sdp
          });

          if (!res.ok) {
            throw new Error(`Servidor Go2RTC respondeu com erro HTTP ${res.status}`);
          }

          answerSdp = await res.text();
        }

        if (!isMounted) return;

        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));
      } catch (err: any) {
        if (!isMounted) return;
        console.error(`[WebRTC Error - ${camera.name}]`, err);
        setHasError(true);
        setErrorMessage(err.message || 'ERRO DE SINALIZAÇÃO RTSP/WEBRTC');
      }
    }

    initWebRTC();

    return () => {
      isMounted = false;
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [camera.id, camera.streamId]);

  const handleCaptureSnapshot = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 22px "Rajdhani", monospace';
    ctx.fillStyle = '#00f3ff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 6;
    ctx.fillText(`${camera.name.toUpperCase()} // ${currentTimeStr}`, 24, canvas.height - 24);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
    onSnapshot(camera, dataUrl);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (video.requestFullscreen) {
      video.requestFullscreen().catch(() => {});
    }
  };

  return (
    <GlassCard
      id={`cftv-camera-${camera.id}`}
      isFocused={isFocused}
      data-nome={`Canal CFTV ${camera.name}`}
      className="!p-2 !gap-2"
    >
      <header className="flex items-center justify-between gap-4 px-2 py-1">
        <div className="flex items-center gap-3 min-w-0">
          {getCameraIcon(camera.name, camera.location)}
          <h1 className="text-[10px] sm:text-xs font-orbitron font-bold text-cyan-400 uppercase tracking-widest truncate">
            {camera.name}
          </h1>
        </div>
        <span className="text-[9px] sm:text-[10px] font-rajdhani font-bold text-zinc-400 uppercase tracking-widest flex-shrink-0">
          {camera.location}
        </span>
      </header>

      <figure 
        style={{
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)'
        }}
        className="group relative w-full aspect-video overflow-hidden flex items-center justify-center m-0 p-0 bg-black/80"
      >
        <video
          ref={videoRef}
          id={`cftv-video-feed-${camera.id}`}
          className="w-full h-full object-cover cursor-pointer block transition-transform duration-200"
          style={{ transform: `scale(${zoomLevel})` }}
          playsInline
          muted={isMuted}
          autoPlay
          onClick={() => onFocusToggle(camera.id)}
        />

        {(!isLoaded || hasError) && (
          <div className="absolute inset-0 bg-[#030712]/90 backdrop-blur-sm flex flex-col items-center justify-center p-4 text-center z-10 font-rajdhani">
            {hasError ? (
              <>
                <Radio className="w-8 h-8 text-rose-500 mb-2 animate-pulse" />
                <strong className="text-rose-400 font-bold text-sm tracking-wider uppercase">STREAM RTSP OFFLINE</strong>
                <p className="text-zinc-500 text-xs mt-1 max-w-[85%] truncate font-mono">
                  {errorMessage || camera.rtspUrlSafe || camera.rtspUrl}
                </p>
              </>
            ) : (
              <>
                <div className="w-7 h-7 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mb-2" />
                <strong className="text-cyan-400 font-bold text-sm tracking-wider uppercase">ESTABELECENDO WEBRTC (ICE)...</strong>
                <p className="text-zinc-500 text-xs mt-1 font-mono">Go2RTC Signal Handshake</p>
              </>
            )}
          </div>
        )}

        <figcaption className="absolute top-2.5 left-2.5 flex items-center gap-2 pointer-events-none z-10">
          <div className="cftv-osd-chip text-cyan-300">
            <span className={`w-1.5 h-1.5 rounded-full ${hasError ? 'bg-rose-500' : 'bg-emerald-400'} animate-pulse flex-shrink-0`} />
            <span>{hasError ? 'OFFLINE' : 'WEBRTC // LIVE'}</span>
          </div>
        </figcaption>

        <div className="absolute top-2.5 right-2.5 pointer-events-none z-10">
          <div className="cftv-osd-chip text-zinc-300">
            <Clock className="w-3 h-3 text-cyan-400 flex-shrink-0" />
            <span>{currentTimeStr}</span>
          </div>
        </div>

        <nav
          className="absolute bottom-0 inset-x-0 p-2.5 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex items-center justify-between z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          aria-label="Controles da câmera"
        >
          <div className="flex items-center gap-1.5">
            <button
              id={`btn-snap-${camera.id}`}
              onClick={handleCaptureSnapshot}
              title="Capturar Foto"
              className="cftv-btn-icon"
            >
              <Camera className="w-3.5 h-3.5 text-cyan-400" />
            </button>

            {camera.ptzEnabled && onOpenPtz && (
              <button
                id={`btn-ptz-${camera.id}`}
                onClick={() => onOpenPtz(camera)}
                title="Controles PTZ"
                className="cftv-btn-icon"
              >
                <Sliders className="w-3.5 h-3.5 text-purple-400" />
              </button>
            )}

            <button
              id={`btn-focus-${camera.id}`}
              onClick={() => onFocusToggle(camera.id)}
              title={isFocused ? 'Voltar para Grade' : 'Focar Câmera'}
              className="cftv-btn-icon"
            >
              <ZoomIn className="w-3.5 h-3.5 text-zinc-300" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              id={`btn-mute-${camera.id}`}
              onClick={() => setIsMuted(!isMuted)}
              title={isMuted ? 'Ativar Áudio' : 'Mutar Áudio'}
              className="cftv-btn-icon"
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5 text-zinc-400" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-400" />}
            </button>
            <button
              id={`btn-fullscreen-${camera.id}`}
              onClick={toggleFullscreen}
              title="Tela Cheia"
              className="cftv-btn-icon"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </nav>
      </figure>
    </GlassCard>
  );
}
