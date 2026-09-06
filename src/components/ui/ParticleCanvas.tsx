/**
 * ============================================================================
 * 🧠 NEXUS OS - MÓDULO: ParticleCanvas.tsx
 * ============================================================================
 * 
 * 📄 TIPO: Componente de Interface (TSX)
 * 📍 LOCALIZAÇÃO: src/components/ParticleCanvas/ParticleCanvas.tsx
 * 
 * ⚙️ DESCRIÇÃO TÉCNICA:
 * Componente React de interface visual 'ParticleCanvas'. Utiliza hooks (useState, useEffect) para gerenciar ciclo de vida e estado local.
 * Renderiza uma malha cibernética neural interativa com nós, conexões e feixes de pulso reativos ao mouse.
 * 
 * 🛠️ ARQUITETURA E FUNCIONAMENTO:
 * - Desenvolvido em TypeScript puro para garantir segurança de tipagem forte (Strict Typing).
 * - Arquitetura modular baseada em importação e exportação de ES Modules (ESM).
 * - Alta performance com renderização isolada em Canvas 2D para evitar re-renderizações desnecessárias.
 * ============================================================================
 */

import React, { useEffect, useRef } from 'react';

interface Neuron {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  color: string;
  pulsePhase: number;
}

interface Edge {
  i: number;
  j: number;
  dist: number;
}

interface Pulse {
  i: number;
  j: number;
  t: number;
  dur: number;
}

