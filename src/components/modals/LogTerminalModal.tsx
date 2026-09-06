import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Copy, Check, X, ChevronDown, ChevronRight, Info, Cloud, AlertCircle, CheckCircle2 } from 'lucide-react';
import { GlassCard } from '../ui/GlassCard';

interface LogEntry {
  timestamp: string;
  prefix: string;
  message: string;
}

interface LogTerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
}

export const LogTerminalModal: React.FC<LogTerminalModalProps> = ({ isOpen, onClose, logs }) => {
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);

  const handleCopyLogs = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.prefix}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/30 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            <GlassCard className="w-full">
              <div className="flex items-center justify-between z-10 pb-4 border-b border-white/10 mb-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="w-3 h-3 rounded-full bg-rose-500" />
                    <span className="w-3 h-3 rounded-full bg-amber-500" />
                    <span className="w-3 h-3 rounded-full bg-emerald-500" />
                  </div>
                  <span className="text-[11px] font-mono text-zinc-300 uppercase tracking-wider font-semibold">
                    Terminal de Eventos do Sistema
                  </span>
                </div>
                
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCopyLogs}
                    className="text-[11px] text-zinc-400 hover:text-cyan-300 flex items-center gap-1.5 font-mono transition-colors"
                    title="Copiar histórico de logs"
                  >
                    {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLogs ? 'Copiado' : 'Copiar'}</span>
                  </button>
                  <div className="w-px h-4 bg-white/10" />
                  <button
                    onClick={onClose}
                    className="text-zinc-400 hover:text-rose-400 transition-colors"
                    title="Fechar terminal"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="max-h-[65vh] overflow-y-auto font-mono text-[11px] space-y-1.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                {logs.length > 0 ? (
                  logs.slice().reverse().map((log, idx) => {
                    const isExpanded = expandedLogIndex === idx;
                    const hash = Math.abs((log.timestamp + log.message + idx).split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0));
                    const hexAddress = '0x' + (hash % 0xFFFFFFF).toString(16).toUpperCase().padStart(8, '0');
                    const pid = 2571 + (idx % 7) * 11;
                    
                    let thread = 'BCI_SIGNAL_HANDLER';
                    if (log.prefix === 'NETWORK') thread = 'NET_INTERFACE_DISCOVERY';
                    else if (log.prefix === 'ONVIF') thread = 'WS_DISCOVERY_MULTICAST';
                    else if (log.prefix === 'RTSP') thread = 'RTSP_STREAM_PROBE';
                    else if (log.prefix === 'AGENT') thread = 'WINDOWS_AGENT_BROKER';

                    const priority = log.prefix === 'ERROR' ? 'CRITICAL_INTERRUPT' : 'HIGH_AVAILABILITY';
                    const eventName = log.message.startsWith('WS_') || log.message.startsWith('ONVIF_') || log.message.startsWith('NET_')
                      ? log.message
                      : log.message.length > 28
                        ? log.message.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase().slice(0, 24)
                        : log.message.toUpperCase();

                    const rawPacket = btoa(unescape(encodeURIComponent(JSON.stringify({
                      timestamp: log.timestamp,
                      level: log.prefix || 'INFO',
                      category: 'nexus.' + (log.prefix || 'core').toLowerCase(),
                      event: eventName,
                      payload: log.message,
                      thread,
                      address: hexAddress
                    }))));

                    let badgeColor = 'text-cyan-400 bg-cyan-950/40';
                    if (log.prefix === 'ERROR') badgeColor = 'text-rose-400 bg-rose-950/40';
                    else if (log.prefix === 'NETWORK') badgeColor = 'text-blue-400 bg-blue-950/40';
                    else if (log.prefix === 'ONVIF') badgeColor = 'text-emerald-400 bg-emerald-950/40';
                    else if (log.prefix === 'AGENT') badgeColor = 'text-amber-400 bg-amber-950/40';

                    return (
                      <div 
                        key={idx} 
                        className="border-b border-zinc-800/50 last:border-0 pb-1.5 transition-all select-none relative z-10"
                      >
                        <div
                          onClick={() => setExpandedLogIndex(isExpanded ? null : idx)}
                          className="flex items-center justify-between p-2 rounded hover:bg-white/[0.04] hover:backdrop-blur-sm cursor-pointer transition-colors group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 shrink-0" />
                            )}

                            <div 
                              className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold shrink-0 ${badgeColor}`}
                              style={{ clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)' }}
                            >
                              <Info className="w-3 h-3 shrink-0" />
                              <span>{log.prefix || 'INFO'}</span>
                            </div>

                            <span className="text-zinc-400 text-xs font-mono tracking-normal shrink-0">
                              {log.timestamp}
                            </span>

                            <span className="font-mono font-bold text-zinc-100 text-xs tracking-wider uppercase truncate">
                              {log.message}
                            </span>
                          </div>

                          <div 
                            className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono font-bold tracking-wider uppercase shrink-0 ml-2 ${
                              log.prefix === 'ERROR' 
                                ? 'bg-rose-950/30 text-rose-400' 
                                : 'bg-emerald-950/30 text-emerald-400'
                            }`}
                            style={{ clipPath: 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)' }}
                          >
                            {log.prefix === 'ERROR' ? <AlertCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                            <span className="hidden sm:inline">{log.prefix === 'ERROR' ? 'FAILED' : 'RECORDED'}</span>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="border-l-2 border-cyan-400 pl-5 pr-2 py-2 mt-2 mb-3 ml-2.5 text-left">
                                <div className="grid grid-cols-2 gap-y-3.5 gap-x-8 max-w-lg">
                                  <div>
                                    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                                      MEMORY ADDRESS
                                    </div>
                                    <div className="text-xs font-mono text-cyan-400 font-bold">
                                      {hexAddress}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                                      PROCESS ID
                                    </div>
                                    <div className="text-xs font-mono text-zinc-100 font-semibold">
                                      {pid}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                                      THREAD
                                    </div>
                                    <div className="text-xs font-mono text-zinc-100 font-semibold truncate">
                                      {thread}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-1">
                                      PRIORITY
                                    </div>
                                    <div className="text-xs font-mono text-emerald-400 font-bold tracking-wide">
                                      {priority}
                                    </div>
                                  </div>
                                </div>

                                <div className="mt-4">
                                  <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">
                                    RAW DATA PACKET
                                  </div>
                                  <div className="bg-black/60 border border-zinc-800/90 rounded p-3 text-[11px] font-mono text-zinc-400 break-all leading-relaxed font-normal">
                                    {rawPacket}
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-zinc-500 font-mono text-xs uppercase tracking-widest italic">
                    Nenhum evento registrado no buffer circular...
                  </div>
                )}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
