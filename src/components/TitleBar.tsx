import React from 'react';
import { Shield, Minus, Square, X, Radio } from 'lucide-react';

interface TitleBarProps {
  agentOffline?: boolean;
}

export function TitleBar({ agentOffline = false }: TitleBarProps) {
  const isElectron = !!(window as any).electronAPI;

  const handleMinimize = () => {
    if (isElectron) {
      (window as any).electronAPI.minimize();
    }
  };

  const handleMaximize = () => {
    if (isElectron) {
      (window as any).electronAPI.maximize();
    }
  };

  const handleClose = () => {
    if (isElectron) {
      (window as any).electronAPI.close();
    }
  };

  return (
    <div className="nexus-titlebar">
      <div className="nexus-titlebar-brand">
        <Shield className="w-4 h-4 text-cyan-400 animate-pulse" />
        <span className="font-bold text-xs uppercase tracking-widest text-cyan-400">NEXUS RTSP</span>
        <div className="h-4 w-[1px] bg-zinc-800" />
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          <span className="text-zinc-500">AGENT:</span>
          {agentOffline ? (
            <span className="text-rose-500 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              OFFLINE
            </span>
          ) : (
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              ONLINE
            </span>
          )}
        </div>
      </div>

      <div className="nexus-titlebar-center text-zinc-500 font-mono text-[10px] hidden md:block">
        CENTRAL DE MONITORAMENTO CFTV P2P & RTSP
      </div>

      <div className="nexus-titlebar-controls">
        {/* Minimizar */}
        <button
          onClick={handleMinimize}
          className="nexus-titlebar-btn"
          title="Minimizar"
        >
          <Minus className="w-3.5 h-3.5 text-zinc-400 hover:text-cyan-400" />
        </button>

        {/* Maximizar */}
        <button
          onClick={handleMaximize}
          className="nexus-titlebar-btn"
          title="Maximizar / Restaurar"
        >
          <Square className="w-3 h-3 text-zinc-400 hover:text-cyan-400" />
        </button>

        {/* Fechar */}
        <button
          onClick={handleClose}
          className="nexus-titlebar-btn hover:bg-rose-500/20 hover:border-rose-500/30 group"
          title="Fechar Aplicativo"
        >
          <X className="w-3.5 h-3.5 text-zinc-400 group-hover:text-rose-400" />
        </button>
      </div>
    </div>
  );
}
