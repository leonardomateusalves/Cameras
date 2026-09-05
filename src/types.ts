/**
 * Tipos compartilhados da Estação de Monitoramento RTSP
 */

export interface CameraStream {
  id: string;
  tenantId?: string;
  name: string;
  location: string;
  rtspUrl: string;
  rtspUrlSafe?: string;
  streamId?: string;
  streamUrl?: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'reconnecting' | 'STREAMING' | 'OFFLINE' | 'CONNECTING' | 'AUTH_ERROR' | 'RTSP_ERROR' | 'WEBRTC_ERROR';
  resolution: string;
  fps: number;
  bitrateKbps: number;
  ptzEnabled: boolean;
  recording: boolean;
  transport: 'tcp' | 'udp';
}

export interface CameraSnapshot {
  id: string;
  cameraId: string;
  cameraName: string;
  timestamp: string;
  dataUrl: string;
}

export interface TacticalLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  source: string;
  message: string;
}

export type GridLayout = '1x1' | '2x2' | '3x3' | '4x4';
