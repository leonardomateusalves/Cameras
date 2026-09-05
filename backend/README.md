# 🚀 Backend RTSP Monitor para Google Cloud Run

Backend em Node.js com FFmpeg para converter fluxos RTSP de câmeras de segurança em HLS e WebSocket, pronto para deploy no Google Cloud Run.

---

## 📋 Funcionalidades

1. **Streaming On-Demand (Scale to Zero - Sem Custos Extras)**
   - O FFmpeg só é ativado quando o frontend ou player requisita uma câmera.
   - Quando todos os clientes param de assistir, o stream é encerrado automaticamente após 45 segundos de inatividade.
   - O Cloud Run desliga o container ocioso (0 instâncias), garantindo custo zero quando não houver monitoramento.

2. **Endpoints HTTP Diretos**
   - `GET /stream/:camId` (ex: `/stream/camera1`) -> Retorna o stream HLS diretamente para o frontend Electron.
   - `GET /stream/:camId/index.m3u8` -> Manifesto HLS de baixa latência.
   - `GET /stream/:camId/segment_001.ts` -> Segmentos de vídeo.
   - `WS /ws/:camId` -> Stream via WebSocket MPEG-TS direto.
   - `GET /health` -> Healthcheck do Cloud Run.
   - `GET /api/cameras` -> Lista todas as câmeras configuradas e seus status.

3. **Consumo de CPU Mínimo (<2%)**
   - Usa modo direct passthrough (`-c:v copy`) quando o vídeo da câmera já é H.264 (padrão de câmeras Intelbras, Hikvision, Dahua, Tapo).
   - Armazena arquivos temporários em `/tmp/streams` (tmpfs em memória RAM do Cloud Run), sem necessidade de volumes de disco.

---

## 🛠️ Como Fazer o Deploy no Google Cloud Run

### Pré-requisitos
- Ter o Google Cloud CLI (`gcloud`) instalado ou usar o Cloud Shell do Google Cloud Console.

### Passo a Passo

1. **Navegue até a pasta do backend:**
   ```bash
   cd backend
   ```

2. **Faça o deploy direto do código-fonte:**
   ```bash
   gcloud run deploy rtsp-backend \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --port 8080 \
     --memory 512Mi \
     --cpu 1 \
     --min-instances 0 \
     --max-instances 2
   ```

   *Parâmetros recomendados:*
   - `--min-instances 0`: Permite que o Cloud Run escale até zero quando não houver tráfego (sem custo fixo).
   - `--memory 512Mi`: Mais que suficiente para Node.js + FFmpeg em modo passthrough.
   - `--cpu 1`: 1 vCPU alocada durante o processamento de requisições.

3. **Configuração das URLs RTSP:**
   - Você pode editar o `config.json` antes de fazer o deploy.
   - Ou injetar via variável de ambiente no Cloud Run:
     ```bash
     gcloud run services update rtsp-backend \
       --set-env-vars CAMERAS_CONFIG='{"cameras":[{"id":"camera1","rtspUrl":"rtsp://seu-ip:554/live"}]}'
     ```

4. **Consumir no Frontend Electron:**
   Substitua as URLs das câmeras no frontend pela URL gerada pelo Cloud Run:
   ```
   https://rtsp-backend-xyz.a.run.app/stream/camera1
   ```
