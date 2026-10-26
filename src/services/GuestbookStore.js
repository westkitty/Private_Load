const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_TAGS = [
  'Raw',
  'Kept inside',
  'Leaked',
  'Pushed back',
  'Rough',
  'Quick',
  'Came back',
  'Already open',
  'Public',
  'Car',
  'Group',
  'Load #'
];

class GuestbookStore {
  constructor(cryptoService, options = {}) {
    this.cryptoService = cryptoService;
    this.dbPath = options.dbPath || path.join(__dirname, '../../data/guestbook.enc');
    this.data = {
      version: 1,
      config: {
        enabled_tags: [...DEFAULT_TAGS],
        default_qr_mode: 'session-long',
        max_chars: 280,
        require_passphrase: false
      },
      sessions: {},
      entries: []
    };

    this._ensureDir();
    this.load();
  }

  _ensureDir() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load() {
    if (!fs.existsSync(this.dbPath)) {
      // Empty new database, persist initial state if crypto is unlocked
      if (!this.cryptoService.isLocked) {
        this.save();
      }
      return;
    }

    if (this.cryptoService.isLocked) {
      // Cannot decrypt yet
      return;
    }

    try {
      const encryptedData = fs.readFileSync(this.dbPath);
      const decrypted = this.cryptoService.decrypt(encryptedData);
      this.data = JSON.parse(decrypted.toString('utf8'));
    } catch (err) {
      throw new Error(`Failed to decrypt database: ${err.message}`);
    }
  }

  save() {
    if (this.cryptoService.isLocked) {
      throw new Error('Cannot save database: Encrypted storage is locked');
    }

    const payload = Buffer.from(JSON.stringify(this.data), 'utf8');
    const encrypted = this.cryptoService.encrypt(payload);

    // Atomic write
    const tempPath = `${this.dbPath}.tmp`;
    fs.writeFileSync(tempPath, encrypted, { mode: 0o600 });
    fs.renameSync(tempPath, this.dbPath);
  }

  // --- Configuration ---

  getConfig() {
    return { ...this.data.config };
  }

  updateConfig(updates) {
    this.data.config = { ...this.data.config, ...updates };
    this.save();
    return this.getConfig();
  }

  // --- Session Management ---

  createSession(options = {}) {
    // Check if an active session already exists
    const existingActive = this.getActiveSession();
    if (existingActive) {
      return existingActive;
    }

    const sessionId = uuidv4();
    const token = options.qr_token || uuidv4().replace(/-/g, '').slice(0, 12);
    const qrMode = options.qr_mode || this.data.config.default_qr_mode || 'session-long';

    let tokenExpiresAt = null;
    if (qrMode === 'time-boxed') {
      const minutes = options.time_box_minutes || 15;
      tokenExpiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    }

    const session = {
      id: sessionId,
      started_at: new Date().toISOString(),
      ended_at: null,
      label: options.label || 'open', // "open", "hosting", "cruising", or unlabeled
      qr_token: token,
      qr_mode: qrMode,
      token_expires_at: tokenExpiresAt,
      status: 'active',
      enabled_tags: options.enabled_tags || [...this.data.config.enabled_tags],
      max_chars: options.max_chars || this.data.config.max_chars || 280
    };

    this.data.sessions[sessionId] = session;
    this.save();
    return session;
  }

  getSession(id) {
    return this.data.sessions[id] || null;
  }

  getSessionByToken(token) {
    return Object.values(this.data.sessions).find(s => s.qr_token === token) || null;
  }

  getActiveSession() {
    return Object.values(this.data.sessions).find(s => s.status === 'active') || null;
  }

  updateSession(sessionId, updates) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;

