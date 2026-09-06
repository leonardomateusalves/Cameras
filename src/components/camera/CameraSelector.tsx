import React from 'react';
import { CameraStream } from '../../types';
import { GlassCard } from '../ui/GlassCard';
import { Shield, Eye, HelpCircle, Network, HardDrive, Cpu } from 'lucide-react';

interface CameraSelectorProps {
  cameras: CameraStream[];
  onSelect: (id: string) => void;
}

export function CameraSelector({ cameras, onSelect }: CameraSelectorProps) {
  return (
    <main id="cftv-main-viewport" className="cftv-main-viewport flex flex-col items-center justify-start flex-1 min-h-[85vh] p-6 max-w-5xl mx-auto w-full font-rajdhani">
      {/* Cabeçalho da Lista */}
      <div className="w-full text-center md:text-left mb-6 border-b border-cyan-500/10 pb-4">
        <h1 className="text-xl font-orbitron font-bold text-cyan-300 tracking-widest uppercase flex items-center gap-2 justify-center md:justify-start">
          <Cpu className="w-5 h-5 text-cyan-400 animate-pulse" />
          Câmeras Encontradas na Rede Local ({cameras.length})
        </h1>
        <p className="text-xs text-zinc-400 font-sans mt-1">
          Selecione uma câmera IP para estabelecer conexão de segurança e iniciar o decodificador Go2RTC de baixa latência.
        </p>
      </div>

      {/* Grade de Câmeras para Seleção */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        {cameras.map((cam) => {
          // Extrai o IP do IP de URL RTSP se disponível ou localizável
          let ip = '127.0.0.1';
          try {
            const cleanUrl = cam.rtspUrl || '';
            const match = cleanUrl.match(/@([^:/]+)/) || cleanUrl.match(/\/\/([^:/]+)/);
            if (match && match[1]) {
              ip = match[1];
            }
          } catch (e) {}

          return (
            <GlassCard 
              key={cam.id} 
              className="group flex flex-col justify-between h-full hover:border-cyan-500/30 transition-all duration-200 border border-zinc-800/60 bg-zinc-950/40 p-5 relative overflow-hidden cursor-pointer"
              onClick={() => onSelect(cam.id)}
            >
              {/* Moldura tática superior de design */}
              <div className="absolute top-0 right-0 w-16 h-16 pointer-events-none opacity-20">
                <div className="absolute top-0 right-0 w-[1px] h-4 bg-cyan-400" />
                <div className="absolute top-0 right-0 w-4 h-[1px] bg-cyan-400" />
              </div>

              {/* Informações Principais */}
              <div className="flex-1">
                {/* Nome e Fabricante */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded bg-cyan-950/30 border border-cyan-500/20 flex items-center justify-center group-hover:border-cyan-400/40 transition-colors">
                    <Shield className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div className="text-left">
                    <h3 className="font-orbitron font-bold text-sm text-zinc-100 group-hover:text-cyan-300 transition-colors truncate max-w-[200px]">
                      {cam.name || 'Câmera IP'}
                    </h3>
                    <span className="text-[10px] text-zinc-500 font-mono tracking-wider block">
                      ONVIF PROFILE S
                    </span>
                  </div>
                </div>

                {/* Detalhes Técnicos Estruturados */}
                <div className="space-y-2 border-t border-zinc-800/60 pt-3 text-xs font-mono text-zinc-400">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">FABRICANTE:</span>
                    <span className="text-zinc-300">Intelbras / Generic</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">MODELO:</span>
                    <span className="text-zinc-300">ONVIF Device</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">ENDEREÇO IP:</span>
                    <span className="text-cyan-400 font-bold">{ip}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">PORTA RTSP:</span>
                    <span className="text-zinc-300">554</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">PORTA HTTP:</span>
                    <span className="text-zinc-300">80</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-500 text-[10px]">PROTOCOLO:</span>
                    <span className="text-emerald-400 font-bold">ONVIF / RTSP</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-zinc-900 pt-2 mt-2">
                    <span className="text-zinc-600 text-[9px]">ID DISPOSITIVO:</span>
                    <span className="text-zinc-500 text-[9px] truncate max-w-[140px]" title={cam.id}>
                      {cam.id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Botão de Seleção */}
              <div className="mt-5 border-t border-zinc-800/40 pt-4">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(cam.id);
                  }}
                  className="w-full py-2 bg-cyan-950/40 hover:bg-cyan-500/25 border border-cyan-500/20 hover:border-cyan-400/40 text-cyan-300 font-orbitron font-bold text-xs tracking-widest transition-all rounded uppercase flex items-center justify-center gap-2"
                >
                  <Eye className="w-4 h-4" />
                  Selecionar Câmera
                </button>
              </div>
            </GlassCard>
          );
        })}
      </div>
    </main>
  );
}
