import React from 'react';

export interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  gradient?: boolean;
  variant?: string;
  intensity?: string;
  children?: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  isFocused?: boolean;
  'data-component'?: string;
  'data-nome'?: string;
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(({
  children,
  className = '',
  hoverEffect = false,
  isFocused,
  gradient,
  variant,
  intensity,
  'data-component': dataComponent = 'GlassCard',
  'data-nome': dataNome = 'Cartão de Vidro Tático',
  style,
  ...props
}, ref) => {
  return (
    <div
      ref={ref}
      data-component={dataComponent}
      data-nome={dataNome}
      style={{
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)',
        ...style
      }}
      className={`relative rounded-none border border-white/10 bg-black/40 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] p-6 flex flex-col gap-4 ${className}`}
      {...props}
    >
      {/* Cantoneira tática ciano superior direita */}
      <div 
        className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400 pointer-events-none z-20" 
        aria-hidden="true" 
      />
      {children}
    </div>
  );
});

GlassCard.displayName = 'GlassCard';

export default GlassCard;
