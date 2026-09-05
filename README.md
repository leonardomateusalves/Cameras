# 🧠 NEXUS RTSP MONITOR // Estação de Câmeras de Segurança para Windows (Electron + Go2RTC + WebRTC)

Um aplicativo desktop para Windows desenvolvido em **Electron**, **React** e **Node.js**, projetado para conectar, decodificar e monitorar múltiplos streams **RTSP** de câmeras IP / CFTV com conversão de vídeo via **Go2RTC** para **WebRTC** e interface cibernética adaptativa.

---

## 📁 Estrutura do Projeto

```
/nexus-rtsp-monitor
├── backend/
│   ├── app.js               # Servidor Express do Agente Local: gerenciamento de câmeras, criptografia e proxy WebRTC
│   ├── server.js            # Runner independente do servidor Express
│   └── config.json          # Armazenamento seguro criptografado (AES-256-GCM) de câmeras e configurações
│
├── bin/
│   ├── go2rtc.exe           # Binário empacotado do Go2RTC para transcodificação RTSP -> WebRTC
│   └── go2rtc.yaml          # Configuração restrita a loopback (127.0.0.1) gerada no runtime
│
├── src/                     # Interface do usuário em React 19 + TypeScript + Tailwind CSS
│   ├── api/cameras.ts       # Cliente de integração com o Local Agent e Electron IPC
│   ├── components/          # Componentes de UI, Grade de Vídeo e Player WebRTC (RTCPeerConnection)
│   └── main.tsx             # Entrypoint da aplicação React
│
├── main.js                  # Processo principal do Electron (Lifecycle, Janelas e IPC)
├── preload.js               # Ponte segura de IPC (ContextBridge com contextIsolation e webSecurity)
├── package.json             # Dependências, scripts de inicialização e build do Electron Builder
└── docs/
    └── RELATORIO-IMPLEMENTACAO.md # Documentação e relatório técnico detalhado
```

---

## 🚀 Como Executar em Desenvolvimento

1. **Instale as dependências:**
   ```bash
   npm install
   ```

2. **Inicie o ambiente de desenvolvimento:**
   ```bash
   npm run dev
   ```

3. **Inicie a janela do Electron:**
   ```bash
   npm run electron:start
   ```

---

## 📦 Como Empacotar em Instalador Windows (.exe) com `electron-builder`

O projeto está configurado com **electron-builder** para gerar executáveis para Windows x64.

### 1. Comando de Build
Execute no terminal:
```bash
# Compilar a interface React e gerar os bundles em dist/
npm run build

# Empacotar o instalador do Windows
npm run dist:win
```

### 2. O que será gerado?
Ao concluir a compilação, você encontrará dentro da pasta `/dist`:
- **Instalador NSIS:** `Nexus RTSP Monitor Setup 2.4.0.exe` (instalador padrão do Windows com assistente de instalação e atalhos).
- **Versão Portátil (Portable):** `Nexus RTSP Monitor Portable 2.4.0.exe` (executável direto).

---

## 🎥 Formatos de URLs RTSP das Principais Marcas de Câmeras

Utilize o botão **"+ ADICIONAR CÂMERA"** dentro do aplicativo para busca automática ONVIF ou cadastro manual:

| Fabricante | Exemplo de URL RTSP |
|---|---|
| **Intelbras** | `rtsp://admin:senha@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0` |
| **Hikvision** | `rtsp://admin:senha@192.168.1.64:554/Streaming/Channels/101` |
| **Dahua** | `rtsp://admin:senha@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0` |
| **TP-Link Tapo** | `rtsp://usuario:senha@192.168.1.50:554/stream1` |
| **Genérica ONVIF** | `rtsp://usuario:senha@192.168.1.100:554/live/ch0` |

---

## ⚡ Como funciona o Streaming WebRTC via Go2RTC

O aplicativo utiliza o **Go2RTC** integrado ao **Local Agent (Express)** no Windows:
- **Zero instalações externas:** O binário `go2rtc.exe` é iniciado de forma transparente embutido no aplicativo.
- **Isolamento de Rede:** Portas administrativas e de mídia do Go2RTC são restritas exclusivamente a `127.0.0.1`.
- **Sinalização SDP Nativa:** O frontend negocia o handshake SDP através do endpoint `/api/webrtc`, estabelecendo uma conexão via `RTCPeerConnection` (*Implementado — Pendente de validação com câmeras físicas em LAN*).
- **Criptografia e Proteção de Dados:** Credenciais de câmeras são criptografadas via AES-256-GCM em `config.json` e nunca são expostas em texto puro.