    Object.assign(session, updates);
    this.save();
    return session;
  }

  rotateSessionToken(sessionId, newMode = null, timeBoxMinutes = 15) {
    const session = this.data.sessions[sessionId];
    if (!session || session.status !== 'active') return null;

    session.qr_token = uuidv4().replace(/-/g, '').slice(0, 12);
    if (newMode) {
      session.qr_mode = newMode;
    }

    if (session.qr_mode === 'time-boxed') {
      session.token_expires_at = new Date(Date.now() + timeBoxMinutes * 60 * 1000).toISOString();
    } else {
      session.token_expires_at = null;
    }

    this.save();
    return session;
  }

  endSession(sessionId) {
    const session = this.data.sessions[sessionId];
    if (!session) return null;

    session.ended_at = new Date().toISOString();
    session.status = 'archived';
    
    // Store frozen totals on the archived session
    session.totals = this.getSessionTotals(sessionId);
    this.save();
    return session;
  }

  deleteSession(sessionId) {
    if (!this.data.sessions[sessionId]) return false;
    delete this.data.sessions[sessionId];
    // Remove all associated entries
    this.data.entries = this.data.entries.filter(e => e.session_id !== sessionId);
    this.save();
    return true;
  }

  listSessions(filters = {}) {
    let sessions = Object.values(this.data.sessions);
    if (filters.status) {
      sessions = sessions.filter(s => s.status === filters.status);
    }
    // Sort newest start first
    return sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  // --- Entry Management ---

  createEntry(entryData) {
    const sessionId = entryData.session_id;
    const session = this.data.sessions[sessionId];
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Auto-calculate load number if not explicitly specified
    let loadNumber = entryData.load_number;
    if (loadNumber === undefined || loadNumber === null) {
      // Find maximum load number in this session so far + 1
      const sessionEntries = this.data.entries.filter(e => e.session_id === sessionId);
      const existingMax = sessionEntries.reduce((max, e) => {
        return (typeof e.load_number === 'number' && e.load_number > max) ? e.load_number : max;
      }, 0);
      loadNumber = existingMax + 1;
    }

    const cleanBody = (typeof entryData.body === 'string') ? entryData.body.trim() : null;
    const tags = Array.isArray(entryData.tags) ? entryData.tags : [];

    const entry = {
      id: entryData.id || uuidv4(),
      session_id: sessionId,
      created_at: entryData.created_at || new Date().toISOString(),
      source: entryData.source || 'visitor', // "visitor" | "host"
      body: cleanBody && cleanBody.length > 0 ? cleanBody : null,
      tags: tags,
      load_number: loadNumber,
      voice_note_id: entryData.voice_note_id || null,
      media_ids: Array.isArray(entryData.media_ids) ? entryData.media_ids : [],
      host_note: entryData.host_note ? String(entryData.host_note).trim() : null
    };

    this.data.entries.push(entry);

    // If session QR mode is single-use, rotate token immediately!
    if (session.status === 'active' && session.qr_mode === 'single-use') {
      this.rotateSessionToken(sessionId);
    }

    this.save();
    return entry;
  }

  getEntries(sessionId, filters = {}) {
    let entries = this.data.entries.filter(e => e.session_id === sessionId);

    // Filter by tag
    if (filters.tag) {
      entries = entries.filter(e => e.tags && e.tags.includes(filters.tag));
    }

    // Filter by has-text
    if (filters.hasText === true) {
      entries = entries.filter(e => e.body && e.body.length > 0);
    } else if (filters.hasText === false) {
      entries = entries.filter(e => !e.body || e.body.length === 0);
    }

    // Filter by source
    if (filters.source) {
      entries = entries.filter(e => e.source === filters.source);
    }

    // Search query
    if (filters.search) {
      const q = filters.search.toLowerCase();
      entries = entries.filter(e => 
        (e.body && e.body.toLowerCase().includes(q)) ||
        (e.host_note && e.host_note.toLowerCase().includes(q)) ||
        (e.tags && e.tags.some(t => t.toLowerCase().includes(q)))
      );
    }

    // CRITICAL: Strictly ordered by created_at ASCENDING
    return entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  getEntry(entryId) {
    return this.data.entries.find(e => e.id === entryId) || null;
  }

  updateEntry(entryId, updates) {
    const entry = this.getEntry(entryId);
    if (!entry) return null;

    if (updates.host_note !== undefined) {
      entry.host_note = updates.host_note ? String(updates.host_note).trim() : null;
    }

    if (Array.isArray(updates.media_ids)) {
      entry.media_ids = updates.media_ids;
    }

    if (Array.isArray(updates.tags)) {
      entry.tags = updates.tags;
    }

    if (updates.load_number !== undefined) {
      entry.load_number = updates.load_number;
    }

    this.save();
    return entry;
  }

  deleteEntry(entryId) {
    const initialLen = this.data.entries.length;
    this.data.entries = this.data.entries.filter(e => e.id !== entryId);
    if (this.data.entries.length !== initialLen) {
      this.save();
      return true;
    }
    return false;
  }

  // --- Totals and Analytics ---

  getSessionTotals(sessionId) {
    const entries = this.data.entries.filter(e => e.session_id === sessionId);
    const tagCounts = {};

    let totalLoads = 0;
    let totalComments = 0;
    let voiceCount = 0;
    let mediaCount = 0;

    entries.forEach(e => {
      totalLoads += 1;
      if (e.body && e.body.trim().length > 0) {
        totalComments += 1;
      }
      if (e.voice_note_id) {
        voiceCount += 1;
      }
      if (e.media_ids && e.media_ids.length > 0) {
        mediaCount += e.media_ids.length;
      }
      if (Array.isArray(e.tags)) {
        e.tags.forEach(t => {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
      }
    });

    return {
      total_loads: totalLoads,
      total_comments: totalComments,
      total_voice_notes: voiceCount,
      total_proof_media: mediaCount,
      tag_counts: tagCounts
    };
  }

  // --- Export and Import ---

  exportArchive(sessionIds = null) {
    let exportedSessions = this.data.sessions;
    let exportedEntries = this.data.entries;

    if (Array.isArray(sessionIds) && sessionIds.length > 0) {
      exportedSessions = {};
      sessionIds.forEach(id => {
        if (this.data.sessions[id]) {
          exportedSessions[id] = this.data.sessions[id];
        }
      });
      exportedEntries = exportedEntries.filter(e => sessionIds.includes(e.session_id));
    }

    return {
      exported_at: new Date().toISOString(),
      version: this.data.version,
      sessions: exportedSessions,
      entries: exportedEntries
    };
  }

  importArchive(archiveData) {
    if (!archiveData || !archiveData.sessions || !Array.isArray(archiveData.entries)) {
      throw new Error('Invalid archive data format');
    }

    let importedSessionsCount = 0;
    let importedEntriesCount = 0;

    Object.entries(archiveData.sessions).forEach(([id, session]) => {
      if (!this.data.sessions[id]) {
        this.data.sessions[id] = session;
        importedSessionsCount++;
      }
    });

    archiveData.entries.forEach(entry => {
      const exists = this.data.entries.some(e => e.id === entry.id);
      if (!exists) {
        this.data.entries.push(entry);
        importedEntriesCount++;
      }
    });

    this.save();
    return { importedSessionsCount, importedEntriesCount };
  }
}

module.exports = {
  GuestbookStore,
  DEFAULT_TAGS
};
