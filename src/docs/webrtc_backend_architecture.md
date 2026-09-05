# Arquitetura de Streaming WebRTC Real (Go2RTC + RTSP)

Esta documentação descreve o pipeline de streaming nativo em tempo real utilizado pelo aplicativo Windows Local Agent.

## Fluxo Principal
```text
Câmera IP (RTSP) -> Go2RTC (Engine Core) -> WebRTC (RTCPeerConnection / SDP) -> React Player
```

## Benefícios do Go2RTC
- Latência ultrabaixa (< 300ms) sem necessidade de re-encodificação quando a câmera entrega H.264 / AAC.
- Gerenciamento automático de conexões de entrada RTSP e sessão WebRTC SDP.
- Zero dependência de servidores de streaming em nuvem para tráfego de mídia em rede local.
- Suporte a STUN (`stun.l.google.com:19302`) para negociação ICE de candidato direto P2P.

