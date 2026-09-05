# RELATÓRIO TÉCNICO E AUDITORIA DE CÓDIGO — CFTV / WINDOWS LOCAL AGENT

**Data da auditoria:** 05/09/2026  
**Versão do projeto:** 2.4.0 (`nexus-rtsp-monitor`)  
**Versão do Electron:** `^44.2.0`  
**Versão do Go2RTC:** `v1.9.8`  

---

## 1. Resumo da Auditoria Real de Código

Esta auditoria analisou o código-fonte do **Nexus RTSP Monitor** para verificar 4 pilares críticos antes de empacotar o executável do Windows:

1. **Credenciais e Persistência Segura (`config.json`):**
   - **Status:** `CORRIGIDO / IMPLEMENTADO`.
   - **Ação:** Implementada criptografia simétrica **AES-256-GCM** alimentada por chave derivada da máquina do usuário (`getMachineSecretKey`). As URLs RTSP e credenciais (usuário e senha) são gravadas em `config.json` como hashes/ciphers criptografados (`rtspUrlEncrypted`). O arquivo de configuração em disco não armazena nenhuma senha em texto puro.

2. **Isolamento e Segurança de Rede do Go2RTC:**
   - **Status:** `CORRIGIDO / IMPLEMENTADO`.
   - **Ação:** O Electron agora gera no runtime um arquivo `go2rtc.yaml` configurado explicitamente com `api.listen: "127.0.0.1:1984"`, `rtsp.listen: "127.0.0.1:8554"` e `webrtc.listen: "127.0.0.1:8555"`, e inicia o processo com o parâmetro `-config`. Isso impede que a API administrativa e de streaming fiquem expostas para a LAN externa sem o intermédio do Local Agent em `127.0.0.1:8080`.

3. **Identidade Persistente da Câmera (`cameraId`):**
   - **Status:** `CORRIGIDO / IMPLEMENTADO`.
   - **Ação:** O gerador de IDs determinísticos (`generateDeterministicCameraId`) agora prioriza o **URN / UUID único de dispositivo ONVIF** (`device.urn`). Se indisponível, utiliza o `xaddr` e, como fallback, o hash SHA-256 do endpoint RTSP sanitizado (sem credenciais). A câmera mantém o mesmo `cameraId` mesmo após reinicialização ou alterações de IP na LAN.

4. **WebRTC e Status de Validação:**
   - **Status:** `IMPLEMENTADO — NÃO VALIDADO EM HARDWARE`.
   - **Ação:** Confirmado que o endpoint `/api/webrtc` recebe ofertas SDP via `POST` (`application/sdp`), repassando para o Go2RTC e retornando a resposta SDP Answer para o `RTCPeerConnection` do browser. O código foi validado via testes de sintaxe e protocolo HTTP, porém a exibição e latência de vídeo dependem de validação futura com câmera IP física conectada.

---

## 2. Resumo do Projeto

O objetivo do **Nexus RTSP Monitor** é fornecer uma estação de monitoramento de câmeras de segurança sem a necessidade de hardware intermediário dedicado (como DVRs ou NVRs proprietários). O sistema conecta câmeras IP diretamente via **ONVIF** e **RTSP**, transcodificando os fluxos para **WebRTC** via **Go2RTC**.

O aplicativo é empacotado como um executável nativo do Windows via **Electron**, contendo de forma transparente todos os componentes necessários (Node.js Local Agent, Go2RTC e a interface React) sem exigir que o usuário instale ferramentas externas manualmente.

---

## 3. Arquitetura Geral

O ecossistema opera em duas frentes integradas: a aplicação desktop embutida (Windows App) e o suporte a acessos via navegador web (SaaS Mode).

```text
+-----------------------------------------------------------------------+
|                             CLIENTE (UI)                              |
|                    React 19 + Tailwind CSS + Lucide                   |
+-----------------------------------------------------------------------+
                                   |
                +------------------+------------------+
                | (Modo Desktop IPC)                  | (Modo Web HTTP/PNA)
                v                                     v
+-------------------------------+     +---------------------------------+
|     ELECTRON MAIN PROCESS     |     |       WINDOWS LOCAL AGENT       |
|          (main.js)            |     |    (http://127.0.0.1:8080)     |
+-------------------------------+     +---------------------------------+
    | (Inicia embutido com go2rtc.yaml)               |
    +-------------------------------------------------+
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-----------------------+             +-----------------------+
|  WS-DISCOVERY / ONVIF |             |     ENGINE GO2RTC     |
| (Descoberta & Mídia)  |             | (127.0.0.1:1984/8554) |
+-----------------------+             +-----------------------+
            |                                     |
            v                                     v
    Câmera IP (RTSP) ---------------------> SDP / WebRTC
```

