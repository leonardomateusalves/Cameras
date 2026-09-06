import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Server,
  Network,
  Search,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Terminal,
  ShieldCheck,
  Radio,
  Wifi,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Info,
  Cloud,
  Copy,
  Check,
  Crosshair,
  Cpu,
  Video,
  Router,
  Clock,
  X
} from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';
import { discoverCamerasFull } from '../../api/cameras';
import { CameraStream } from '../../types';
import { RadarTarget } from './MilitaryRadarScope';

export type { RadarTarget };

interface LogEntry {
  timestamp: string;
  prefix: string;
  message: string;
}

interface BootEnvironmentHudProps {
  cameras?: CameraStream[];
  bootState?: {
    agentStatus: string;
    networkStatus: string;
    discoveryStatus: string;
    logs: LogEntry[];
  };
  onRetryConnection?: () => void;
  isManualScanning?: boolean;
  isTimedOut?: boolean;
  addLog?: (prefix: string, message: string) => void;
}

// Utilitário para categorizar e normalizar os status textuais em estados táticos limpos
function parseBootState(status: string = '', defaultLabel: string = 'AGUARDANDO...') {
  const upper = status.toUpperCase();
  let state: 'online' | 'scanning' | 'pending' | 'warning' | 'offline' = 'pending';

  if (
    upper.includes('🟢') ||
    upper.includes('ONLINE') ||
    upper.includes('PRONTO') ||
    upper.includes('READY') ||
    upper.includes('OK')
  ) {
    state = 'online';
  } else if (
    upper.includes('🔍') ||
    upper.includes('ESCANEANDO') ||
    upper.includes('ANALISANDO') ||
    upper.includes('BUSCANDO')
  ) {
    state = 'scanning';
  } else if (
    upper.includes('🔴') ||
    upper.includes('OFFLINE') ||
    upper.includes('BLOQUEADO') ||
    upper.includes('FALHA') ||
    upper.includes('ERRO')
  ) {
    state = 'offline';
  } else if (
    upper.includes('🟡') ||
    upper.includes('INICIANDO') ||
    upper.includes('DETECTANDO') ||
    upper.includes('AGUARDANDO') ||
    upper.includes('VINCULANDO')
  ) {
    state = 'pending';
  }

  const cleanText = status
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '')
    .trim() || defaultLabel;

  return { state, text: cleanText };
}

