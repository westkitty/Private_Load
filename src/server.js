const express = require('express');
const path = require('path');
const http = require('http');

const CryptoService = require('./services/CryptoService');
const MediaService = require('./services/MediaService');
const { GuestbookStore } = require('./services/GuestbookStore');
const QRService = require('./services/QRService');
const SessionManager = require('./services/SessionManager');

const createVisitorRouter = require('./routes/visitorRoutes');
const createApiRouter = require('./routes/apiRoutes');

function createApp(options = {}) {
  const app = express();
  const port = options.port || process.env.PORT || 3000;
  const hostIp = options.hostIp || process.env.HOST_IP || null;
  const defaultPassphrase = options.passphrase || process.env.HOST_PASSPHRASE || 'private_load_default_key_2026';

  // 1. Initialize Cryptographic Subsystem
  const cryptoService = new CryptoService({
    saltPath: options.saltPath,
    passphrase: defaultPassphrase
  });

  // 2. Initialize Encrypted Storage & Media
  const mediaService = new MediaService(cryptoService, {
    mediaDir: options.mediaDir
  });

  const guestbookStore = new GuestbookStore(cryptoService, {
    dbPath: options.dbPath
  });

  // 3. Initialize QR & Session Services
  const qrService = new QRService({
    port,
    hostIp
  });

  const sessionManager = new SessionManager(guestbookStore, qrService);

  // 4. Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Disable identifying server headers
  app.disable('x-powered-by');

  // 5. Visitor Routes (/l/:token and /api/visitor/...)
  const visitorRouter = createVisitorRouter(sessionManager, mediaService);
  app.use(visitorRouter);

  // 6. Host API Routes (/api/host/...)
  const apiRouter = createApiRouter(sessionManager, mediaService, cryptoService, qrService);
  app.use(apiRouter);

  // 7. Host Frontend Static Assets
  app.use('/host', express.static(path.join(__dirname, 'public/host')));
  app.get('/', (req, res) => {
    res.redirect('/host');
  });

  return {
    app,
    port,
    cryptoService,
    mediaService,
    guestbookStore,
    qrService,
    sessionManager
  };
}

// Start standalone server if invoked directly
if (require.main === module) {
  function startServer(attemptPort) {
    const { app, port, qrService } = createApp({ port: attemptPort });
    const server = http.createServer(app);

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attemptPort === 3000) {
        console.log(`Port 3000 in use, falling back to port 3030...`);
        startServer(3030);
      } else {
        console.error('Server error:', err);
      }
    });

    server.listen(attemptPort, '0.0.0.0', () => {
      console.log(`=======================================================`);
      console.log(` Leaving QR — Private Sequential Load Guestbook`);
      console.log(`=======================================================`);
      console.log(` Host Web Interface:  http://localhost:${attemptPort}/host`);
      console.log(` Local Network IP:    ${qrService.hostIp}`);
      console.log(` Visitor Base URL:    http://${qrService.hostIp}:${attemptPort}/l/<token>`);
      console.log(` Encrypted Database:  aes-256-gcm authenticated`);
      console.log(` Status:              Ready for sequential logging`);
      console.log(`=======================================================`);
    });

    // Graceful shutdown
    const shutdown = () => {
      console.log('\nShutting down Leaving QR securely...');
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }

  const initialPort = Number(process.env.PORT) || 3000;
  startServer(initialPort);
}

module.exports = createApp;