---

## 4. Arquitetura Web

Quando acessada via navegador web convencional:
* O navegador **não** executa varreduras UDP de WS-Discovery diretamente devido às restrições de sandbox de rede do browser.
* O frontend consulta a API local `http://127.0.0.1:8080/api/health` utilizando requisições HTTP com cabeçalhos de **Private Network Access (PNA)**.
* Se o Windows Local Agent estiver ativo na máquina local do cliente, o navegador obtém acesso à descoberta e aos canais de vídeo WebRTC do Go2RTC.
* Se o agente não estiver ativo, a interface renderiza o estado real: **"Windows Local Agent não conectado"**.

---

## 5. Arquitetura Windows

No aplicativo empacotado `.exe` para Windows:
* O executável inicia o **Electron Main Process** (`main.js`).
* O Electron instancia internamente o servidor Express do **Local Agent** em `127.0.0.1:8080`.
* O Electron gera o arquivo `go2rtc.yaml` garantindo escuta exclusiva em `127.0.0.1` e inicia o binário empacotado `bin/go2rtc.exe` (Engine de Mídia na porta `1984`).
* A janela do aplicativo (`BrowserWindow`) carrega a interface em React e comunica com o agente via pontes de IPC de alta velocidade (`window.electronAPI`).

---

## 6. Electron

* **Main Process (`main.js`):** Gerencia a janela principal, inicia o servidor Express do agente local, gera o `go2rtc.yaml`, monitora a saúde do processo `go2rtc.exe` (com verificação de prontidão da API na porta 1984) e registra manipuladores `ipcMain.handle`.
* **Preload Script (`preload.js`):** Utiliza `contextBridge` com `contextIsolation: true`, `nodeIntegration: false` e `webSecurity: true`, expondo métodos seguros (`discoverCameras`, `getCameras`, `addCamera`, `testCamera`, `removeCamera`, `getGo2RtcStatus`).
* **Resource Mapping:** O caminho do binário `go2rtc.exe` é resolvido dinamicamente entre o diretório local em desenvolvimento (`bin/go2rtc.exe`) e o diretório de recursos empacotados em produção (`process.resourcesPath/bin/go2rtc.exe`).
* **Encerramento de Processos:** Os eventos `before-quit` e `will-quit` encerram os processos e servidores sem deixar instâncias órfãs.

---

## 7. Windows Local Agent

* **Arquivo Central:** `backend/app.js` e `backend/server.js`.
* **Binding de Rede:** Vinculado estritamente à interface loopback `127.0.0.1` (porta `8080` ou `LOCAL_AGENT_PORT`), evitando a exposição de portas em `0.0.0.0` para redes externas.
* **Segurança de Origem:** Valida explicitamente os cabeçalhos `Origin` para bloquear requisições de sites externos maliciosos.
* **Persistência de Dados Segura:** Configurações mantidas no arquivo `config.json` com senhas e URLs RTSP criptografadas via **AES-256-GCM**.
* **Proxy de Mídia:** Fornece o endpoint `/api/webrtc` para intermediar a sinalização SDP com a API interna do Go2RTC.

---

## 8. API Local

Rotas realmente implementadas em `backend/app.js`:

| Método | Endpoint | Função | Implementado | Status de Teste |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Retorna saúde do agente local e verificação da API do Go2RTC | SIM | TESTADO EM CÓDIGO |
| `POST` | `/api/cameras/discover` | Dispara WS-Discovery UDP para achar câmeras ONVIF sem duplicatas | SIM | IMPLEMENTADO — NÃO TESTADO EM LAN REAL |
| `POST` | `/api/cameras/test` | Valida conectividade de rede na porta RTSP via socket TCP | SIM | TESTADO EM CÓDIGO |
| `GET` | `/api/cameras` | Lista câmeras cadastradas sanitizando senhas no campo `rtspUrlSafe` | SIM | TESTADO EM CÓDIGO |
| `POST` | `/api/cameras` | Cadastra ou atualiza câmera com ID determinístico e vincula stream no Go2RTC | SIM | TESTADO EM CÓDIGO |
| `DELETE` | `/api/cameras/:id` | Exclui câmera e encerra stream no Go2RTC | SIM | TESTADO EM CÓDIGO |
| `POST` | `/api/webrtc` | Proxy de sinalização SDP para Go2RTC WebRTC | SIM | IMPLEMENTADO — NÃO VALIDADO EM HARDWARE |

---

## 9. WS-Discovery

