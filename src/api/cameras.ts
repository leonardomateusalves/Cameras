import { CameraStream } from '../types';
import { logger } from '../utils/logger';

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      discoverCameras: () => Promise<any>;
      getCameras: (tenantId?: string) => Promise<any>;
      addCamera: (camData: any) => Promise<any>;
      testCamera: (rtspUrl: string) => Promise<any>;
      removeCamera: (id: string) => Promise<any>;
      getGo2RtcStatus: () => Promise<any>;
      sendWebrtcSdp?: (streamId: string, sdp: string) => Promise<any>;
      getDiscoveryStatus?: () => Promise<any>;
    };
  }
}

// Central API Base path using relative URL to support same-origin fullstack Express server
const getApiBase = () => '/api/cameras';

export interface HealthStatus {
  online: boolean;
  service?: string;
  go2rtcOnline?: boolean;
  camerasCount?: number;
  error?: string;
}

/**
 * Health check real do Agente Local / Backend Express
 */
export async function checkHealth(): Promise<HealthStatus> {
  const correlationId = 'HEALTH-CHK';
  if (window.electronAPI?.getGo2RtcStatus) {
    logger.info('IPC', 'Invocando getGo2RtcStatus no processo principal', correlationId);
    try {
      const status = await window.electronAPI.getGo2RtcStatus();
      logger.info('IPC', `getGo2RtcStatus retornado com sucesso: online=${status.online}`, correlationId);
      return { online: true, service: 'electron-main', go2rtcOnline: status.online };
    } catch (e: any) {
      logger.error('IPC', 'Falha ao obter status do Go2RTC via IPC', e, correlationId);
      return { online: false, error: 'Agente Windows não conectado' };
    }
  }

  try {
    logger.info('API', 'GET /api/health', correlationId);
    const res = await fetch('/api/health');
    logger.info('API', `GET /api/health - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      logger.error('API', `Request falhou com status ${res.status}`, null, correlationId);
      return {
        online: false,
        error: 'Windows Local Agent não conectado.'
      };
    }
    const data = await res.json();
    return {
      online: data.status === 'ok',
      service: 'web-backend',
      go2rtcOnline: true,
      camerasCount: 0
    };
  } catch (err: any) {
    logger.error('API', 'Request to GET /api/health failed with "Failed to fetch"', err, correlationId);
    logger.warn('API', 'Possíveis causas: Backend offline, conexão recusada, timeout do agente ou bloqueio de CORS.', correlationId);
    return {
      online: false,
      error: 'Windows Local Agent não conectado.'
    };
  }
}

export async function discoverCameras() {
  const correlationId = 'ONVIF-DISC';
  if (window.electronAPI?.discoverCameras) {
    logger.info('IPC', 'Invocando discoverCameras no processo principal', correlationId);
    return window.electronAPI.discoverCameras();
  }
  
  try {
    logger.info('API', `POST ${getApiBase()}/discover`, correlationId);
    const res = await fetch(`${getApiBase()}/discover`, { method: 'POST' });
    logger.info('API', `POST ${getApiBase()}/discover - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      logger.error('API', `POST ${getApiBase()}/discover falhou`, errData.error, correlationId);
      throw new Error(errData.error || 'Falha na varredura ONVIF.');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `POST ${getApiBase()}/discover - Erro na rede`, err, correlationId);
    logger.warn('API', 'Dica: Verifique se o agente local está rodando e aceitando conexões HTTP.', correlationId);
    throw err;
  }
}

