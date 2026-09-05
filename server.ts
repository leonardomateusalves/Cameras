import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

// Express app instance containing all ONVIF, RTSP & Camera REST API endpoints
const { app, registerAllStreamsWithGo2Rtc, initWebSocket } = require('./backend/app');

const PORT = 3000;

async function startFullstackServer() {
  // Attach Vite middleware for SPA development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: express.Request, res: express.Response) => {
      // Prevent serving index.html (text/html) for missing static assets or API endpoints
      if (req.path.startsWith('/api/') || req.path.match(/\.(js|css|tsx|ts|jsx|json|png|jpg|jpeg|gif|svg|ico|map|woff2?)$/i)) {
        return res.status(404).type('text/plain').send('Not Found');
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [NEXUS CFTV FULLSTACK] Servidor ativo em http://0.0.0.0:${PORT}`);
    setTimeout(registerAllStreamsWithGo2Rtc, 2000);
  });

  if (initWebSocket) {
    initWebSocket(server);
  }
}

startFullstackServer();