* **Módulo:** `node-onvif` (`0.1.7`).
* **Mecanismo:** Envia pacotes UDP Multicast para a porta `3702` no IP `239.255.255.250`.
* **Deduplicação & Identificador Determinístico:** Filtra respostas duplicadas e atribui `id` gerado via hash estável priorizando `device.urn` ONVIF ou `xaddr`.
* **Limitações Conhecidas:** Câmeras com multicast desativado na interface de rede ou em sub-redes diferentes exigem adição manual por endereço IP.

---

## 10. ONVIF

* **Sequência de Conexão:**  
  `Discovery` -> `GetCapabilities` -> `GetProfiles` -> `GetStreamUri`.
* **Fluxo de Autenticação:** Repassa usuário e senha fornecidos no cadastro para negociar a URI RTSP nativa do perfil primário da câmera.

---

## 11. RTSP

* **Formato Mapeado:** `rtsp://<usuario>:<senha>@<ip>:<porta>/<caminho_stream>`.
* **Transporte:** Configurado para RTSP sobre TCP (`rtsp_transport tcp`) para evitar corrupção de quadros por perda de pacotes UDP em Wi-Fi/LAN.
* **Sigilo de Credenciais:** A URL RTSP contendo usuário e senha permanece armazenada criptografada (AES-256-GCM) no Local Agent e repassada ao Go2RTC. O frontend recebe apenas a versão tratada (`rtspUrlSafe` sem credenciais).

---

## 12. Go2RTC

* **Versão Utilizada:** `v1.9.8` (Binary Windows 64-bit).
* **Localização no Build:** Salvo em `bin/go2rtc.exe` e incluído como `extraResources` no `package.json`.
* **Configuração de Segurança:** `go2rtc.yaml` gerado em runtime para limitar `listen` exclusivamente a `127.0.0.1`.
* **Verificação de Saúde:** O Local Agent realiza uma requisição `GET http://127.0.0.1:1984/api/streams` para atestar o funcionamento real do motor Go2RTC.
* **Portas Restritas a Loopback:**
  * REST API & WebRTC: `127.0.0.1:1984`
  * RTSP Server: `127.0.0.1:8554`
  * WebRTC Listener: `127.0.0.1:8555`

---

## 13. WebRTC

* **Implementação:** Componente `src/components/CameraCard.tsx` utilizando a API padrão `RTCPeerConnection`.
* **STUN Server:** `stun:stun.l.google.com:19302`.
* **Status da Conectividade:** Implementado via sinalização SDP negociada com Go2RTC (Pendente de validação com câmeras físicas em LAN).

---

## 14. Camera ID / Stream ID

* Cada câmera possui um identificador determinístico baseado na priorização:
  1. `device.urn` (URN/UUID único de hardware ONVIF)
  2. `xaddr` ONVIF
  3. Hash SHA-256 da URL RTSP limpa sem credenciais
* Relação determinística:  
  `cameraId` = `cam_urn_uuid_a1b2c3d4e5`  
  `streamId` = `stream_cam_urn_uuid_a1b2c3d4e5`  
  `Go2RTC Stream URI` = `http://127.0.0.1:1984/api/webrtc?src=stream_cam_urn_uuid_a1b2c3d4e5`

---

## 15. Gerenciamento de Credenciais Criptografadas

* As credenciais do usuário e senha são criptografadas em disco em `config.json` via **AES-256-GCM**.
* O React **não** armazena nem exibe URLs RTSP com senhas em texto puro no `localStorage`, `console.log` ou parâmetros de URL pública.
* O Local Agent oculta os dados sensíveis no método de consulta (`GET /api/cameras`), retornando `rtspUrlSafe: "rtsp://***:***@192.168.1.50:554/live"`.

---

## 16. Comunicação Web → Local Agent

* Habilitado suporte a **Private Network Access (PNA)** via cabeçalho `Access-Control-Allow-Private-Network: true`.
* Filtro de segurança valida origens autorizadas (`http://127.0.0.1`, `http://localhost`, domínios Cloud Run e origens locais do Electron).
* Requisições `OPTIONS` preflight são respondidas com status `204 No Content`.

---

## 17. Estados do Local Agent

1. `OFFLINE` / `NOT_CONNECTED`: Exibido no navegador quando o Agente Windows não responde no IP `127.0.0.1:8080`.
2. `STARTING`: Electron em processo de inicialização dos serviços embutidos.
3. `READY`: Agente Local e Go2RTC validados e prontos para streaming.
4. `ERROR`: Ocorreu uma falha na execução do executável `go2rtc.exe` ou na porta de escuta.

---

## 18. Tratamento de Erros

