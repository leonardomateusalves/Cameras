interface LogEntry {
  timestamp: string;
  prefix: string;
  message: string;
}

interface DiagnosticViewerProps {
  agentStatus: string;
  networkStatus: string;
  discoveryStatus: string;
  logs: LogEntry[];
}

export function DiagnosticViewer({
  agentStatus,
  networkStatus,
  discoveryStatus,
  logs
}: DiagnosticViewerProps) {
  return (
    <div className="cftv-terminal-container" id="cftv-diagnostic-terminal">
      {/* Cabeçalho do Terminal de Diagnóstico */}
      <div className="cftv-terminal-header" id="cftv-terminal-hdr">
        <span className="cftv-terminal-title" id="cftv-terminal-title-text">
          <span className="cftv-terminal-ping-dot" />
          TERMINAL DE DIAGNÓSTICO EM TEMPO REAL
        </span>
        <span className="cftv-terminal-badge" id="cftv-terminal-badge-tag">NEXUS CONSOLE</span>
      </div>

      {/* HUD de status exigidos pelo usuário */}
      <div className="cftv-terminal-hud" id="cftv-terminal-status-hud">
        <div className="cftv-terminal-hud-item">
          <span className="cftv-terminal-hud-label">AGENT:</span>
          <span className={agentStatus.includes('🟢') ? 'cftv-status-online flex items-center gap-1.5' : 'cftv-status-pending animate-pulse flex items-center gap-1.5'}>
            <span className={`w-1.5 h-1.5 rounded-full ${agentStatus.includes('🟢') ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {agentStatus.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()}
          </span>
        </div>

        <div className="cftv-terminal-hud-item">
          <span className="cftv-terminal-hud-label">NET:</span>
          <span className={networkStatus.includes('🟢') ? 'cftv-status-online flex items-center gap-1.5' : 'cftv-status-pending flex items-center gap-1.5'}>
            <span className={`w-1.5 h-1.5 rounded-full ${networkStatus.includes('🟢') ? 'bg-emerald-400' : networkStatus.includes('🔴') ? 'bg-rose-400' : 'bg-amber-400 animate-pulse'}`} />
            {networkStatus.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()}
          </span>
        </div>

        <div className="cftv-terminal-hud-item">
          <span className="cftv-terminal-hud-label">DESCOBERTA:</span>
          <span className={
            discoveryStatus.includes('🟢') 
              ? 'cftv-status-online flex items-center gap-1.5' 
              : discoveryStatus.includes('🔍') 
                ? 'cftv-status-scanning flex items-center gap-1.5' 
                : 'cftv-status-pending flex items-center gap-1.5'
          }>
            <span className={`w-1.5 h-1.5 rounded-full ${discoveryStatus.includes('🟢') ? 'bg-emerald-400' : discoveryStatus.includes('🔍') ? 'bg-cyan-400 animate-ping' : 'bg-amber-400 animate-pulse'}`} />
            {discoveryStatus.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim()}
          </span>
        </div>
      </div>

      {/* Caixa preta de logs em tempo real do WebSocket */}
      <div className="cftv-terminal-logbox scrollbar-thin" id="cftv-terminal-log-viewport">
        {!logs || logs.length === 0 ? (
          <div className="cftv-terminal-empty-logs">
            Aguardando sinal do agente de descoberta profunda...
          </div>
        ) : (
          logs.map((log, index) => {
            if (!log) return null;
            let prefixClass = 'cftv-log-default';
            if (log.prefix === 'NETWORK') prefixClass = 'cftv-log-network';
            if (log.prefix === 'ONVIF' || log.prefix === 'DISCOVERY') prefixClass = 'cftv-log-discovery';
            if (log.prefix === 'RTSP') prefixClass = 'cftv-log-rtsp';
            if (log.prefix === 'BOOT') prefixClass = 'cftv-log-boot';
            if (log.prefix === 'ERROR') prefixClass = 'cftv-log-error';

            return (
              <div key={index} className="cftv-terminal-log-row">
                <span className="cftv-terminal-timestamp">[{log.timestamp}]</span>
                <span className={`cftv-terminal-log-prefix ${prefixClass}`}>[{log.prefix}]</span>
                <span className="cftv-terminal-log-message">{log.message}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
