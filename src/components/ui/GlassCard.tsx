import React from 'react';

export interface GlassCardProps extends React.HTMLAttributes<HTMLElement> {
  as?: React.ElementType;
  gradient?: boolean;
  variant?: string;
  intensity?: string;
  status?: 'normal' | 'timedOut';
  children?: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  isFocused?: boolean;
  'data-component'?: string;
  'data-nome'?: string;
}

export const GlassCard = React.forwardRef<HTMLElement, GlassCardProps>(({
  as: Component = 'div',
  children,
  className = '',
  hoverEffect = false,
  isFocused,
  status = 'normal',
  gradient,
  variant,
  intensity,
  'data-component': dataComponent = 'GlassCard',
  'data-nome': dataNome = 'Cartão de Vidro Tático',
  style,
  ...props
}, ref) => {
  const hoverClasses = hoverEffect ? 'hover:border-white/30 hover:bg-white/[0.03] transition-all duration-200' : '';
  const statusClasses = status === 'timedOut'
    ? 'border-rose-500/40 shadow-[0_4px_16px_rgba(0,0,0,0.4),0_0_20px_rgba(244,63,94,0.08)] bg-rose-950/10'
    : 'border-cyan-500/30 shadow-[0_4px_16px_rgba(0,0,0,0.3),0_0_20px_rgba(0,243,255,0.05)] bg-black/30';
  const baseClasses = 'relative rounded-none border backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] p-6 flex flex-col gap-4';

  return (
    <Component
      ref={ref as any}
      data-component={dataComponent}
      data-nome={dataNome}
      style={{
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 20px), calc(100% - 20px) 100%, 0 100%)',
        ...style
      }}
      className={`${baseClasses} ${statusClasses} ${hoverClasses} ${className}`}
      {...props as any}
    >
      {/* Cantoneira tática ciano superior direita */}
      <div 
        className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-cyan-400 pointer-events-none z-20" 
        aria-hidden="true" 
      />
      {children}
    </Component>
  );
});

GlassCard.displayName = 'GlassCard';

export default GlassCard;