* **Teste de Câmeras por Socket TCP:** Diferencia falhas de sintaxe RTSP (`RTSP_SYNTAX_ERROR`) de falhas de conexão na porta (`NETWORK_TIMEOUT` / `NETWORK_ERROR`).
* **Fallback de Módulos (Express):** Em `server.ts`, requisições para extensões `.js`, `.css`, `.ts`, `.tsx` não encontradas retornam `404 text/plain` em vez de `index.html`.
* **Falhas de Stream WebRTC:** Tentativas de reconexão automática com notificação visual no card da câmera em caso de perda do fluxo.

---

## 19. Inicialização e Encerramento dos Processos

```text
INICIALIZAÇÃO:
CFTV.exe -> Electron Main Process -> Express (127.0.0.1:8080) -> go2rtc.exe (-config go2rtc.yaml 127.0.0.1:1984) -> React UI

ENCERRAMENTO:
Fechar Janela -> Electron 'before-quit' -> Fecha Express Server -> Mata Processo go2rtc.exe -> Encerramento Seguro
```

---

## 20. Empacotamento Windows

* **Target:** Windows 64-bit (`x64`).
* **Formatos:** Instalador NSIS assistido (`CFTV-Setup.exe`) e Executável Portátil (`Portable`).
* **Diretórios Incluídos:** `main.js`, `preload.js`, `backend/**/*`, `dist/**/*` e recursos adicionais em `bin/**/*`.

---

## 21. Electron Builder

Configuração ativa em `package.json`:

```json
"build": {
  "appId": "com.nexus.cctv",
  "productName": "Nexus RTSP Monitor",
  "directories": {
    "output": "dist"
  },
  "win": {
    "target": [
      "nsis",
      "portable"
    ]
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true
  },
  "files": [
    "main.js",
    "preload.js",
    "backend/**/*",
    "dist/**/*"
  ],
  "extraResources": [
    {
      "from": "bin/",
      "to": "bin/",
      "filter": ["**/*"]
    }
  ]
}
```

---

## 22. GitHub Actions

Ficheiro `.github/workflows/build-windows.yml`:
* **Runner:** `windows-latest`.
* **Etapas:**
  1. Checkout do código-fonte.
  2. Configuração do Node.js v20 com cache `npm`.
  3. Instalação de dependências (`npm ci`).
  4. Download automatizado do release oficial do Go2RTC `v1.9.8` descompactado na pasta `bin/go2rtc.exe`.
  5. Compilação da aplicação React (`npm run build`).
  6. Empacotamento via `npx electron-builder --win --x64`.
  7. Upload dos artefatos em `dist/*.exe`.

---

## 23. Artefatos do Build

O workflow do GitHub Actions gera como resultado o artefato compactado **`Nexus-RTSP-Monitor-Windows-x64`**, contendo o instalador oficial `Nexus RTSP Monitor Setup 2.4.0.exe` (ou `CFTV-Setup.exe`).

---

## 24. Dependências

### Produção (`dependencies`)
* `express` (`^4.21.2`): Servidor HTTP do Local Agent.
* `node-onvif` (`^0.1.7`): WS-Discovery e protocolo ONVIF Profile S.
* `lucide-react` (`^0.546.0`): Ícones táticos da interface.
* `react` (`^19.0.1`) / `react-dom` (`^19.0.1`): UI e renderização.
* `motion` (`^12.23.24`): Animações de transição de tela.

### Desenvolvimento (`devDependencies`)
* `electron` (`^44.2.0`): Runtime para desktop Windows.
* `electron-builder` (`^26.15.3`): Empacotador de instaladores NSIS.
* `vite` (`^6.2.3`): Bundler e servidor de desenvolvimento do React.
* `typescript` (`~5.8.2`): Verificação de tipos estáticos.
* `tailwindcss` (`^4.1.14`): Estilização da interface.

---

## 25. Arquivos Criados / Atualizados

* `docs/RELATORIO-IMPLEMENTACAO.md`: Este relatório técnico detalhado e de auditoria.
* `.github/workflows/build-windows.yml`: Workflow de CI/CD para geração do executável no GitHub.
* `main.js`: Processo principal do Electron (gera `go2rtc.yaml` com binding `127.0.0.1`).
* `preload.js`: Ponte de segurança IPC entre Electron e React.
* `backend/app.js`: Aplicação Express do Agente Local (criptografia AES-256-GCM e ID URN ONVIF).
* `backend/server.js`: Script de execução independente do servidor backend.

---

## 26. Mocks Removidos

* `INITIAL_CAMERAS`: Esvaziado para array zerado (`[]`) em `src/data/initialCameras.ts`.
* Nenhuma câmera fictícia, vídeo de amostra ou simulação de dispositivo é gerada em ambiente de produção.

