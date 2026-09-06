import React from 'react';
import { RefreshCw, Video, Terminal } from 'lucide-react';
import { GlassCard } from './GlassCard';

interface TacticalFabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
}

const TacticalFab: React.FC<TacticalFabProps> = ({ icon, className = '', disabled, ...props }) => {
  return (
    <GlassCard
      as="button"
      hoverEffect={!disabled}
      className={`w-14 h-14 !p-0 items-center justify-center ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
      {...props as any}
    >
      <div className="flex items-center justify-center w-full h-full text-cyan-400">
        {icon}
      </div>
    </GlassCard>
  );
};

interface TacticalCommandCenterProps {
  onRescan: () => void;
  onAddCamera: () => void;
  onOpenLogs: () => void;
  isScanning?: boolean;
  isTimedOut?: boolean;
}

export const TacticalCommandCenter: React.FC<TacticalCommandCenterProps> = ({
  onRescan,
  onAddCamera,
  onOpenLogs,
  isScanning,
  isTimedOut
}) => {
  return (
    <div className="cftv-command-center">
      <TacticalFab
        onClick={onRescan}
        disabled={isScanning}
        icon={<RefreshCw className={`w-5 h-5 ${isScanning ? 'animate-spin' : ''}`} />}
        title={isTimedOut ? 'Reiniciar Busca' : 'Reescanear Rede'}
      />
      
      <TacticalFab
        onClick={onAddCamera}
        icon={<Video className="w-5 h-5" />}
        title="Adicionar câmera"
      />

      <TacticalFab
        onClick={onOpenLogs}
        icon={<Terminal className="w-5 h-5" />}
        title="Abrir terminal"
      />
    </div>
  );
};