export async function discoverCamerasFull() {
  const correlationId = 'ONVIF-FULL';
  let targetUrl = `${getApiBase()}/discover/full`;
  if (window.electronAPI) {
    targetUrl = `http://127.0.0.1:8080/api/cameras/discover/full`;
  }

  try {
    logger.info('API', `POST ${targetUrl}`, correlationId);
    const res = await fetch(targetUrl, { method: 'POST' });
    logger.info('API', `POST ${targetUrl} - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      logger.error('API', `POST ${targetUrl} falhou`, errData.error, correlationId);
      throw new Error(errData.error || 'Falha na varredura profunda.');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `POST ${targetUrl} - Erro na rede`, err, correlationId);
    throw err;
  }
}

export async function testCamera(rtspUrl: string) {
  const correlationId = 'RTSP-TEST';
  if (window.electronAPI?.testCamera) {
    logger.info('IPC', `Invocando testCamera via IPC para URL: ${rtspUrl}`, correlationId);
    return window.electronAPI.testCamera(rtspUrl);
  }

  try {
    logger.info('API', `POST ${getApiBase()}/test`, correlationId);
    const res = await fetch(`${getApiBase()}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rtspUrl })
    });
    logger.info('API', `POST ${getApiBase()}/test - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      logger.error('API', 'POST /test falhou', errData.message, correlationId);
      return { success: false, status: 'RTSP_ERROR', message: errData.message || 'Falha ao testar stream RTSP' };
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `POST ${getApiBase()}/test - Erro de rede`, err, correlationId);
    return { success: false, status: 'RTSP_NETWORK_ERROR', message: `Failed to fetch: ${err.message}` };
  }
}

export async function addCamera(camData: Partial<CameraStream>) {
  const correlationId = 'CAM-ADD';
  if (window.electronAPI?.addCamera) {
    logger.info('IPC', 'Invocando addCamera via IPC', correlationId);
    return window.electronAPI.addCamera(camData);
  }

  try {
    logger.info('API', `POST ${getApiBase()}`, correlationId);
    const res = await fetch(getApiBase(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(camData)
    });
    logger.info('API', `POST ${getApiBase()} - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      logger.error('API', 'POST cadastrar câmera falhou', errData.error, correlationId);
      throw new Error(errData.error || 'Erro ao salvar câmera no servidor local.');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `POST ${getApiBase()} - Erro de rede`, err, correlationId);
    throw err;
  }
}

export async function fetchCameras(tenantId = 'tenant_default') {
  const correlationId = 'CAM-FETCH';
  if (window.electronAPI?.getCameras) {
    logger.info('IPC', `Invocando getCameras via IPC para tenant: ${tenantId}`, correlationId);
    return window.electronAPI.getCameras(tenantId);
  }

  try {
    const url = `${getApiBase()}?tenantId=${encodeURIComponent(tenantId)}`;
    logger.info('API', `GET ${url}`, correlationId);
    const res = await fetch(url);
    logger.info('API', `GET ${getApiBase()} - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      logger.error('API', 'GET carregar câmeras falhou', null, correlationId);
      throw new Error('Erro ao carregar lista de câmeras.');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `GET ${getApiBase()} - Erro de rede`, err, correlationId);
    throw err;
  }
}

export async function deleteCamera(id: string) {
  const correlationId = 'CAM-DEL';
  if (window.electronAPI?.removeCamera) {
    logger.info('IPC', `Invocando removeCamera via IPC para ID: ${id}`, correlationId);
    return window.electronAPI.removeCamera(id);
  }

  try {
    const url = `${getApiBase()}/${encodeURIComponent(id)}`;
    logger.info('API', `DELETE ${url}`, correlationId);
    const res = await fetch(url, { method: 'DELETE' });
    logger.info('API', `DELETE ${url} - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      logger.error('API', 'DELETE remover câmera falhou', null, correlationId);
      throw new Error('Erro ao remover câmera.');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', `DELETE /api/cameras/${id} - Erro de rede`, err, correlationId);
    throw err;
  }
}

export async function getDiscoveryStatus() {
  const correlationId = 'DISC-STATUS';
  if (window.electronAPI?.getDiscoveryStatus) {
    logger.info('IPC', 'Invocando getDiscoveryStatus via IPC', correlationId);
    return window.electronAPI.getDiscoveryStatus();
  }

  try {
    logger.info('API', 'GET /api/discovery-status', correlationId);
    const res = await fetch('/api/discovery-status');
    logger.info('API', `GET /api/discovery-status - Status: ${res.status}`, correlationId);
    if (!res.ok) {
      logger.error('API', 'GET status de descoberta falhou', null, correlationId);
      throw new Error('Falha ao obter status de descoberta');
    }
    return res.json();
  } catch (err: any) {
    logger.error('API', 'GET /api/discovery-status - Erro de rede', err, correlationId);
    throw err;
  }
}