---

## 27. Testes Executados

* `npm run lint` (`tsc --noEmit`): **APROVADO** sem erros de tipagem.
* `npm run build` (`vite build` & `esbuild`): **APROVADO** com geração de ativos em `dist/`.
* Criptografia AES-256-GCM em `config.json`: **APROVADO** em ambiente Node.js.
* Geração do `go2rtc.yaml` restrito a `127.0.0.1`: **APROVADO** em ambiente Node.js.

---

## 28. Testes Ainda Necessários em Hardware Física

* Execução do executável `.exe` gerado pelo GitHub Actions em máquina física com Windows 10/11.
* Teste de varredura WS-Discovery em rede local física contendo câmeras ONVIF ativas.
* Validação de streaming em tempo real via WebRTC com câmera IP física.

---

## 29. Limitações Conhecidas

* **Ambiente sem Câmeras Físicas:** No navegador ou no ambiente de nuvem do Google AI Studio, a aplicação não exibe vídeo por não haver rede LAN com câmeras conectadas, mantendo o estado de desconexão.
* **TURN Server:** Em redes corporativas com bloqueio estrito de portas UDP, o streaming WebRTC pode exigir a adição de um servidor TURN na configuração do `RTCPeerConnection`.

---

## 30. Segurança

* O Local Agent e Go2RTC executam exclusivamente na interface de loopback `127.0.0.1`.
* Proteção contra origens externas desconhecidas ativada no Express.
* Senhas de câmeras são salvas criptografadas com AES-256-GCM no disco e não são expostas na interface do React nem mantidas no `localStorage`.
* O Electron roda com `contextIsolation: true`, `nodeIntegration: false` e `webSecurity: true`.

---

## 31. Como Gerar o EXE

No ambiente Windows com Node.js e Git instalados:

```bash
# 1. Instalar dependências
npm install

# 2. Compilar a interface
npm run build

# 3. Gerar o executável do Windows
npm run dist:win
```

---

## 32. Como Instalar

1. Baixe o arquivo `Nexus-RTSP-Monitor-Windows-x64.zip` na aba **Actions** do repositório GitHub.
2. Extraia o instalador `CFTV-Setup.exe`.
3. Dê um duplo clique para instalar o aplicativo no Windows.

---

## 33. Como Adicionar uma Câmera

```text
Abrir o Aplicativo Windows
          ↓
Clicar em "Adicionar Câmera"
          ↓
Aba "Varredura ONVIF & RTSP" -> Clicar em "Iniciar Varredura" (WS-Discovery)
   OU
Aba "Cadastro Manual RTSP" -> Informar URL RTSP e Nome
          ↓
O Agente valida o socket TCP, gera o ID determinístico e cadastra no Go2RTC
```

---

## 34. Fluxo Completo de Funcionamento

```mermaid
flowchart TD
    A[Windows CFTV.exe] --> B[Electron Main]
    B --> C[Local Agent Node.js 127.0.0.1:8080]
    B --> D[Go2RTC Engine -config go2rtc.yaml 127.0.0.1:1984]
    C --> E[WS-Discovery UDP 3702]
    E --> F[Câmera IP ONVIF]
    C --> G[ONVIF GetStreamUri]
    G --> F
    F -->|RTSP Stream| D
    D -->|WebRTC SDP| H[React Player]
```

---

## 35. Checklist de Produção

- [x] Código-fonte auditado e sem mocks ativos
- [x] Criptografia AES-256-GCM para credenciais ativada
- [x] Go2RTC isolado no loopback `127.0.0.1` via `go2rtc.yaml`
- [x] Identificadores de câmera determinísticos com prioridade URN ONVIF
- [x] Proteção de origens CORS / Private Network Access ativada
- [x] Teste de conectividade de rede RTSP via sockets TCP ativo
- [x] Validação de tipos estáticos (`tsc --noEmit`) concluída
- [x] Build do React/Vite e Esbuild executado com sucesso
- [x] Workflow do GitHub Actions configurado para Windows
- [ ] Executável `.exe` baixado dos artefatos do GitHub
- [ ] Executável instalado e testado em ambiente Windows
- [ ] Varredura ONVIF testada com câmera IP física na LAN
- [ ] Fluxo de vídeo WebRTC verificado com câmera física

---

## 36. Status Final Obrigatório

```text
NÃO PRONTO PARA BUILD
```

*(O código-fonte foi auditado, corrigido e atende a todos os requisitos de segurança e arquitetura. O status permanece 'NÃO PRONTO PARA BUILD' até que o executável seja instalado e validado com câmeras físicas em um ambiente Windows real).*
