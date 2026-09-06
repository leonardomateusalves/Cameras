import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

export interface RadarTarget {
  id: string;
  label: string;
  // Coordenadas polares: raio normalizado (0 a 1) e ângulo em radianos
  radius: number;
  angle: number; // 0 a 2*PI (0 rad = 12h / Topo)
  size: number;
  lastPingTime: number; // timestamp em ms quando foi varrido pela última vez
  signalStrength: number; // 0.6 a 1.0
  type: 'camera' | 'node' | 'gateway';
  ip?: string;
}

interface MilitaryRadarScopeProps {
  isWorking: boolean;
  className?: string;
  targets?: RadarTarget[];
  onSweepUpdate?: (azimuthDeg: number, activeCardIndex: number | null, cardIntensities: [number, number, number]) => void;
  onTargetClick?: (targetId: string) => void;
}

export const MilitaryRadarScope: React.FC<MilitaryRadarScopeProps> = ({
  isWorking,
  className = '',
  targets = [],
  onSweepUpdate,
  onTargetClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animFrameIdRef = useRef<number>(0);
  const targetsRef = useRef<RadarTarget[]>(targets);
  
  // Atualiza a ref interna de alvos conforme a detecção real do sistema
  useEffect(() => {
    targetsRef.current = targets.map(t => ({
      ...t,
      lastPingTime: targetsRef.current.find(prev => prev.id === t.id)?.lastPingTime || 0
    }));
  }, [targets]);
  
  // Estado para HUD interativo e telemetria
  const [currentAzimuth, setCurrentAzimuth] = useState<number>(0);
  const [manualPings, setManualPings] = useState<{ x: number; y: number; startTime: number }[]>([]);

  // Dispara pulso de sonar acústico manual ao clicar no display
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setManualPings(prev => [...prev.slice(-3), { x, y, startTime: performance.now() }]);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Resolução interna nítida para telas Retina / High-DPI
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 320; // tamanho base do canvas
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radarRadius = size * 0.46; // raio útil de varredura

    // Parâmetros de rotação: ciclo de 4s (rotação horária militar suave)
    const sweepDuration = 4000; // ms por volta completa (360°)
    let lastTime = performance.now();
    let sweepAngle = 0; // radianos: 0 = topo (12h), sentido horário

    const render = (now: number) => {
      const delta = now - lastTime;
      lastTime = now;

      if (isWorking) {
        // Incremento angular contínuo no sentido horário
        sweepAngle = (sweepAngle + (delta / sweepDuration) * Math.PI * 2) % (Math.PI * 2);
      }

      // Calcula o azimute em graus (0° = 12h, 90° = 3h, 180° = 6h, 270° = 9h)
      const deg = ((sweepAngle * 180) / Math.PI) % 360;

      // ======================================================================
      // CÁLCULO DE SINCRONIZAÇÃO EM TEMPO REAL COM OS 3 CARDS INFERIORES:
      // - Card 3 (Direita / Varredura): setor de 110° a 155° (Centro 132.5°)
      // - Card 2 (Centro / Sub-rede): setor de 160° a 200° (Centro 180.0°)
      // - Card 1 (Esquerda / Agente): setor de 205° a 250° (Centro 227.5°)
      // ======================================================================
      let activeCardIndex: number | null = null;
      const cardIntensities: [number, number, number] = [0, 0, 0];

      if (isWorking) {
        // Card 3 (Direita)
        const diff3 = Math.abs(deg - 132.5);
        if (diff3 <= 25) {
          activeCardIndex = 2;
          cardIntensities[2] = Math.cos((diff3 / 25) * (Math.PI / 2));
        }

        // Card 2 (Centro)
        const diff2 = Math.abs(deg - 180);
        if (diff2 <= 22) {
          activeCardIndex = 1;
          cardIntensities[1] = Math.cos((diff2 / 22) * (Math.PI / 2));
        }

        // Card 1 (Esquerda)
        const diff1 = Math.abs(deg - 227.5);
        if (diff1 <= 25) {
          activeCardIndex = 0;
          cardIntensities[0] = Math.cos((diff1 / 25) * (Math.PI / 2));
        }

        if (onSweepUpdate) {
          onSweepUpdate(deg, activeCardIndex, cardIntensities);
        }
      }

      // Limpeza transparente (fundo sem bordas)
      ctx.clearRect(0, 0, size, size);

      // ======================================================================
      // 1. RESPLENDOR ATMOSFÉRICO TÁTICO CONTÍNUO (SEM DISCO OPACO OU BORDAS)
      // ======================================================================
      const bgGrad = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, radarRadius
      );
      bgGrad.addColorStop(0, 'rgba(0, 240, 255, 0.16)');
      bgGrad.addColorStop(0.3, 'rgba(2, 35, 58, 0.35)');
      bgGrad.addColorStop(0.65, 'rgba(1, 18, 32, 0.15)');
      bgGrad.addColorStop(0.88, 'rgba(0, 10, 20, 0.04)');
      bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // 100% transparente e contínuo

      ctx.fillStyle = bgGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
      ctx.fill();

      // ======================================================================
      // 2. GRADE CARTESIANA CONTÍNUA (DISSOLUÇÃO SUAVE SEM RECORTE CIRCULAR DURO)
      // ======================================================================
      ctx.save();
      const gridSize = 18;
      for (let x = centerX - radarRadius; x <= centerX + radarRadius; x += gridSize) {
        const dx = Math.abs(x - centerX);
        if (dx >= radarRadius) continue;
        const lineHalfHeight = Math.sqrt(radarRadius * radarRadius - dx * dx);
        
        const lineGrad = ctx.createLinearGradient(
          x, centerY - lineHalfHeight,
          x, centerY + lineHalfHeight
        );
        const centerAlpha = Math.max(0, 1 - (dx / radarRadius) * 1.1) * 0.22;
        lineGrad.addColorStop(0, 'rgba(0, 220, 255, 0)');
        lineGrad.addColorStop(0.25, `rgba(0, 220, 255, ${centerAlpha * 0.7})`);
        lineGrad.addColorStop(0.5, `rgba(0, 220, 255, ${centerAlpha})`);
        lineGrad.addColorStop(0.75, `rgba(0, 220, 255, ${centerAlpha * 0.7})`);
        lineGrad.addColorStop(1, 'rgba(0, 220, 255, 0)');

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x, centerY - lineHalfHeight);
        ctx.lineTo(x, centerY + lineHalfHeight);
        ctx.stroke();
      }

      for (let y = centerY - radarRadius; y <= centerY + radarRadius; y += gridSize) {
        const dy = Math.abs(y - centerY);
        if (dy >= radarRadius) continue;
        const lineHalfWidth = Math.sqrt(radarRadius * radarRadius - dy * dy);
        
        const lineGrad = ctx.createLinearGradient(
          centerX - lineHalfWidth, y,
          centerX + lineHalfWidth, y
        );
        const centerAlpha = Math.max(0, 1 - (dy / radarRadius) * 1.1) * 0.22;
        lineGrad.addColorStop(0, 'rgba(0, 220, 255, 0)');
        lineGrad.addColorStop(0.25, `rgba(0, 220, 255, ${centerAlpha * 0.7})`);
        lineGrad.addColorStop(0.5, `rgba(0, 220, 255, ${centerAlpha})`);
        lineGrad.addColorStop(0.75, `rgba(0, 220, 255, ${centerAlpha * 0.7})`);
        lineGrad.addColorStop(1, 'rgba(0, 220, 255, 0)');

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(centerX - lineHalfWidth, y);
        ctx.lineTo(centerX + lineHalfWidth, y);
        ctx.stroke();
      }
      ctx.restore();

      // ======================================================================
      // 3. ANÉIS DE ALCANCE INTERNOS NÍTIDOS
      // ======================================================================
      const ringsConfig = [
        { ratio: 0.25, alpha: 0.90, lineWidth: 1.2, dash: [], glow: true },
        { ratio: 0.46, alpha: 0.65, lineWidth: 1.0, dash: [2, 3], glow: false },
        { ratio: 0.68, alpha: 0.75, lineWidth: 1.1, dash: [], glow: true },
      ];

      ringsConfig.forEach(({ ratio, alpha, lineWidth, dash, glow }) => {
        const r = radarRadius * ratio;
        ctx.save();
        if (dash.length > 0) {
          ctx.setLineDash(dash);
        }
        ctx.strokeStyle = `rgba(0, 235, 255, ${alpha})`;
        ctx.lineWidth = lineWidth;
        if (glow) {
          ctx.shadowColor = '#00f3ff';
          ctx.shadowBlur = 5;
        }
        ctx.beginPath();
        ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      });

      // ======================================================================
      // 4. RAIOS AZIMUTAIS NÍTIDOS COM DESVANECIMENTO SUAVE NAS PONTAS
      // ======================================================================
      ctx.save();
      const mainAxes = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
      mainAxes.forEach(angle => {
        const x2 = centerX + Math.sin(angle) * (radarRadius * 0.92);
        const y2 = centerY - Math.cos(angle) * (radarRadius * 0.92);
        
        const lineGrad = ctx.createLinearGradient(centerX, centerY, x2, y2);
        lineGrad.addColorStop(0, 'rgba(0, 245, 255, 0.95)');
        lineGrad.addColorStop(0.55, 'rgba(0, 230, 255, 0.85)');
        lineGrad.addColorStop(0.80, 'rgba(0, 210, 255, 0.35)');
        lineGrad.addColorStop(1, 'rgba(0, 210, 255, 0)');

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1.3;
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      });

      for (let d = 30; d < 360; d += 30) {
        if (d % 90 === 0) continue;
        const rad = (d * Math.PI) / 180;
        const x2 = centerX + Math.sin(rad) * (radarRadius * 0.86);
        const y2 = centerY - Math.cos(rad) * (radarRadius * 0.86);

        const lineGrad = ctx.createLinearGradient(centerX, centerY, x2, y2);
        lineGrad.addColorStop(0, 'rgba(0, 220, 255, 0.70)');
        lineGrad.addColorStop(0.50, 'rgba(0, 200, 255, 0.50)');
        lineGrad.addColorStop(0.80, 'rgba(0, 190, 255, 0.15)');
        lineGrad.addColorStop(1, 'rgba(0, 190, 255, 0)');

        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // ======================================================================
      // 5. ALVOS TÁTICOS REAIS DETECTADOS (SEM PONTOS ALEATÓRIOS MOCK)
      // Cada ponto representa um dispositivo real (câmera encontrada ou gateway LAN)
      // ======================================================================
      const currentTargets = targetsRef.current;
      if (currentTargets.length > 0) {
        currentTargets.forEach(target => {
          const targetRadiusPx = radarRadius * target.radius;
          const tx = centerX + Math.sin(target.angle) * targetRadiusPx;
          const ty = centerY - Math.cos(target.angle) * targetRadiusPx;

          // Diferença angular entre a varredura e o alvo
          const angleDiff = (sweepAngle - target.angle + Math.PI * 2) % (Math.PI * 2);

          // Se o feixe passou sobre o alvo recentemente
          if (angleDiff < 0.14 && isWorking) {
            target.lastPingTime = now;
          }

          const elapsedSincePing = now - target.lastPingTime;
          const decayDuration = 2200; // ms
          
          let phosphorIntensity = 0.38;
          if (target.lastPingTime > 0 && elapsedSincePing < decayDuration && isWorking) {
            const progress = elapsedSincePing / decayDuration;
            phosphorIntensity = Math.max(0.38, Math.exp(-progress * 2.8));
          }

          ctx.save();

          // Onda expansiva de sonar quando o feixe acabou de passar pelo alvo
          if (phosphorIntensity > 0.65) {
            const ringPulse = ((decayDuration - elapsedSincePing) / decayDuration) * 18;
            ctx.beginPath();
            ctx.arc(tx, ty, target.size + ringPulse, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 243, 255, ${phosphorIntensity * 0.75})`;
            ctx.lineWidth = 1.3;
            ctx.stroke();

            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 14 * phosphorIntensity;
          } else {
            ctx.shadowColor = 'rgba(0, 220, 255, 0.6)';
            ctx.shadowBlur = 5;
          }

          // Auréola externa do blip
          ctx.beginPath();
          ctx.arc(tx, ty, target.size * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(0, 210, 255, ${phosphorIntensity * 0.45})`;
          ctx.fill();

          // Núcleo do blip (Branco incandescente quando iluminado pelo feixe)
          ctx.beginPath();
          ctx.arc(tx, ty, target.size, 0, Math.PI * 2);
          ctx.fillStyle = phosphorIntensity > 0.65 ? '#ffffff' : `rgba(0, 245, 255, ${Math.min(1, phosphorIntensity * 1.6)})`;
          ctx.fill();

          // Rótulo militar com ID real do dispositivo
          if (phosphorIntensity > 0.50) {
            ctx.font = '700 8.5px Orbitron, monospace';
            ctx.fillStyle = phosphorIntensity > 0.75 ? '#ffffff' : `rgba(0, 243, 255, ${phosphorIntensity})`;
            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 4;
            ctx.fillText(target.id, tx + 8, ty - 4);
          }

          ctx.restore();
        });
      }

      // ======================================================================
      // 6. PULSOS DE ECO SONAR MANUAIS (CLIQUE DO USUÁRIO)
      // ======================================================================
      if (manualPings.length > 0) {
        ctx.save();
        manualPings.forEach(ping => {
          const elapsed = now - ping.startTime;
          if (elapsed < 1400) {
            const p = elapsed / 1400;
            const px = ping.x * size;
            const py = ping.y * size;
            const pr = p * 50;
            ctx.beginPath();
            ctx.arc(px, py, pr, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 243, 255, ${1 - p})`;
            ctx.lineWidth = 1.6;
            ctx.stroke();
          }
        });
        ctx.restore();
      }

      // ======================================================================
      // 7. FEIXE VARREDOR ROTATIVO NÍTIDO E CRISTALINO (CLOCKWISE SWEEPER)
      // Laser frontal de alta luminosidade + cauda fosfórica
      // ======================================================================
      if (isWorking) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(sweepAngle);

        // Cauda de esvaecimento do feixe (cone gradiente translúcido)
        const trailAngle = Math.PI * 0.32; // ~58 graus de cone
        const steps = 30;
        for (let i = 0; i < steps; i++) {
          const stepFrac = i / steps;
          const aStart = -trailAngle * (1 - stepFrac);
          const aEnd = -trailAngle * (1 - (stepFrac + 1 / steps));

          const coneGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radarRadius);
          const baseAlpha = Math.pow(stepFrac, 2.0) * 0.55;
          coneGrad.addColorStop(0, `rgba(0, 245, 255, ${baseAlpha * 1.3})`);
          coneGrad.addColorStop(0.70, `rgba(0, 220, 255, ${baseAlpha})`);
          coneGrad.addColorStop(0.92, `rgba(0, 190, 255, ${baseAlpha * 0.4})`);
          coneGrad.addColorStop(1, 'rgba(0, 160, 255, 0)');

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, radarRadius, aStart - Math.PI / 2, aEnd - Math.PI / 2);
          ctx.closePath();

          ctx.fillStyle = coneGrad;
          ctx.fill();
        }

        // Raio Laser Frontal Principal - 100% NÍTIDO E BRILHANTE
        const rayGrad = ctx.createLinearGradient(0, 0, 0, -radarRadius);
        rayGrad.addColorStop(0, '#ffffff');
        rayGrad.addColorStop(0.65, '#ffffff');
        rayGrad.addColorStop(0.85, 'rgba(0, 245, 255, 0.95)');
        rayGrad.addColorStop(0.95, 'rgba(0, 245, 255, 0.4)');
        rayGrad.addColorStop(1, 'rgba(0, 245, 255, 0)');

        // Halo largo de luminescência
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -radarRadius);
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.6)';
        ctx.lineWidth = 4;
        ctx.stroke();

        // Raio central branco puro nítido
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -radarRadius);
        ctx.strokeStyle = rayGrad;
        ctx.lineWidth = 2.0;
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 12;
        ctx.stroke();

        ctx.restore();
      }

      // ======================================================================
      // 8. CENTRO EMISSOR LUMINESCENTE (SONAR EMITTER HUB)
      // ======================================================================
      const hubGlow = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, 18
      );
      hubGlow.addColorStop(0, '#ffffff');
      hubGlow.addColorStop(0.25, '#00f3ff');
      hubGlow.addColorStop(0.65, 'rgba(2, 132, 199, 0.5)');
      hubGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = hubGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 18, 0, Math.PI * 2);
      ctx.fill();

      // Ponto focal central
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 243, 255, 0.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
      ctx.stroke();

      // Atualiza o estado de azimute a cada ~80ms para o HUD textual
      if (isWorking && Math.floor(now / 80) !== Math.floor(lastTime / 80)) {
        setCurrentAzimuth(Math.round(deg));
      }

      // Próximo frame a 60fps
      animFrameIdRef.current = requestAnimationFrame(render);
    };

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [isWorking, manualPings, onSweepUpdate]);

  const targetCount = targets.length;

  return (
    <div
      ref={containerRef}
      className={`cftv-military-radar-wrap my-3 flex flex-col items-center justify-center relative select-none ${className}`}
    >
      {/* Container Flutuante e Difuso: SEM BORDAS METÁLICAS, COM MÁSCARA RADIAL SUAVE */}
      <div className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center">
        {/* Resplendor e Halo de Fundo Totalmente Difuso */}
        <div 
          className="absolute inset-0 rounded-full pointer-events-none opacity-40 blur-2xl bg-radial from-cyan-500/25 via-sky-600/10 to-transparent"
        />

        {/* Display Canvas com Máscara Radial Suave e Contínua */}
        <div 
          className="relative w-64 h-64 sm:w-72 sm:h-72 flex items-center justify-center cursor-crosshair"
          style={{
            maskImage: 'radial-gradient(circle at center, black 0%, black 52%, rgba(0,0,0,0.85) 66%, rgba(0,0,0,0.5) 80%, rgba(0,0,0,0.15) 92%, transparent 98%)',
            WebkitMaskImage: 'radial-gradient(circle at center, black 0%, black 52%, rgba(0,0,0,0.85) 66%, rgba(0,0,0,0.5) 80%, rgba(0,0,0,0.15) 92%, transparent 98%)',
          }}
        >
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full h-full block"
            title="Sonar Tático Flutuante. Clique para emitir pulso acústico de sonar."
          />
        </div>
      </div>

      {/* Barra de Telemetria Tática HUD Integrada ao Sonar (Valores Reais Sincronizados) */}
      <div className="flex items-center justify-between gap-4 mt-1 px-3 py-1 rounded-full bg-black/40 border border-cyan-500/15 text-[10px] font-orbitron tracking-widest text-cyan-400 backdrop-blur-sm shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
          <span>AZ: {String(currentAzimuth).padStart(3, '0')}°</span>
        </div>
        <div className="text-zinc-400">
          <span>
            {targetCount === 0 
              ? 'ALVOS: 00 LOCALIZADOS' 
              : `ALVOS: ${String(targetCount).padStart(2, '0')} ${targetCount === 1 ? 'DETECTADO' : 'CONFIRMADOS'}`}
          </span>
        </div>
        <div className="text-cyan-300/80">
          <span>{isWorking ? 'VARREDURA ATIVA' : 'STANDBY'}</span>
        </div>
      </div>
    </div>
  );
};

export default MilitaryRadarScope;
