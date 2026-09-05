import { Sliders, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { CameraStream } from '../types';
import { GlassCard } from './GlassCard';

interface PtzModalProps {
  camera: CameraStream | null;
  isOpen?: boolean;
  onClose: () => void;
  onCommand?: (command: string) => void;
  zoomLevel?: number;
}

export function PtzModal({ camera, isOpen = true, onClose, onCommand = () => {}, zoomLevel = 1 }: PtzModalProps) {
  if (!camera || !isOpen) return null;

  return (
    <div
      id="modal-ptz-container"
      className="cftv-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ptz-title"
      onClick={onClose}
    >
      <div className="cftv-modal-wrapper cftv-modal-wrapper-sm" onClick={(e) => e.stopPropagation()}>
        <GlassCard id="modal-ptz-card" className="cftv-glass-modal p-5 sm:p-6">
          <header className="cftv-modal-header">
            <div id="ptz-title" className="cftv-modal-title text-purple-400">
              <Sliders className="w-4 h-4 text-purple-400 animate-pulse" />
              <span>Controle PTZ: {camera.name}</span>
            </div>
            <button
              id="btn-close-ptz"
              onClick={onClose}
              className="cftv-btn-icon"
              aria-label="Fechar modal PTZ"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          <main className="flex flex-col items-center gap-4 mt-2">
            <p className="text-xs text-zinc-400 text-center font-sans">
              Navegue pelas coordenadas da lente ou ajuste o zoom digital.
            </p>

            <section className="flex flex-col items-center gap-1.5 p-4 bg-black/50 border border-white/10 w-full" aria-label="Navegação Direcional PTZ">
              <button
                id="btn-ptz-up"
                onClick={() => onCommand('up')}
                className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-purple-500/20 text-zinc-200 hover:text-purple-300 border border-white/15 hover:border-purple-500/40 transition-colors active:scale-95"
                aria-label="Inclinar para cima"
              >
                <ChevronUp className="w-6 h-6" />
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  id="btn-ptz-left"
                  onClick={() => onCommand('left')}
                  className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-purple-500/20 text-zinc-200 hover:text-purple-300 border border-white/15 hover:border-purple-500/40 transition-colors active:scale-95"
                  aria-label="Girar para esquerda"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <button
                  id="btn-ptz-reset"
                  onClick={() => onCommand('reset')}
                  className="w-12 h-12 flex flex-col items-center justify-center gap-0.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 transition-colors active:scale-95"
                  title="Resetar Zoom e Posição"
                  aria-label="Resetar visualização"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="font-rajdhani font-bold text-[10px]">{zoomLevel}x</span>
                </button>

                <button
                  id="btn-ptz-right"
                  onClick={() => onCommand('right')}
                  className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-purple-500/20 text-zinc-200 hover:text-purple-300 border border-white/15 hover:border-purple-500/40 transition-colors active:scale-95"
                  aria-label="Girar para direita"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              <button
                id="btn-ptz-down"
                onClick={() => onCommand('down')}
                className="w-12 h-12 flex items-center justify-center bg-white/5 hover:bg-purple-500/20 text-zinc-200 hover:text-purple-300 border border-white/15 hover:border-purple-500/40 transition-colors active:scale-95"
                aria-label="Inclinar para baixo"
              >
                <ChevronDown className="w-6 h-6" />
              </button>
            </section>
          </main>

          <footer className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10" aria-label="Controles de Zoom">
            <button
              id="btn-zoom-in"
              onClick={() => onCommand('zoom-in')}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-rajdhani font-bold text-purple-300 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 transition-colors uppercase tracking-wider"
            >
              <ZoomIn className="w-4 h-4" />
              <span>ZOOM +</span>
            </button>
            <button
              id="btn-zoom-out"
              onClick={() => onCommand('zoom-out')}
              className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-rajdhani font-bold text-purple-300 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 transition-colors uppercase tracking-wider"
            >
              <ZoomOut className="w-4 h-4" />
              <span>ZOOM -</span>
            </button>
          </footer>
        </GlassCard>
      </div>
    </div>
  );
}
