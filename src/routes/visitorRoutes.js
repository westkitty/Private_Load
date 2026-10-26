const express = require('express');
const path = require('path');
const multer = require('multer');

// Store uploaded files in memory before saving to encrypted sandbox
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

function createVisitorRouter(sessionManager, mediaService) {
  const router = express.Router();

  // Visitor Form page: /l/:token
  router.get('/l/:token', (req, res) => {
    const { token } = req.params;
    const validation = sessionManager.validateToken(token);

    if (!validation.valid) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Session Closed</title>
          <style>
            body { background: #0b0c10; color: #eee; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
            .box { padding: 30px; background: #16181f; border-radius: 12px; border: 1px solid #282c37; }
            h2 { margin-bottom: 10px; color: #ff5252; }
          </style>
        </head>
        <body>
          <div class="box">
            <h2>Session Unavailable</h2>
            <p>${validation.error || 'This QR token is invalid or the session has ended.'}</p>
          </div>
        </body>
        </html>
      `);
    }

    res.sendFile(path.join(__dirname, '../public/visitor/form.html'));
  });

  // Get session metadata for visitor form
  router.get('/api/visitor/session/:token', (req, res) => {
    const { token } = req.params;
    const validation = sessionManager.validateToken(token);

    if (!validation.valid) {
      return res.status(404).json({ error: validation.error });
    }

    const session = validation.session;
    const totals = sessionManager.store.getSessionTotals(session.id);

    // Only return minimal configuration needed for form display
    res.json({
      label: session.label || 'Leaving',
      enabled_tags: session.enabled_tags || [],
      max_chars: session.max_chars || 280,
      suggested_load_number: totals.total_loads + 1
    });
  });

  // Visitor Submit: POST /api/visitor/submit/:token
  router.post('/api/visitor/submit/:token', upload.single('voice_note'), async (req, res) => {
    const { token } = req.params;

    try {
      let voiceNoteId = null;

      // Handle optional voice note
      if (req.file && mediaService) {
        const savedMedia = mediaService.saveEncryptedMedia(
          req.file.buffer,
          req.file.mimetype || 'audio/webm',
          'voice_note.webm'
        );
        voiceNoteId = savedMedia.id;
      }

      // Parse tags
      let parsedTags = [];
      if (req.body.tags) {
        try {
          parsedTags = JSON.parse(req.body.tags);
        } catch (e) {
          if (typeof req.body.tags === 'string') {
            parsedTags = [req.body.tags];
          }
        }
      }

      // Parse load number
      let loadNumber = null;
      if (req.body.load_number && !isNaN(parseInt(req.body.load_number, 10))) {
        loadNumber = parseInt(req.body.load_number, 10);
      }

      const result = sessionManager.submitEntry({
        token,
        source: 'visitor',
        body: req.body.body || null,
        tags: parsedTags,
        load_number: loadNumber,
        voice_note_id: voiceNoteId
      });

      // No cookies, no tracking headers
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.status(200).json({
        success: true,
        message: 'Got it'
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err.message || 'Submission failed'
      });
    }
  });

  return router;
}

module.exports = createVisitorRouter;
