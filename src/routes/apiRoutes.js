const express = require('express');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB proof media
});

function createApiRouter(sessionManager, mediaService, cryptoService, qrService) {
  const router = express.Router();
  const store = sessionManager.store;

  // SSE Client pool
  const sseClients = new Set();

  function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch (e) {
        sseClients.delete(res);
      }
    }
  }

  // Hook into SessionManager events
  sessionManager.on('entry_created', data => broadcastSSE('entry_created', data));
  sessionManager.on('session_started', data => broadcastSSE('session_started', data));
  sessionManager.on('session_ended', data => broadcastSSE('session_ended', data));
  sessionManager.on('token_rotated', data => broadcastSSE('token_rotated', data));

  // Server-Sent Events endpoint
  router.get('/api/host/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);

    // Initial ping
    res.write(`event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`);

    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  // Host Status
  router.get('/api/host/status', async (req, res) => {
    try {
      const cryptoStatus = cryptoService.getStatus();
      if (cryptoStatus.isLocked) {
        return res.json({
          isLocked: true,
          activeSession: null,
          totals: null,
          hostIp: qrService.hostIp,
          port: qrService.port
        });
      }

      const activeSession = sessionManager.getActiveSession();
      let totals = null;
      let qrDataUrl = null;
      let visitorUrl = null;

      if (activeSession) {
        totals = store.getSessionTotals(activeSession.id);
        visitorUrl = qrService.getVisitorUrl(activeSession.qr_token);
        qrDataUrl = await qrService.generateQRCodeDataUrl(activeSession.qr_token, { width: 350 });
      }

      res.json({
        isLocked: false,
        activeSession,
        totals,
        hostIp: qrService.hostIp,
        port: qrService.port,
        visitorUrl,
        qrDataUrl
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Unlock with passphrase
  router.post('/api/host/unlock', (req, res) => {
    try {
      const { passphrase } = req.body;
      if (!passphrase) {
        return res.status(400).json({ error: 'Passphrase required' });
      }

      cryptoService.unlock(passphrase);
      store.load();

      res.json({ success: true, message: 'Unlocked successfully' });
    } catch (err) {
      res.status(401).json({ error: err.message || 'Unlock failed' });
    }
  });

  // Lock
  router.post('/api/host/lock', (req, res) => {
    cryptoService.lock();
    res.json({ success: true, message: 'Locked successfully' });
  });

  // Guard for locked operations
  const requireUnlocked = (req, res, next) => {
    if (cryptoService.isLocked) {
      return res.status(423).json({ error: 'Storage locked. Passphrase required.' });
    }
    next();
  };

  // Start Session
  router.post('/api/host/session/start', requireUnlocked, async (req, res) => {
    try {
      const { label, qr_mode, enabled_tags, max_chars, time_box_minutes } = req.body;
      const session = sessionManager.startSession({
        label,
        qr_mode,
        enabled_tags,
        max_chars,
        time_box_minutes
      });

      const qrDataUrl = await qrService.generateQRCodeDataUrl(session.qr_token);
      res.json({
        success: true,
        session,
        qrDataUrl,
        visitorUrl: qrService.getVisitorUrl(session.qr_token)
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // End Session
  router.post('/api/host/session/end', requireUnlocked, (req, res) => {
    try {
      const archived = sessionManager.endActiveSession();
      if (!archived) {
        return res.status(404).json({ error: 'No active session to end' });
      }
      res.json({ success: true, session: archived });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Rotate QR Token
  router.post('/api/host/session/rotate-token', requireUnlocked, async (req, res) => {
    try {
      const { mode, timeBoxMinutes } = req.body;
      const updated = sessionManager.rotateToken(mode, timeBoxMinutes);
      if (!updated) {
        return res.status(404).json({ error: 'No active session' });
      }

      const qrDataUrl = await qrService.generateQRCodeDataUrl(updated.qr_token);
      res.json({
        success: true,
        session: updated,
        qrDataUrl,
        visitorUrl: qrService.getVisitorUrl(updated.qr_token)
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Get Session Entries (defaults to active session, or by query ?sessionId=)
  router.get('/api/host/session/entries', requireUnlocked, (req, res) => {
    try {
      let sessionId = req.query.sessionId;
      if (!sessionId) {
        const active = sessionManager.getActiveSession();
        if (!active) {
          return res.json({ entries: [], totals: null, session: null });
        }
        sessionId = active.id;
      }

      const session = store.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      const filters = {
        tag: req.query.tag || null,
        hasText: req.query.hasText !== undefined ? req.query.hasText === 'true' : undefined,
        source: req.query.source || null,
        search: req.query.search || null
      };

      const entries = store.getEntries(sessionId, filters);
      const totals = store.getSessionTotals(sessionId);

      res.json({
        session,
        entries,
        totals
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual +1 Load
  router.post('/api/host/session/load-increment', requireUnlocked, (req, res) => {
    try {
      const { host_note } = req.body;
      const result = sessionManager.manualIncrementLoad(host_note);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Simulate Visitor Submit (Host debug tool)
  router.post('/api/host/session/simulate-visitor', requireUnlocked, (req, res) => {
    try {
      const active = sessionManager.getActiveSession();
      if (!active) {
        return res.status(404).json({ error: 'No active session' });
      }

      const { body, tags, load_number } = req.body;
      const result = sessionManager.submitEntry({
        token: active.qr_token,
        source: 'visitor',
        body: body || null,
        tags: Array.isArray(tags) ? tags : [],
        load_number: load_number !== undefined ? Number(load_number) : null
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Single Entry Detail
  router.get('/api/host/entry/:id', requireUnlocked, (req, res) => {
    const entry = store.getEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }
    res.json({ entry });
  });

  // Update Entry (host_note, tags, load_number)
  router.patch('/api/host/entry/:id', requireUnlocked, (req, res) => {
    try {
      const updated = store.updateEntry(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ error: 'Entry not found' });
      }
      res.json({ success: true, entry: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Attach Proof Photo to Entry
  router.post('/api/host/entry/:id/proof', requireUnlocked, upload.single('photo'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No photo provided' });
      }

      const entry = store.getEntry(req.params.id);
      if (!entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      const savedMedia = mediaService.saveEncryptedMedia(
        req.file.buffer,
        req.file.mimetype || 'image/jpeg',
        req.file.originalname || 'proof.jpg'
      );

      const mediaIds = [...(entry.media_ids || []), savedMedia.id];
      const updated = store.updateEntry(req.params.id, { media_ids: mediaIds });

      res.json({
        success: true,
        media_id: savedMedia.id,
        entry: updated
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete Entry
  router.delete('/api/host/entry/:id', requireUnlocked, (req, res) => {
    const entry = store.getEntry(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    // Cleanup associated media if present
    if (entry.voice_note_id) {
      mediaService.deleteMedia(entry.voice_note_id);
    }
    if (Array.isArray(entry.media_ids)) {
      entry.media_ids.forEach(id => mediaService.deleteMedia(id));
    }

    store.deleteEntry(req.params.id);
    res.json({ success: true, message: 'Entry deleted' });
  });

  // Stream Decrypted Media (Photos, Voice Notes)
  router.get('/api/host/media/:id', requireUnlocked, (req, res) => {
    try {
      const media = mediaService.getDecryptedMedia(req.params.id);
      if (!media) {
        return res.status(404).send('Media not found');
      }

      res.setHeader('Content-Type', media.meta.mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(media.buffer);
    } catch (err) {
      res.status(500).send(`Failed to read media: ${err.message}`);
    }
  });

  // Archived Sessions List
  router.get('/api/host/archive', requireUnlocked, (req, res) => {
    try {
      const archived = store.listSessions({ status: 'archived' });
      res.json({ sessions: archived });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete Archived Session
  router.delete('/api/host/archive/:sessionId', requireUnlocked, (req, res) => {
    try {
      const success = store.deleteSession(req.params.sessionId);
      if (!success) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ success: true, message: 'Session deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Settings
  router.get('/api/host/settings', requireUnlocked, (req, res) => {
    res.json({ config: store.getConfig() });
  });

  router.patch('/api/host/settings', requireUnlocked, (req, res) => {
    try {
      const updated = store.updateConfig(req.body);
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Export Encrypted Archive
  router.get('/api/host/export', requireUnlocked, (req, res) => {
    try {
      const sessionIds = req.query.sessionIds ? req.query.sessionIds.split(',') : null;
      const archive = store.exportArchive(sessionIds);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="leaving_guestbook_backup_${Date.now()}.json"`);
      res.json(archive);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import Archive
  router.post('/api/host/import', requireUnlocked, (req, res) => {
    try {
      const result = store.importArchive(req.body);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Printable Door Card
  router.get('/api/host/door-card', requireUnlocked, async (req, res) => {
    try {
      const active = sessionManager.getActiveSession();
      if (!active) {
        return res.status(404).send('No active session to print door card for');
      }

      const cardHtml = await qrService.generatePrintableCard(active.qr_token, active.label || 'Leaving QR');
      res.send(cardHtml);
    } catch (err) {
      res.status(500).send(err.message);
    }
  });

  return router;
}

module.exports = createApiRouter;