export const ParticleCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let neurons: Neuron[] = [];
    let pulses: Pulse[] = [];
    const LINK_DIST = 170;
    const MOUSE_RADIUS = 180;
    let mouseX = -9999;
    let mouseY = -9999;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    const handleMouseLeave = () => {
      mouseX = -9999;
      mouseY = -9999;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    function resize() {
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    function spawn() {
      if (!canvas) return;
      neurons = [];
      const n = Math.min(85, Math.max(30, Math.floor((canvas.width * canvas.height) / 22000)));
      const colorPalette = [
        '0,243,255',    // Neon Cyan
        '0,180,255',    // Electric Blue
        '0,114,255',    // Cobalt Cyan
        '56,189,248'    // Sky Blue
      ];

      for (let i = 0; i < n; i++) {
        neurons.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 2.2 + 1.6,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          color: colorPalette[Math.floor(Math.random() * colorPalette.length)],
          pulsePhase: Math.random() * Math.PI * 2
        });
      }
      pulses = [];
    }

    resize();
    spawn();

    const handleResize = () => {
      resize();
      spawn();
    };
    window.addEventListener('resize', handleResize);

    let frame = 0;
    let cachedEdges: Edge[] = [];
    let animId: number;

    function recomputeEdges() {
      cachedEdges = [];
      for (let i = 0; i < neurons.length; i++) {
        for (let j = i + 1; j < neurons.length; j++) {
          const dx = neurons[i].x - neurons[j].x;
          const dy = neurons[i].y - neurons[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) cachedEdges.push({ i, j, dist });
        }
      }
    }

    function maybeSpawnPulse() {
      if (cachedEdges.length === 0) return;
      if (Math.random() < 0.08 && pulses.length < 12) {
        const e = cachedEdges[Math.floor(Math.random() * cachedEdges.length)];
        pulses.push({ i: e.i, j: e.j, t: 0, dur: 40 + Math.random() * 35 });
      }
    }

    function draw() {
      if (!canvas || !ctx || canvas.width <= 0 || canvas.height <= 0) return;
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Ambient Background Glow Spots (luzes de fundo nos quadros)
      const grad1 = ctx.createRadialGradient(canvas.width * 0.2, canvas.height * 0.3, 0, canvas.width * 0.2, canvas.height * 0.3, canvas.width * 0.45);
      grad1.addColorStop(0, 'rgba(0, 243, 255, 0.12)');
      grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const grad2 = ctx.createRadialGradient(canvas.width * 0.8, canvas.height * 0.7, 0, canvas.width * 0.8, canvas.height * 0.7, canvas.width * 0.5);
      grad2.addColorStop(0, 'rgba(0, 120, 255, 0.12)');
      grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Draw Mouse Interactive Cyber Grid & Quadros Highlights
      const gridSize = 50;
      const mouseGlowRadius = 250;
      ctx.lineWidth = 1;
      
      // Vertical grid lines
      for (let x = 0; x <= canvas.width; x += gridSize) {
        const distToMouse = Math.abs(x - mouseX);
        const nearMouse = mouseX > -999 && distToMouse < mouseGlowRadius;
        const lineAlpha = nearMouse ? 0.08 + (1 - distToMouse / mouseGlowRadius) * 0.25 : 0.045;
        
        ctx.strokeStyle = nearMouse 
          ? `rgba(0, 243, 255, ${lineAlpha})`
          : 'rgba(0, 243, 255, 0.045)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }

      // Horizontal grid lines
      for (let y = 0; y <= canvas.height; y += gridSize) {
        const distToMouse = Math.abs(y - mouseY);
        const nearMouse = mouseY > -999 && distToMouse < mouseGlowRadius;
        const lineAlpha = nearMouse ? 0.08 + (1 - distToMouse / mouseGlowRadius) * 0.25 : 0.045;
        
        ctx.strokeStyle = nearMouse 
          ? `rgba(0, 180, 255, ${lineAlpha})`
          : 'rgba(0, 243, 255, 0.045)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Mouse Proximity Dynamic Cyber Flare & Intersecting Grid Nodes
      if (mouseX > -999 && mouseY > -999) {
        const mouseFlare = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, mouseGlowRadius);
        mouseFlare.addColorStop(0, 'rgba(0, 243, 255, 0.22)');
        mouseFlare.addColorStop(0.4, 'rgba(0, 150, 255, 0.10)');
        mouseFlare.addColorStop(0.8, 'rgba(0, 80, 255, 0.03)');
        mouseFlare.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = mouseFlare;
        ctx.fillRect(mouseX - mouseGlowRadius, mouseY - mouseGlowRadius, mouseGlowRadius * 2, mouseGlowRadius * 2);

        // Highlight nearby grid intersection nodes (luzes nos quadros de background)
        const startX = Math.floor((mouseX - mouseGlowRadius) / gridSize) * gridSize;
        const endX = Math.ceil((mouseX + mouseGlowRadius) / gridSize) * gridSize;
        const startY = Math.floor((mouseY - mouseGlowRadius) / gridSize) * gridSize;
        const endY = Math.ceil((mouseY + mouseGlowRadius) / gridSize) * gridSize;

        for (let gx = startX; gx <= endX; gx += gridSize) {
          for (let gy = startY; gy <= endY; gy += gridSize) {
            const d = Math.hypot(mouseX - gx, mouseY - gy);
            if (d < mouseGlowRadius) {
              const intensity = (1 - d / mouseGlowRadius);
              ctx.fillStyle = `rgba(0, 243, 255, ${intensity * 0.85})`;
              ctx.beginPath();
              ctx.arc(gx, gy, 2 + intensity * 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }

      neurons.forEach((p) => {
        const dxm = mouseX - p.x;
        const dym = mouseY - p.y;
        const distm = Math.sqrt(dxm * dxm + dym * dym);
        if (distm < MOUSE_RADIUS) {
          const force = (1 - distm / MOUSE_RADIUS) * 0.05;
          p.vx += (dxm / distm) * force;
          p.vy += (dym / distm) * force;
        }
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
      });

      if (frame % 6 === 0) recomputeEdges();

      cachedEdges.forEach((e) => {
        const a = neurons[e.i];
        const b = neurons[e.j];
        if (!a || !b) return;
        const midx = (a.x + b.x) / 2;
        const midy = (a.y + b.y) / 2;
        const dm = Math.hypot(mouseX - midx, mouseY - midy);
        const boost = dm < MOUSE_RADIUS ? (1 - dm / MOUSE_RADIUS) * 0.4 : 0;
        const op = (1 - e.dist / LINK_DIST) * 0.35 + boost;
        ctx.strokeStyle = `rgba(${a.color},${Math.min(op, 0.85)})`;
        ctx.lineWidth = 1 + boost * 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      if (mouseX > -999) {
        neurons.forEach((p) => {
          const d = Math.hypot(mouseX - p.x, mouseY - p.y);
          if (d < MOUSE_RADIUS) {
            ctx.strokeStyle = `rgba(0,243,255,${(1 - d / MOUSE_RADIUS) * 0.45})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(mouseX, mouseY);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
        });
      }

      neurons.forEach((p) => {
        const d = Math.hypot(mouseX - p.x, mouseY - p.y);
        const near = d < MOUSE_RADIUS;
        const pulse = Math.sin(frame * 0.05 + p.pulsePhase) * 0.2 + 1;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (near ? 3.2 : 2.2) * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${near ? 0.2 : 0.08})`;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (near ? 1.5 : 1.1), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color},${near ? 1 : 0.85})`;
        ctx.fill();
      });

      maybeSpawnPulse();
      pulses.forEach((p) => {
        const a = neurons[p.i];
        const b = neurons[p.j];
        if (!a || !b) { p.t = p.dur; return; }
        const t = p.t / p.dur;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${a.color}, 0.9)`;
        ctx.fill();
        p.t++;
      });
      pulses = pulses.filter((p) => p.t < p.dur);

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return <canvas id="cftv-particle-canvas" className="cftv-particle-canvas" ref={canvasRef} />;
};
