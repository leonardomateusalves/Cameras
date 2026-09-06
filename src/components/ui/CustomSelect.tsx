import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  badge?: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  onChange,
  options,
  className = '',
  ariaLabel
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`} id={id}>
      <button
        type="button"
        aria-label={ariaLabel || 'Selecionar opção'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 text-xs font-rajdhani font-semibold tracking-wider uppercase transition-all border bg-black/60 text-zinc-200 ${
          isOpen
            ? 'border-cyan-400 bg-black/90 text-cyan-300 shadow-[0_0_12px_rgba(0,243,255,0.2)]'
            : 'border-white/15 hover:border-cyan-500/40 hover:text-cyan-300'
        }`}
      >
        <span className="truncate">{selectedOption?.label}</span>
        <ChevronDown
          className={`w-4 h-4 ml-2 text-cyan-400 transition-transform duration-200 flex-shrink-0 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-[#060c18]/95 backdrop-blur-xl border border-cyan-500/40 shadow-[0_12px_36px_rgba(0,0,0,0.95)] max-h-56 overflow-y-auto">
          <div className="py-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  onClick={() => handleSelect(option.value)}
                  className={`px-3 py-2.5 text-xs font-rajdhani font-bold tracking-wider uppercase cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-300 border-l-2 border-cyan-400 font-extrabold'
                      : 'text-zinc-300 hover:bg-cyan-500/10 hover:text-cyan-200 border-l-2 border-transparent hover:border-cyan-500/50'
                  }`}
                >
                  <span className="truncate">{option.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0 ml-2" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
