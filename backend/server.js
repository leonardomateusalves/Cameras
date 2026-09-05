const { app, registerAllStreamsWithGo2Rtc } = require('./app');

const PORT = process.env.PORT || process.env.LOCAL_AGENT_PORT || 8080;
const HOST = process.env.LOCAL_AGENT_HOST || '127.0.0.1';

const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 [NEXUS LOCAL AGENT] Servidor rodando em http://${HOST}:${PORT}`);
  setTimeout(registerAllStreamsWithGo2Rtc, 1500);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[NEXUS LOCAL AGENT] A porta ${PORT} já está em uso por outro processo.`);
  } else {
    console.error('[NEXUS LOCAL AGENT] Erro no servidor Express:', err);
  }
});
