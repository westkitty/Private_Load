const EventEmitter = require('events');

class SessionManager extends EventEmitter {
  constructor(store, qrService) {
    super();
    this.store = store;
    this.qrService = qrService;
  }

  startSession(options = {}) {
    // If active session exists, return it
    const active = this.store.getActiveSession();
    if (active) {
      return active;
    }

    const session = this.store.createSession(options);
    this.emit('session_started', session);
    return session;
  }

  getActiveSession() {
    const session = this.store.getActiveSession();
    if (!session) return null;

    // Check if time-boxed and expired
    if (session.qr_mode === 'time-boxed' && session.token_expires_at) {
      const now = new Date();
      const expires = new Date(session.token_expires_at);
      if (now > expires) {
        // Automatically rotate expired token
        this.store.rotateSessionToken(session.id, 'time-boxed');
      }
    }

    return this.store.getSession(session.id);
  }

  endActiveSession() {
    const active = this.store.getActiveSession();
    if (!active) return null;

    const archived = this.store.endSession(active.id);
    this.emit('session_ended', archived);
    return archived;
  }

  rotateToken(mode = null, timeBoxMinutes = 15) {
    const active = this.store.getActiveSession();
    if (!active) return null;

    const updated = this.store.rotateSessionToken(active.id, mode, timeBoxMinutes);
    this.emit('token_rotated', updated);
    return updated;
  }

  /**
   * Validate token against active session.
   * @param {string} token
   * @returns {Object} { valid: boolean, session: Object|null, error: string|null }
   */
  validateToken(token) {
    if (!token) {
      return { valid: false, session: null, error: 'Token missing' };
    }

    const session = this.store.getSessionByToken(token);
    if (!session) {
      return { valid: false, session: null, error: 'Invalid or expired QR token' };
    }

    if (session.status !== 'active') {
      return { valid: false, session: null, error: 'Session has ended' };
    }

    // Check time-box
    if (session.qr_mode === 'time-boxed' && session.token_expires_at) {
      const now = new Date();
      const expires = new Date(session.token_expires_at);
      if (now > expires) {
        return { valid: false, session: null, error: 'QR token has expired' };
      }
    }

    return { valid: true, session, error: null };
  }

  /**
   * Record a visitor or host entry into the active session.
   * @param {Object} data - { token, body, tags, load_number, voice_note_id, media_ids, source, host_note }
   */
  submitEntry(data) {
    const source = data.source || 'visitor';
    let session = null;

    if (source === 'visitor') {
      const token = data.token;
      const validation = this.validateToken(token);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      session = validation.session;
    } else {
      // Host entry directly into active session
      session = this.getActiveSession();
      if (!session) {
        throw new Error('No active session for host submission');
      }
    }

    // Enforce max chars if body is present
    let body = data.body;
    if (typeof body === 'string') {
      const maxChars = session.max_chars || 280;
      if (body.length > maxChars) {
        body = body.slice(0, maxChars);
      }
    }

    // Filter tags to only allowed tags if configured
    let tags = [];
    if (Array.isArray(data.tags)) {
      const allowed = new Set(session.enabled_tags || []);
      tags = data.tags.filter(t => allowed.has(t) || allowed.size === 0);
    }

    const entry = this.store.createEntry({
      session_id: session.id,
      source,
      body,
      tags,
      load_number: (data.load_number !== undefined && data.load_number !== null) ? Number(data.load_number) : null,
      voice_note_id: data.voice_note_id || null,
      media_ids: data.media_ids || [],
      host_note: data.host_note || null
    });

    const sessionTotals = this.store.getSessionTotals(session.id);

    // Notify listeners / SSE clients in real-time
    this.emit('entry_created', {
      entry,
      session_id: session.id,
      totals: sessionTotals
    });

    return {
      entry,
      totals: sessionTotals
    };
  }

  /**
   * Manual +1 load triggered by host.
   */
  manualIncrementLoad(hostNote = null) {
    const active = this.getActiveSession();
    if (!active) {
      throw new Error('No active session');
    }

    return this.submitEntry({
      source: 'host',
      body: null,
      tags: [],
      host_note: hostNote
    });
  }
}

module.exports = SessionManager;