export function BootEnvironmentHud({
  cameras = [],
  bootState,
  onRetryConnection,
  isManualScanning: propIsManualScanning,
  isTimedOut: propIsTimedOut,
  addLog
}: BootEnvironmentHudProps) {
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Estados de telemetria angular e intensidade dos cards
  const [azimuthDeg, setAzimuthDeg] = useState(0);
  const [cardIntensities, setCardIntensities] = useState<[number, number, number]>([0, 0, 0]);

  // Temporizador de etapas (Timeout de 15 segundos) - se não vier via props, mantém local para o radar
  const SCAN_TIMEOUT_SECONDS = 15;
  const [timeRemaining, setTimeRemaining] = useState(SCAN_TIMEOUT_SECONDS);
  const [localIsTimedOut, setLocalIsTimedOut] = useState(false);
  const [isScanning, setIsScanning] = useState(true);

  // Efeito para registrar log de timeout quando o tempo esgota
  useEffect(() => {
    if (localIsTimedOut && addLog) {
      addLog('SCANNER', 'VARREDURA INTERROMPIDA: O tempo limite de 15 segundos foi atingido sem detectar novas câmeras. Verifique a conectividade física e o Firewall.');
    }
  }, [localIsTimedOut, addLog]);

  // Log quando câmeras são detectadas
  useEffect(() => {
    if (cameras.length > 0 && addLog) {
      addLog('SCANNER', `${cameras.length} DISPOSITIVO(S) IDENTIFICADO(S). Sincronizando feeds...`);
    }
  }, [cameras.length, addLog]);

  const isTimedOut = propIsManualScanning ? false : (propIsTimedOut || localIsTimedOut);
  const isWorking = (isScanning || propIsManualScanning) && !isTimedOut;

  // Refs para valores de estado usados dentro do loop de animação para evitar stale closures
  const isWorkingRef = useRef(isWorking);
  const isTimedOutRef = useRef(isTimedOut);

  useEffect(() => {
    isWorkingRef.current = isWorking;
    isTimedOutRef.current = isTimedOut;
  }, [isWorking, isTimedOut]);

  // Sincroniza estado local com props externas (quando o usuário clica em Reescanear no App.tsx ou tenta novamente)
  useEffect(() => {
    if (propIsManualScanning || !propIsTimedOut) {
      setLocalIsTimedOut(false);
      setIsScanning(true);
      setTimeRemaining(SCAN_TIMEOUT_SECONDS);
    }
  }, [propIsManualScanning, propIsTimedOut]);

  // Refs para controle do Canvas unificado
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animFrameIdRef = useRef<number>(0);
  const manualPingsRef = useRef<{ x: number; y: number; startTime: number }[]>([]);

  const rawAgent = parseBootState(bootState?.agentStatus, 'INICIANDO...');
  const rawNetwork = parseBootState(bootState?.networkStatus, 'DETECTANDO...');
  const rawDiscovery = parseBootState(bootState?.discoveryStatus, 'AGUARDANDO REDE...');

  const isAgentActuallyOnline = rawAgent.state === 'online';

  // Se atingiu o tempo limite, as etapas em andamento entram em estado de FALHA
  const agent = isTimedOut && !isAgentActuallyOnline
    ? { state: 'offline' as const, text: 'NÃO DETECTADO' } 
    : isScanning && !isAgentActuallyOnline
    ? { state: 'scanning' as const, text: 'SONDANDO AGENTE...' }
    : rawAgent;

  const network = isTimedOut && rawNetwork.state !== 'online' 
    ? { state: 'offline' as const, text: 'OFFLINE' } 
    : isScanning && rawNetwork.state !== 'online'
    ? { state: 'scanning' as const, text: 'MAPEANDO ADAPTADORES...' }
    : rawNetwork;

  const discovery = isTimedOut && cameras.length === 0
    ? { state: 'offline' as const, text: 'FALHA (0 CÂMERAS)' } 
    : isScanning && cameras.length === 0
    ? { state: 'scanning' as const, text: 'WS-DISCOVERY (UDP 3702)...' }
    : rawDiscovery;


  // Contador regressivo de 15 segundos para as etapas
  useEffect(() => {
    if (isTimedOut || !isScanning) return;

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setLocalIsTimedOut(true);
          setIsScanning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isScanning, isTimedOut]);

  // ==========================================================================
  // DISPOSITIVOS REAIS DETECTADOS PARA O SONAR E PARA O KPI CARD
  // Mapeia o Gateway LAN e todas as câmeras / nós de sondagem identificados
  // ==========================================================================
  const realSonarTargets = useMemo<RadarTarget[]>(() => {
    const targets: RadarTarget[] = [];

    // 1. Câmeras reais cadastradas
    if (cameras.length > 0) {
      cameras.forEach((cam, idx) => {
        const angleDeg = (45 + (idx * 360) / Math.max(cameras.length, 1)) % 360;
        const radius = 0.52 + ((idx * 37) % 32) / 100;
        const extractedIp = cam.ip || (cam.rtspUrl ? cam.rtspUrl.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)?.[0] : undefined) || '192.168.1.108';
        
        targets.push({
          id: cam.name ? cam.name.slice(0, 10).toUpperCase() : `CAM-${String(idx + 1).padStart(2, '0')}`,
          label: cam.name || `CÂMERA RTSP ${idx + 1}`,
          radius,
          angle: (angleDeg * Math.PI) / 180,
          size: 3.8,
          lastPingTime: 0,
          signalStrength: 0.95,
          type: 'camera',
          ip: extractedIp
        });
      });
      return targets;
    }

    // Se está em timeout ou agente não detectado: não injeta alvos fictícios
    if (isTimedOut || (!isScanning && !isAgentActuallyOnline)) {
      return [];
    }

    // 2. Durante varredura ativa com Agente Online
    const onvifLogs = bootState?.logs?.filter(l => l.prefix === 'ONVIF' && (l.message.includes('FOUND') || l.message.includes('192.168.'))) || [];
    const seenIps = new Set<string>();
    
    onvifLogs.forEach((l, idx) => {
      const ipMatch = l.message.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      const ip = ipMatch ? ipMatch[0] : `192.168.1.${100 + idx}`;
      if (!seenIps.has(ip)) {
        seenIps.add(ip);
        const angleDeg = (40 + seenIps.size * 70) % 360;
        targets.push({
          id: `CAM-0${seenIps.size}`,
          label: 'DISPOSITIVO ONVIF',
          radius: 0.58 + (seenIps.size % 3) * 0.10,
          angle: (angleDeg * Math.PI) / 180,
          size: 3.6,
          lastPingTime: 0,
          signalStrength: 0.9,
          type: 'camera',
          ip
        });
      }
    });

    if (isWorking && isAgentActuallyOnline) {
      const gwIp = bootState?.networkStatus?.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)?.[0] || '192.168.1.1';
      targets.unshift({
        id: 'GW-01',
        label: 'GATEWAY LAN',
        radius: 0.38,
        angle: (282 * Math.PI) / 180,
        size: 4.0,
        lastPingTime: 0,
        signalStrength: 1.0,
        type: 'gateway',
        ip: gwIp
      });
    }

    return targets;
  }, [cameras, isTimedOut, isScanning, isAgentActuallyOnline, isWorking, bootState?.networkStatus, bootState?.logs]);

  const targetsRef = useRef<RadarTarget[]>(realSonarTargets);
  useEffect(() => {
    targetsRef.current = realSonarTargets.map(t => ({
      ...t,
      lastPingTime: targetsRef.current.find(prev => prev.id === t.id)?.lastPingTime || 0
    }));
  }, [realSonarTargets]);

  // ==========================================================================
  // RENDERIZADOR CANVAS UNIFICADO E SUAVE (SEM PONTOS BRUTOS SOBRE OS CARDS)
  // ==========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = container.clientWidth || 720;
    let height = container.clientHeight || 480;

    const updateCanvasSize = () => {
      if (!container || !canvas) return;
      width = container.clientWidth || 720;
      height = container.clientHeight || 480;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.resetTransform?.();
      ctx.scale(dpr, dpr);
    };

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    resizeObserver.observe(container);

    const sweepDuration = 4000; // Ciclo de 4 segundos
    let lastTime = performance.now();
    let sweepAngle = 0;
    let lastHudUpdateTime = 0;

    const render = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      if (isWorkingRef.current && !isTimedOutRef.current) {
        sweepAngle = (sweepAngle + (delta / sweepDuration) * Math.PI * 2) % (Math.PI * 2);
      }

      const deg = ((sweepAngle * 180) / Math.PI) % 360;

      // Geometria do Sonar
      const radarCenterX = width / 2;
      const radarCenterY = Math.min(125, height * 0.28);
      const radarRadius = Math.min(110, width * 0.22);

      // Intensidades para feedback nos cards enquanto o feixe passa diretamente por cima
      const intensities: [number, number, number] = [0, 0, 0];
      if (isWorkingRef.current && !isTimedOutRef.current) {
        // Card 1 (Esquerda - ~225°)
        const diff1 = Math.abs(deg - 225);
        if (diff1 <= 22) {
          intensities[0] = Math.cos((diff1 / 22) * (Math.PI / 2));
        }

        // Card 2 (Centro - 180°)
        const diff2 = Math.abs(deg - 180);
        if (diff2 <= 20) {
          intensities[1] = Math.cos((diff2 / 20) * (Math.PI / 2));
        }

        // Card 3 (Direita - ~135°)
        const diff3 = Math.abs(deg - 135);
        if (diff3 <= 22) {
          intensities[2] = Math.cos((diff3 / 22) * (Math.PI / 2));
        }
      }

      if (now - lastHudUpdateTime > 20) {
        lastHudUpdateTime = now;
        setAzimuthDeg(isTimedOutRef.current ? 0 : Math.round(deg));
        setCardIntensities(intensities);
      }

      ctx.clearRect(0, 0, width, height);

      // Definição de paleta dinâmica: Ciano em varredura, Rose/Vermelho em Falha/Timeout
      const themeRose = isTimedOutRef.current;
      const primaryColorAlpha = themeRose ? 'rgba(244, 63, 94, ' : 'rgba(0, 240, 255, ';
      const secondaryColorAlpha = themeRose ? 'rgba(225, 29, 72, ' : 'rgba(0, 220, 255, ';
      const mainHex = themeRose ? '#f43f5e' : '#00f3ff';

      // 1. Resplendor e grade do sonar (sem bordas duras)
      const bgGrad = ctx.createRadialGradient(
        radarCenterX, radarCenterY, 0,
        radarCenterX, radarCenterY, radarRadius
      );
      if (themeRose) {
        bgGrad.addColorStop(0, 'rgba(244, 63, 94, 0.16)');
        bgGrad.addColorStop(0.35, 'rgba(60, 10, 25, 0.35)');
        bgGrad.addColorStop(0.70, 'rgba(30, 5, 12, 0.15)');
        bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        bgGrad.addColorStop(0, 'rgba(0, 240, 255, 0.12)');
        bgGrad.addColorStop(0.35, 'rgba(2, 35, 58, 0.25)');
        bgGrad.addColorStop(0.70, 'rgba(1, 18, 32, 0.10)');
        bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }

      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(radarCenterX, radarCenterY, radarRadius, 0, Math.PI * 2);
      ctx.fill();

      // Grade suave
      ctx.save();
      const gridSize = 16;
      for (let x = radarCenterX - radarRadius; x <= radarCenterX + radarRadius; x += gridSize) {
        const dx = Math.abs(x - radarCenterX);
        if (dx >= radarRadius) continue;
        const lineHalfH = Math.sqrt(radarRadius * radarRadius - dx * dx);
        const centerAlpha = Math.max(0, 1 - (dx / radarRadius) * 1.1) * (themeRose ? 0.22 : 0.16);
        
        const lineGrad = ctx.createLinearGradient(x, radarCenterY - lineHalfH, x, radarCenterY + lineHalfH);
        lineGrad.addColorStop(0, `${secondaryColorAlpha}0)`);
        lineGrad.addColorStop(0.5, `${secondaryColorAlpha}${centerAlpha})`);
        lineGrad.addColorStop(1, `${secondaryColorAlpha}0)`);

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(x, radarCenterY - lineHalfH);
        ctx.lineTo(x, radarCenterY + lineHalfH);
        ctx.stroke();
      }

      for (let y = radarCenterY - radarRadius; y <= radarCenterY + radarRadius; y += gridSize) {
        const dy = Math.abs(y - radarCenterY);
        if (dy >= radarRadius) continue;
        const lineHalfW = Math.sqrt(radarRadius * radarRadius - dy * dy);
        const centerAlpha = Math.max(0, 1 - (dy / radarRadius) * 1.1) * (themeRose ? 0.22 : 0.16);

        const lineGrad = ctx.createLinearGradient(radarCenterX - lineHalfW, y, radarCenterX + lineHalfW, y);
        lineGrad.addColorStop(0, `${secondaryColorAlpha}0)`);
        lineGrad.addColorStop(0.5, `${secondaryColorAlpha}${centerAlpha})`);
        lineGrad.addColorStop(1, `${secondaryColorAlpha}0)`);

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(radarCenterX - lineHalfW, y);
        ctx.lineTo(radarCenterX + lineHalfW, y);
        ctx.stroke();
      }
      ctx.restore();

      // Anéis de alcance
      const rings = [
        { ratio: 0.30, alpha: themeRose ? 0.85 : 0.80, lineWidth: 1.0, dash: [] },
        { ratio: 0.60, alpha: themeRose ? 0.65 : 0.55, lineWidth: 0.9, dash: [2, 3] },
        { ratio: 0.90, alpha: themeRose ? 0.75 : 0.65, lineWidth: 1.0, dash: [] },
      ];

      rings.forEach(({ ratio, alpha, lineWidth, dash }) => {
        const r = radarRadius * ratio;
        ctx.save();
        if (dash.length > 0) ctx.setLineDash(dash);
        ctx.strokeStyle = `${primaryColorAlpha}${alpha})`;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.arc(radarCenterX, radarCenterY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });

      // Eixos azimutais
      ctx.save();
      const mainAxes = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      mainAxes.forEach(angle => {
        const x2 = radarCenterX + Math.sin(angle) * (radarRadius * 0.95);
        const y2 = radarCenterY - Math.cos(angle) * (radarRadius * 0.95);
        const lineGrad = ctx.createLinearGradient(radarCenterX, radarCenterY, x2, y2);
        lineGrad.addColorStop(0, `${primaryColorAlpha}0.85)`);
        lineGrad.addColorStop(0.75, `${secondaryColorAlpha}0.4)`);
        lineGrad.addColorStop(1, `${secondaryColorAlpha}0)`);

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(radarCenterX, radarCenterY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });
      ctx.restore();

      // 2. Alvos táteis no radar (com fade suave de eco)
      const currentTargets = targetsRef.current;
      if (currentTargets.length > 0) {
        currentTargets.forEach(target => {
          const targetRadiusPx = radarRadius * target.radius;
          const tx = radarCenterX + Math.sin(target.angle) * targetRadiusPx;
          const ty = radarCenterY - Math.cos(target.angle) * targetRadiusPx;

          const angleDiff = (sweepAngle - target.angle + Math.PI * 2) % (Math.PI * 2);
          if (angleDiff < 0.15 && isWorking && !isTimedOut) {
            target.lastPingTime = now;
          }

          const elapsedSincePing = now - target.lastPingTime;
          const decayDuration = 2000;
          let phosphorIntensity = 0.35;
          if (target.lastPingTime > 0 && elapsedSincePing < decayDuration && isWorking && !isTimedOut) {
            const progress = elapsedSincePing / decayDuration;
            phosphorIntensity = Math.max(0.35, Math.exp(-progress * 2.8));
          }

          ctx.save();

          // 1. Eco de varredura expansivo
          if (phosphorIntensity > 0.65 && !themeRose) {
            const ringPulse = ((decayDuration - elapsedSincePing) / decayDuration) * 16;
            ctx.beginPath();
            ctx.arc(tx, ty, target.size + ringPulse, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 243, 255, ${phosphorIntensity * 0.75})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }

          // 2. Silhueta tática do alvo conforme o tipo
          if (target.type === 'gateway') {
            // Silhueta de Gateway: Diamante tático
            const dSize = target.size * 1.5;
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.rect(-dSize, -dSize, dSize * 2, dSize * 2);
            ctx.fillStyle = themeRose ? 'rgba(244, 63, 94, 0.25)' : `rgba(0, 220, 255, ${phosphorIntensity * 0.35})`;
            ctx.fill();
            ctx.strokeStyle = themeRose ? '#fb7185' : phosphorIntensity > 0.65 ? '#ffffff' : `rgba(0, 245, 255, ${Math.min(1, phosphorIntensity * 1.5)})`;
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.restore();

            // Ponto central do Gateway
            ctx.beginPath();
            ctx.arc(tx, ty, target.size * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = themeRose ? '#f43f5e' : phosphorIntensity > 0.65 ? '#ffffff' : '#00f3ff';
            ctx.fill();
          } else {
            // Silhueta de Câmera/Alvo: Círculo com mira óptica
            ctx.beginPath();
            ctx.arc(tx, ty, target.size * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = themeRose ? 'rgba(244, 63, 94, 0.20)' : `rgba(0, 210, 255, ${phosphorIntensity * 0.30})`;
            ctx.fill();

            // Anel externo
            ctx.beginPath();
            ctx.arc(tx, ty, target.size * 1.5, 0, Math.PI * 2);
            ctx.strokeStyle = themeRose ? '#fb7185' : phosphorIntensity > 0.65 ? '#ffffff' : `rgba(0, 245, 255, ${Math.min(1, phosphorIntensity * 1.3)})`;
            ctx.lineWidth = 1.1;
            ctx.stroke();

            // Ponto central
            ctx.beginPath();
            ctx.arc(tx, ty, target.size * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = themeRose ? '#f43f5e' : phosphorIntensity > 0.65 ? '#ffffff' : '#00f3ff';
            ctx.fill();
          }

          // 3. Rótulo militar do alvo
          ctx.font = '700 8.5px Orbitron, monospace';
          ctx.fillStyle = themeRose ? '#fda4af' : phosphorIntensity > 0.75 ? '#ffffff' : `rgba(0, 243, 255, ${Math.max(0.6, phosphorIntensity)})`;
          ctx.fillText(target.id, tx + 8, ty - 3);

          ctx.restore();
        });
      }

      // 3. Feixe rotativo limpo e fluido (ativo apenas durante varredura)
      if (isWorking && !isTimedOut) {
        const isPointingDownwards = deg >= 85 && deg <= 275;
        const downFactor = isPointingDownwards ? Math.max(0, -Math.cos(sweepAngle)) : 0;
        
        // Alcance suave que ilumina a área sem invadir bruscamente o texto
        const maxDownReach = height - radarCenterY - 20;
        const currentRayLength = radarRadius + (maxDownReach - radarRadius) * Math.pow(downFactor, 0.55);

        ctx.save();
        ctx.translate(radarCenterX, radarCenterY);
        ctx.rotate(sweepAngle);

        // Cone de cauda fosfórica
        const trailAngle = Math.PI * 0.25;
        const steps = 18;
        for (let i = 0; i < steps; i++) {
          const stepFrac = i / steps;
          const aStart = -trailAngle * (1 - stepFrac);
          const aEnd = -trailAngle * (1 - (stepFrac + 1 / steps));

          const sliceAngle = sweepAngle + aStart;
          const sliceDeg = ((sliceAngle * 180) / Math.PI + 360) % 360;
          const sliceDownFactor = (sliceDeg >= 85 && sliceDeg <= 275) ? Math.max(0, -Math.cos(sliceAngle)) : 0;
          const sliceRadius = radarRadius + (maxDownReach - radarRadius) * Math.pow(sliceDownFactor, 0.55);

          const coneGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, sliceRadius);
          const baseAlpha = Math.pow(stepFrac, 2.0) * (isPointingDownwards ? 0.30 : 0.45);
          coneGrad.addColorStop(0, `rgba(0, 245, 255, ${baseAlpha * 1.1})`);
          coneGrad.addColorStop(0.5, `rgba(0, 220, 255, ${baseAlpha * 0.7})`);
          coneGrad.addColorStop(0.85, `rgba(0, 190, 255, ${baseAlpha * 0.25})`);
          coneGrad.addColorStop(1, 'rgba(0, 160, 255, 0)');

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, sliceRadius, aStart - Math.PI / 2, aEnd - Math.PI / 2);
          ctx.closePath();
          ctx.fillStyle = coneGrad;
          ctx.fill();
        }

        // Raio laser com gradiente suave nas pontas
        const rayGrad = ctx.createLinearGradient(0, 0, 0, -currentRayLength);
        rayGrad.addColorStop(0, '#ffffff');
        rayGrad.addColorStop(0.40, '#ffffff');
        rayGrad.addColorStop(0.75, 'rgba(0, 245, 255, 0.85)');
        rayGrad.addColorStop(0.95, 'rgba(0, 245, 255, 0.2)');
        rayGrad.addColorStop(1, 'rgba(0, 245, 255, 0)');

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -currentRayLength);
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.4)';
        ctx.lineWidth = isPointingDownwards ? 4.0 : 3.0;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -currentRayLength);
        ctx.strokeStyle = rayGrad;
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.restore();
      }

      // 4. Hub Central do Sonar
      const hubGlow = ctx.createRadialGradient(
        radarCenterX, radarCenterY, 0,
        radarCenterX, radarCenterY, 16
      );
      hubGlow.addColorStop(0, '#ffffff');
      hubGlow.addColorStop(0.3, mainHex);
      hubGlow.addColorStop(0.7, themeRose ? 'rgba(244, 63, 94, 0.3)' : 'rgba(2, 132, 199, 0.3)');
      hubGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = hubGlow;
      ctx.beginPath();
      ctx.arc(radarCenterX, radarCenterY, 16, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(radarCenterX, radarCenterY, 3, 0, Math.PI * 2);
      ctx.fill();

      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameIdRef.current);
      resizeObserver.disconnect();
    };
  }, [isWorking, isTimedOut]);

  // Clique no HUD
  const handleHudClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (y < 0.45) {
      manualPingsRef.current.push({ x, y, startTime: performance.now() });
    }
  }, []);

  // Ações - Gerenciado pelo FAB Global em App.tsx

  // 3 Etapas táticas
  const phases = [
    {
      step: '01',
      id: 'agent',
      label: 'Agente Windows Local',
      sublabel:
        agent.state === 'online'
          ? 'Núcleo em background e canal WebSocket ativos'
          : isTimedOut
          ? 'Tempo limite esgotado (15s). Agente Windows não detectado na porta 8080.'
          : isScanning
          ? 'Sondando runtime de serviços e IPC local (127.0.0.1:8080)...'
          : 'Software Nexus Agent não detectado no Windows.',
      status: agent,
      icon: Server,
      active: true,
      cardIndex: 0
    },
    {
      step: '02',
      id: 'network',
      label: 'Interface & Sub-rede',
      sublabel:
        network.state === 'online'
          ? 'Adaptador IPv4 e rotas LAN identificados'
          : isTimedOut
          ? 'Tempo esgotado. Interface física sem resposta (Requer Agente Local).'
          : isScanning
          ? 'Mapeando adaptadores IPv4 e gateways ativos...'
          : 'Ambiente de nuvem / sandbox (sem placa LAN física)',
      status: network,
      icon: Network,
      active: agent.state === 'online',
      cardIndex: 1
    },
    {
      step: '03',
      id: 'discovery',
      label: 'Sondagem ONVIF & RTSP',
      sublabel:
        isTimedOut
          ? 'Tempo limite esgotado (15s). Nenhuma câmera detectada. Clique em Reescanear.'
          : discovery.state === 'scanning'
          ? 'Emitindo sondagens WS-Discovery (UDP 3702) na LAN...'
          : discovery.state === 'online'
          ? 'Varredura concluída, portas 554/8554 mapeadas'
          : discovery.state === 'offline'
          ? 'Sondagem multicast pausada (aguardando LAN)'
          : 'Aguardando confirmação de rota de rede...',
      status: discovery,
      icon: Search,
      active: network.state === 'online',
      cardIndex: 2
    }
  ];

  const targetCount = realSonarTargets.length;

  return (
    <main id="cftv-main-viewport" className="cftv-main-viewport flex flex-col items-center justify-center flex-1 min-h-[82vh] p-4 sm:p-6 my-auto">
      <GlassCard 
        status={isTimedOut ? 'timedOut' : 'normal'}
        className="max-w-3xl w-full !p-6 sm:!p-8 flex flex-col items-center font-rajdhani my-auto overflow-hidden relative backdrop-blur-2xl transition-all"
      >
        
        {/* Título Compacto do HUD */}
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2 mb-0.5 pt-1 text-center flex-wrap"
        >
          <span className={`w-2 h-2 rounded-full ${
            isTimedOut 
              ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]' 
              : isWorking 
              ? 'bg-cyan-400 animate-ping' 
              : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
          }`} />
          <h2 className={`text-base sm:text-lg font-orbitron font-bold tracking-wider uppercase drop-shadow-[0_0_12px_rgba(0,243,255,0.3)] ${
            isTimedOut ? 'text-rose-400 drop-shadow-[0_0_12px_rgba(244,63,94,0.4)]' : 'text-zinc-100'
          }`}>
            {isTimedOut 
              ? 'Varredura Interrompida (Tempo Esgotado)' 
              : isWorking 
              ? 'Identificando Ambiente' 
              : 'Monitoramento em Espera'}
          </h2>
        </motion.div>

        {/* ================================================================== */}
        {/* CONTAINER UNIFICADO: RADAR + CARDS LIMPOS                         */}
        {/* ================================================================== */}
        <div 
          ref={containerRef}
          onClick={handleHudClick}
          className="relative w-full min-h-[390px] flex flex-col justify-between items-center rounded-2xl overflow-hidden my-1 select-none"
        >
          {/* CANVAS UNIFICADO (FEIXE LASER PASSANDO POR CIMA DOS CARDS) */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full pointer-events-none z-30 block opacity-95"
          />

          {/* ÁREA DO RADAR SUPERIOR */}
          <div className="relative z-10 w-full flex flex-col items-center pt-1">
            <div className="w-52 h-52 sm:w-60 sm:h-60 flex items-center justify-center pointer-events-none" />
          </div>

          {/* GRID DOS 3 CARDS DE ETAPA (REATIVOS AO FEIXE DE VARREDURA) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 w-full mb-2 relative z-20">
            {phases.map((p, idx) => {
              const Icon = p.icon;
              const { state, text } = p.status;
              const isUpdating = (cardIntensities[idx] || 0) > 0.05;

              let dotColor = 'bg-rose-400';
              let valueColor = 'text-rose-400';
              let iconColor = 'text-rose-400';
              let barColor = 'bg-rose-500/50';

              if (state === 'online') {
                dotColor = 'bg-emerald-400';
                valueColor = 'text-emerald-400';
                iconColor = 'text-emerald-400';
                barColor = 'bg-emerald-400';
              } else if (state === 'scanning') {
                dotColor = 'bg-cyan-400 animate-ping';
                valueColor = 'text-cyan-300';
                iconColor = 'text-cyan-400 animate-pulse';
                barColor = 'bg-cyan-400 animate-pulse';
              } else if (state === 'pending') {
                dotColor = 'bg-amber-400 animate-pulse';
                valueColor = 'text-amber-300';
                iconColor = 'text-amber-400';
                barColor = 'bg-amber-400';
              }

              return (
                <GlassCard
                  key={p.id}
                  hoverEffect={true}
                  className="!p-4 min-h-[148px] flex flex-col justify-between group cursor-default relative overflow-hidden backdrop-blur-md border border-zinc-800/80 bg-black/50"
                >
                  {isUpdating ? (
                    <div className="flex-1 flex flex-col items-center justify-center py-6">
                      <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin drop-shadow-[0_0_12px_rgba(0,243,255,0.4)]" />
                    </div>
                  ) : (
                    <>
                      {/* Cabeçalho do Card */}
                      <div className="flex items-center justify-between mb-2 relative z-10">
                        <span className="font-mono text-[10px] font-bold tracking-wider text-zinc-400">
                          ETAPA {p.step} // {p.id === 'agent' ? 'AGENTE' : p.id === 'network' ? 'SUB-REDE' : 'VARREDURA'}
                        </span>
                        <div className="flex items-center gap-1.5 px-2 py-0.5 min-h-[22px] rounded border border-white/5 bg-black/40 text-[10px] font-mono">
                          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                          <span className="text-zinc-300 text-[9px] uppercase font-semibold">{state}</span>
                        </div>
                      </div>

                      {/* Centro do Card (Ícone SVG sem bordas e sem fundo) */}
                      <div className="flex items-center gap-3 my-2 relative z-10">
                        <Icon className={`w-5 h-5 shrink-0 ${iconColor}`} />
                        <div className="flex flex-col min-w-0">
                          <span className="text-[11px] font-orbitron font-bold text-zinc-200 uppercase tracking-wide truncate">
                            {p.label}
                          </span>
                          <span className={`text-sm sm:text-base font-orbitron font-bold uppercase tracking-wider truncate ${valueColor}`}>
                            {text}
                          </span>
                        </div>
                      </div>

                      {/* Rodapé do Card */}
                      <div className="mt-2.5 pt-2.5 border-t border-zinc-800/60 flex flex-col gap-1.5 relative z-10">
                        <div className="w-full bg-zinc-900/80 rounded-full h-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: state === 'online' ? '100%' : state === 'scanning' ? '70%' : '35%' }}
                          />
                        </div>
                        <span className="text-[10px] font-sans truncate leading-tight text-zinc-400">
                          {p.sublabel}
                        </span>
                      </div>
                    </>
                  )}
                </GlassCard>
              );
            })}
          </div>
        </div>

        {/* ================================================================== */}
        {/* KPI CARD: TELEMETRIA & ALVOS DETECTADOS COM INFORMAÇÕES DE PROTOCOLO */}
        {/* ================================================================== */}
        <div className="w-full mb-4">
          <GlassCard hoverEffect={true}>
            <div className="flex flex-col gap-3 pb-3 border-b border-white/10">
              {/* Linha Principal: Título, Protocolo e Telemetria com Wrap Limpo */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Lado Esquerdo: Ícone + Título */}
                <div className="flex items-center gap-2.5 flex-wrap">
                  <Crosshair className="w-5 h-5 text-cyan-400 shrink-0 drop-shadow-[0_0_8px_rgba(0,243,255,0.4)]" />
                  <h3 className="text-sm font-orbitron font-bold text-zinc-100 uppercase tracking-wider">
                    Alvos Detectados na Sub-rede
                  </h3>
                </div>

                {/* Lado Direito: Badges de Telemetria Organizados */}
                <div className="flex items-center gap-2 font-mono text-[10px] flex-wrap">
                  {/* Temporizador de Varredura */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-orbitron font-bold ${
                    isTimedOut
                      ? 'bg-rose-950/80 border-rose-500/50 text-rose-300'
                      : isWorking
                      ? 'bg-black/60 border-cyan-500/30 text-cyan-300'
                      : 'bg-black/60 border-white/10 text-zinc-400'
                  }`}>
                    <Clock className={`w-3 h-3 ${isTimedOut ? 'text-rose-400' : 'text-cyan-400'}`} />
                    <span>{isTimedOut ? '00s (FALHA)' : `${String(timeRemaining).padStart(2, '0')}s`}</span>
                  </div>

                  {/* Azimute */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/60 border ${
                    isTimedOut 
                      ? 'border-rose-500/30 text-rose-400' 
                      : 'border-cyan-500/30 text-cyan-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      isTimedOut 
                        ? 'bg-rose-500' 
                        : 'bg-cyan-400 animate-ping'
                    }`} />
                    <span className="font-orbitron font-bold">AZ: {isTimedOut ? '---' : `${String(azimuthDeg).padStart(3, '0')}°`}</span>
                  </div>

                  <div className={`flex items-center gap-1 px-2.5 py-1 rounded border font-orbitron font-semibold ${
                    isTimedOut
                      ? 'bg-rose-950/70 border-rose-500/50 text-rose-300'
                      : isWorking
                      ? 'bg-cyan-950/60 border-cyan-500/50 text-cyan-200'
                      : 'bg-black/60 border-white/10 text-zinc-300'
                  }`}>
                    <span className={isTimedOut ? 'text-rose-300' : isWorking ? 'text-cyan-300 animate-pulse' : 'text-zinc-400'}>
                      {isTimedOut ? 'TEMPO ESGOTADO' : isWorking ? 'VARREDURA ATIVA' : 'STANDBY'}
                    </span>
                  </div>

                  {/* Total de Alvos */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border font-orbitron font-bold ${
                    isTimedOut
                      ? 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                      : 'bg-cyan-950/70 border-cyan-400/50 text-cyan-300'
                  }`}>
                    <span>{String(targetCount).padStart(2, '0')} {targetCount === 1 ? 'ALVO' : 'ALVOS'}</span>
                  </div>
                </div>
              </div>

              {/* Linha Secundária: Descrição e Portas de Rede */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
                <p className="text-[11px] font-mono text-zinc-400 leading-normal">
                  {isTimedOut
                    ? 'Varredura finalizada por tempo limite (15s). O sonar foi pausado para economizar recursos. Clique em Reescanear Rede para disparar novo ciclo.'
                    : isWorking
                    ? 'Mapeando broker local, detectando interfaces de rede IPv4 e sondando streams RTSP na LAN.'
                    : 'Nenhuma câmera ativa identificada na sub-rede. Aguardando sondagem de rede.'}
                </p>
                <span className="text-[9px] font-mono tracking-wider text-zinc-400 bg-black/40 border border-white/10 px-2 py-0.5 rounded">
                  PORT: 3702/UDP • RTSP: 554/8554
                </span>
              </div>
            </div>

            {/* Lista de dispositivos identificados (cada um como GlassCard) */}
            {realSonarTargets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono text-xs">
                {realSonarTargets.map((target) => (
                  <GlassCard
                    key={target.id}
                    hoverEffect={true}
                    className="!p-3 !flex-row !items-center !justify-between !gap-2"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {target.type === 'gateway' ? (
                        <Router className="w-5 h-5 text-cyan-400 shrink-0" />
                      ) : (
                        <Video className="w-5 h-5 text-emerald-400 shrink-0" />
                      )}
                      <div className="flex flex-col min-w-0">
                        <span className="text-zinc-100 font-bold tracking-wide truncate">
                          {target.label}
                        </span>
                        <span className="text-[10px] text-zinc-400 truncate">
                          IP: {target.ip || 'LAN DYNAMIC'} • ID: {target.id}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/50 border border-emerald-500/40 text-[9px] font-bold shrink-0 ml-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-emerald-300 font-orbitron">MAPEADO</span>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-4 py-8 px-4 rounded-lg bg-black/20 border border-dashed border-white/10 text-center">
                <span className="text-xs font-mono text-zinc-400 max-w-md">
                  {isTimedOut
                    ? 'NENHUM DISPOSITIVO RESPONDEU NO TEMPO LIMITE DE 15s. VERIFIQUE SE AS CÂMERAS ESTÃO NA MESMA SUB-REDE E POSSUEM PROTOCOLO ONVIF ATIVO.'
                    : 'AGUARDANDO SONDAGEM DE REDE (UDP 3702 / RTSP 554)...'}
                </span>
                
                {isTimedOut && (
                  <div className="flex gap-3 mt-2">
                    <button
                      onClick={onRetryConnection}
                      className="flex items-center gap-2 px-4 py-2 bg-cyan-950/50 border border-cyan-500/30 text-cyan-300 text-xs font-orbitron rounded hover:bg-cyan-900/60 transition-all"
                    >
                      <RefreshCw className="w-3 h-3" />
                      TENTAR NOVAMENTE
                    </button>
                    <button
                      onClick={() => window.location.reload()}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-900/50 border border-white/10 text-zinc-400 text-xs font-orbitron rounded hover:bg-zinc-800/60 transition-all"
                    >
                      FORÇAR RELOAD
                    </button>
                  </div>
                )}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Feedback visual de ações manuais */}
        {actionFeedback && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className={`w-full mb-4 p-2.5 border rounded-lg text-xs font-mono flex items-center justify-center gap-2 ${
              isTimedOut 
                ? 'bg-rose-950/40 border-rose-500/30 text-rose-300' 
                : 'bg-cyan-950/40 border-cyan-500/30 text-cyan-300'
            }`}
          >
            <Activity className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
            <span>{actionFeedback}</span>
          </motion.div>
        )}

        {/* BARRA DE AÇÕES (REMOVIDA EM FAVOR DOS FABS GLOBAIS) */}
      </GlassCard>
    </main>
  );
}

export default BootEnvironmentHud;
