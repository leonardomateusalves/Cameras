# Cliente WebRTC (Frontend / Navegador)

Este documento descreve como o navegador recebe o stream via WebSockets/MediaSource e exibe os logs.

## 2. Código do Navegador (HTML + JS)

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Visualizador RTSP P2P (WebRTC/MSE)</title>
    <style>
        body { background-color: #09090b; color: #fff; font-family: monospace; }
        video { width: 800px; max-width: 100%; border: 2px solid #06b6d4; }
        #logs { margin-top: 20px; background: #000; padding: 10px; height: 300px; overflow-y: scroll; border: 1px solid #333; }
        .log-info { color: #a1a1aa; }
        .log-success { color: #4ade80; }
        .log-error { color: #f87171; }
    </style>
</head>
<body>
    <h2>Monitor de Câmera (Sinalização WS)</h2>
    <video id="video-player" autoplay muted playsinline></video>
    
    <div id="logs"></div>

    <script>
        const video = document.getElementById('video-player');
        const logsDiv = document.getElementById('logs');
        
        function addLog(msg, type = 'info') {
            const div = document.createElement('div');
            div.className = `log-${type}`;
            div.innerText = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logsDiv.appendChild(div);
            logsDiv.scrollTop = logsDiv.scrollHeight;
            console.log(`[${type.toUpperCase()}]`, msg);
        }

        // Conexão de Sinalização
        const ws = new WebSocket('ws://localhost:4000');
        
        // Media Source Extensions para receber o stream FFmpeg ao vivo
        const mediaSource = new MediaSource();
        video.src = URL.createObjectURL(mediaSource);
        let sourceBuffer = null;

        mediaSource.addEventListener('sourceopen', () => {
            addLog('MediaSource Aberto, preparando codec', 'success');
            // Dependendo do output do FFmpeg, o codec deve ser compatível
            sourceBuffer = mediaSource.addSourceBuffer('video/mp4; codecs="avc1.42E01E"');
        });

        ws.onopen = () => {
            addLog('WebSocket Conectado. Sinalização Pronta.', 'success');
            ws.send(JSON.stringify({ type: 'join' }));
        };

        ws.onmessage = (event) => {
            if (typeof event.data === 'string') {
                const data = JSON.parse(event.data);
                if (data.type === 'error') {
                    addLog('Erro reportado pelo backend: ' + data.message, 'error');
                } else if (data.type === 'ice-candidate') {
                    addLog('Recebido ICE Candidate (STUN/TURN)', 'info');
                } else if (data.type === 'sdp-offer') {
                    addLog('Recebido SDP Offer, gerando Answer...', 'info');
                }
            } else if (event.data instanceof Blob) {
                // Buffer de vídeo binário recebido
                if (sourceBuffer && !sourceBuffer.updating) {
                    event.data.arrayBuffer().then(buffer => {
                        try {
                            sourceBuffer.appendBuffer(buffer);
                        } catch (e) {
                            addLog('Erro ao fazer append do buffer de vídeo: ' + e.message, 'error');
                        }
                    });
                }
            }
        };

        ws.onclose = () => {
            addLog('WebSocket Desconectado. Câmera Inacessível.', 'error');
        };
        
        ws.onerror = (err) => {
            addLog('Falha grave de rede / WebSocket Error', 'error');
        };
    </script>
</body>
</html>
```

## Como Testar no seu Computador (Windows)

1. **Instale o Node.js** (https://nodejs.org).
2. **Instale o FFmpeg** no Windows (Baixe em gyan.dev/ffmpeg/builds, extraia, e adicione a pasta `bin` nas Variáveis de Ambiente do Windows).
3. Salve o código de Backend como `server.js`.
4. Abra o terminal na pasta e instale os pacotes: `npm install express ws fluent-ffmpeg`
5. Rode o servidor: `node server.js`
6. Salve o arquivo HTML como `index.html` e abra-o no Chrome.
7. O vídeo será reproduzido no navegador com latência ultrabaixa e todos os logs detalhados aparecerão tanto no prompt de comando (backend) quanto no HTML/DevTools (frontend).
