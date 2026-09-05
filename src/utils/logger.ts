class FrontendLogger {
  private formatTime(): string {
    const time = new Date();
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}.${String(time.getMilliseconds()).padStart(3, '0')}`;
  }

  private getStyles(prefix: string): { prefixStyle: string; msgStyle: string } {
    let prefixStyle = 'color: #22d3ee; font-weight: bold;'; // Cyan
    let msgStyle = 'color: #f4f4f5;'; // White-ish

    switch (prefix) {
      case 'BOOT':
        prefixStyle = 'color: #3b82f6; font-weight: bold;'; // Blue
        break;
      case 'FRONTEND':
        prefixStyle = 'color: #6366f1; font-weight: bold;'; // Indigo
        break;
      case 'API':
        prefixStyle = 'color: #10b981; font-weight: bold;'; // Emerald
        break;
      case 'IPC':
        prefixStyle = 'color: #f59e0b; font-weight: bold;'; // Amber
        break;
      case 'WS':
      case 'WS][RX':
      case 'WS][TX':
        prefixStyle = 'color: #ec4899; font-weight: bold;'; // Pink
        break;
      case 'AGENT':
        prefixStyle = 'color: #8b5cf6; font-weight: bold;'; // Violet
        break;
      case 'NETWORK':
        prefixStyle = 'color: #14b8a6; font-weight: bold;'; // Teal
        break;
      case 'DISCOVERY':
        prefixStyle = 'color: #a855f7; font-weight: bold;'; // Purple
        break;
      case 'ONVIF':
        prefixStyle = 'color: #d946ef; font-weight: bold;'; // Fuchsia
        break;
      case 'RTSP':
        prefixStyle = 'color: #f43f5e; font-weight: bold;'; // Rose
        break;
      case 'CAMERA':
        prefixStyle = 'color: #06b6d4; font-weight: bold;'; // Light Cyan
        break;
      case 'ERROR':
        prefixStyle = 'color: #ef4444; font-weight: bold;'; // Red
        break;
    }

    return { prefixStyle, msgStyle };
  }

  private sanitizeUrl(url: string): string {
    if (!url) return '';
    return url.replace(/rtsp:\/\/([^:]+):([^@]+)@/, (_, user) => {
      return `rtsp://${user}:***@`;
    });
  }

  info(prefix: string, message: string, correlationId: string = '') {
    const time = this.formatTime();
    const cleanMsg = this.sanitizeUrl(message);
    const corrStr = correlationId ? `[${correlationId}]` : '';
    const { prefixStyle, msgStyle } = this.getStyles(prefix);

    console.log(
      `%c[${time}] %c[${prefix}]%c${corrStr} %c${cleanMsg}`,
      'color: #71717a;', // Muted Gray for timestamp
      prefixStyle,
      'color: #94a3b8; font-weight: bold;', // Correlation ID style
      msgStyle
    );
  }

  warn(prefix: string, message: string, correlationId: string = '') {
    const time = this.formatTime();
    const cleanMsg = this.sanitizeUrl(message);
    const corrStr = correlationId ? `[${correlationId}]` : '';
    console.warn(
      `%c[${time}] %c[${prefix}]%c${corrStr} ⚠️ %c${cleanMsg}`,
      'color: #71717a;',
      'color: #f59e0b; font-weight: bold;',
      'color: #94a3b8; font-weight: bold;',
      'color: #fbbf24;'
    );
  }

  error(prefix: string, message: string, err: any = null, correlationId: string = '') {
    const time = this.formatTime();
    let cleanMsg = this.sanitizeUrl(message);
    if (err) {
      cleanMsg += ` - Error: ${err.message || err}`;
    }
    const corrStr = correlationId ? `[${correlationId}]` : '';

    console.error(
      `%c[${time}] %c[ERROR][${prefix}]%c${corrStr} %c${cleanMsg}`,
      'color: #71717a;',
      'color: #ef4444; font-weight: bold;',
      'color: #f87171; font-weight: bold;',
      'color: #fca5a5;'
    );
  }

  debug(prefix: string, message: string, correlationId: string = '') {
    const time = this.formatTime();
    const cleanMsg = this.sanitizeUrl(message);
    const corrStr = correlationId ? `[${correlationId}]` : '';
    console.debug(
      `%c[${time}] %c[DEBUG][${prefix}]%c${corrStr} %c${cleanMsg}`,
      'color: #71717a;',
      'color: #94a3b8; font-style: italic;',
      'color: #cbd5e1;',
      'color: #cbd5e1;'
    );
  }
}

export const logger = new FrontendLogger();
