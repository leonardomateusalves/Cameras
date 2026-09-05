import { CameraStream } from '../types';

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
  if (window.electronAPI?.getGo2RtcStatus) {
    try {
      const status = await window.electronAPI.getGo2RtcStatus();
      return { online: true, service: 'electron-main', go2rtcOnline: status.online };
    } catch (e: any) {
      return { online: false, error: 'Agente Windows não conectado' };
    }
  }

  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      return {
        online: false,
        error: 'Windows Local Agent não conectado. Para descobrir e acessar câmeras da rede local, instale e execute o aplicativo Windows.'
      };
    }
    const data = await res.json();
    return {
      online: data.status === 'online',
      service: data.service,
      go2rtcOnline: data.go2rtcOnline,
      camerasCount: data.camerasCount
    };
  } catch (err: any) {
    return {
      online: false,
      error: 'Windows Local Agent não conectado. Para descobrir e acessar câmeras da rede local, instale e execute o aplicativo Windows.'
    };
  }
}

export async function discoverCameras() {
  if (window.electronAPI?.discoverCameras) {
    return window.electronAPI.discoverCameras();
  }
  const res = await fetch(`${getApiBase()}/discover`, { method: 'POST' });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Falha na varredura ONVIF. Verifique se o agente local está rodando.');
  }
  return res.json();
}

export async function testCamera(rtspUrl: string) {
  if (window.electronAPI?.testCamera) {
    return window.electronAPI.testCamera(rtspUrl);
  }
  const res = await fetch(`${getApiBase()}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rtspUrl })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    return { success: false, status: 'RTSP_ERROR', message: errData.message || 'Falha ao testar stream RTSP' };
  }
  return res.json();
}

export async function addCamera(camData: Partial<CameraStream>) {
  if (window.electronAPI?.addCamera) {
    return window.electronAPI.addCamera(camData);
  }
  const res = await fetch(getApiBase(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(camData)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Erro ao salvar câmera no servidor local.');
  }
  return res.json();
}

export async function fetchCameras(tenantId = 'tenant_default') {
  if (window.electronAPI?.getCameras) {
    return window.electronAPI.getCameras(tenantId);
  }
  const res = await fetch(`${getApiBase()}?tenantId=${encodeURIComponent(tenantId)}`);
  if (!res.ok) {
    throw new Error('Erro ao carregar lista de câmeras. Verifique se o agente local está disponível.');
  }
  return res.json();
}

export async function deleteCamera(id: string) {
  if (window.electronAPI?.removeCamera) {
    return window.electronAPI.removeCamera(id);
  }
  const res = await fetch(`${getApiBase()}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error('Erro ao remover câmera.');
  }
  return res.json();
}
