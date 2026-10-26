(function() {
  // State
  let state = {
    isLocked: false,
    activeSession: null,
    totals: null,
    entries: [],
    qrDataUrl: '',
    visitorUrl: '',
    hostIp: '',
    port: 3000,
    selectedEntry: null,
    filterTag: null,
    searchQuery: '',
    timerInterval: null,
    config: null
  };

  // DOM Elements
  const unlockScreen = document.getElementById('unlock-screen');
  const unlockForm = document.getElementById('unlock-form');
  const unlockPassphrase = document.getElementById('unlock-passphrase');
  const unlockError = document.getElementById('unlock-error');

  const liveIndicator = document.getElementById('live-indicator');
  const activeSessionLabel = document.getElementById('active-session-label');
  const btnQuickQr = document.getElementById('btn-quick-qr');
  const btnLock = document.getElementById('btn-lock');

  const navTabs = document.querySelectorAll('.nav-tab');
  const screens = document.querySelectorAll('.screen');

  // Screen 1: Active
  const noSessionCard = document.getElementById('no-session-card');
  const activeSessionContent = document.getElementById('active-session-content');
  const startLabelInput = document.getElementById('start-label');
  const startQrModeSelect = document.getElementById('start-qr-mode');
  const btnStartSession = document.getElementById('btn-start-session');

  const statTotalLoads = document.getElementById('stat-total-loads');
  const statTotalComments = document.getElementById('stat-total-comments');
  const statTotalProof = document.getElementById('stat-total-proof');
  const statSessionTimer = document.getElementById('stat-session-timer');

  const btnAddLoad = document.getElementById('btn-add-load');
  const btnViewQrLarge = document.getElementById('btn-view-qr-large');
  const btnEndSession = document.getElementById('btn-end-session');
  const btnSimulateDebug = document.getElementById('btn-simulate-debug');
  const activeEntryList = document.getElementById('active-entry-list');

  // Screen 2: QR
  const qrScreenMode = document.getElementById('qr-screen-mode');
  const qrScreenImg = document.getElementById('qr-screen-img');
  const qrScreenTimer = document.getElementById('qr-screen-timer');
  const qrScreenLoads = document.getElementById('qr-screen-loads');
  const qrScreenComments = document.getElementById('qr-screen-comments');
  const qrScreenUrl = document.getElementById('qr-screen-url');
  const btnCopyUrl = document.getElementById('btn-copy-url');
  const btnRotateToken = document.getElementById('btn-rotate-token');
  const btnOpenDoorCard = document.getElementById('btn-open-door-card');

  // Screen 3: Guestbook
  const guestbookSearch = document.getElementById('guestbook-search');
  const filterTagChips = document.getElementById('filter-tag-chips');
  const guestbookFullList = document.getElementById('guestbook-full-list');

  // Screen 4: Archive
  const archiveList = document.getElementById('archive-list');

  // Screen 5: Settings
  const tagsEditor = document.getElementById('tags-editor');
  const newTagInput = document.getElementById('new-tag-input');
  const btnAddTag = document.getElementById('btn-add-tag');
  const settingDefaultQrMode = document.getElementById('setting-default-qr-mode');
  const btnChangePassphrase = document.getElementById('btn-change-passphrase');
  const btnExportBackup = document.getElementById('btn-export-backup');
  const importBackupFile = document.getElementById('import-backup-file');

  // Entry Detail Modal
  const entryDetailModal = document.getElementById('entry-detail-modal');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalEntryTitle = document.getElementById('modal-entry-title');
  const modalLoadNum = document.getElementById('modal-load-num');
  const modalBodyText = document.getElementById('modal-body-text');
  const modalTags = document.getElementById('modal-tags');
  const modalVoiceSection = document.getElementById('modal-voice-section');
  const modalVoicePlayer = document.getElementById('modal-voice-player');
  const modalProofGallery = document.getElementById('modal-proof-gallery');
  const proofPhotoInput = document.getElementById('proof-photo-input');
  const modalHostNote = document.getElementById('modal-host-note');
  const btnSaveHostNote = document.getElementById('btn-save-host-note');

  // Debug Modal
  const debugModal = document.getElementById('debug-modal');
  const btnCloseDebug = document.getElementById('btn-close-debug');
  const debugForm = document.getElementById('debug-form');
  const debugBody = document.getElementById('debug-body');
  const debugPresets = document.querySelectorAll('.debug-preset');

  // Navigation
  function switchTab(targetId) {
    navTabs.forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-target') === targetId);
    });
    screens.forEach(s => {
      s.classList.toggle('active', s.id === targetId);
    });

    if (targetId === 'screen-guestbook') {
      renderGuestbook();
    } else if (targetId === 'screen-archive') {
      loadArchive();
    } else if (targetId === 'screen-settings') {
      loadSettings();
    }
  }

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.getAttribute('data-target'));
    });
  });

  btnQuickQr.addEventListener('click', () => switchTab('screen-qr'));
  btnViewQrLarge.addEventListener('click', () => switchTab('screen-qr'));

  // Elapsed Timer
  function startSessionTimer(startedAt) {
    if (state.timerInterval) clearInterval(state.timerInterval);
    const start = new Date(startedAt).getTime();

    function update() {
      const now = Date.now();
      const diffSec = Math.max(0, Math.floor((now - start) / 1000));
      const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
      const secs = String(diffSec % 60).padStart(2, '0');
      const timeStr = `${mins}:${secs}`;
      statSessionTimer.textContent = timeStr;
      qrScreenTimer.textContent = `Session Elapsed: ${timeStr}`;
    }

    update();
    state.timerInterval = setInterval(update, 1000);
  }

  function stopSessionTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    statSessionTimer.textContent = '00:00';
    qrScreenTimer.textContent = 'Session Elapsed: 00:00';
  }

  // Load Status & Initial Data
  async function loadStatus() {
    try {
      const res = await fetch('/api/host/status');
      const data = await res.json();

      if (data.isLocked) {
        state.isLocked = true;
        unlockScreen.style.display = 'flex';
        return;
      }

      state.isLocked = false;
      unlockScreen.style.display = 'none';
      state.activeSession = data.activeSession;
      state.totals = data.totals;
      state.hostIp = data.hostIp;
      state.port = data.port;
      state.visitorUrl = data.visitorUrl;
      state.qrDataUrl = data.qrDataUrl;

      renderActiveSession();
      if (state.activeSession) {
        loadEntries();
      }
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  }

  // Unlock Handler
  unlockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockError.textContent = '';
    const passphrase = unlockPassphrase.value;

    try {
      const res = await fetch('/api/host/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unlock failed');

      unlockPassphrase.value = '';
      loadStatus();
    } catch (err) {
      unlockError.textContent = err.message;
    }
  });

  // Lock Handler
  btnLock.addEventListener('click', async () => {
    if (confirm('Lock host app now? Passphrase will be required to view records.')) {
      await fetch('/api/host/lock', { method: 'POST' });
      state.isLocked = true;
      unlockScreen.style.display = 'flex';
      stopSessionTimer();
    }
  });

  // Render Active Session UI
  function renderActiveSession() {
    const s = state.activeSession;
    if (!s) {
      liveIndicator.classList.remove('active');
      activeSessionLabel.textContent = 'No Active Session';
      noSessionCard.style.display = 'block';
      activeSessionContent.style.display = 'none';
      stopSessionTimer();
      return;
    }

    liveIndicator.classList.add('active');
    activeSessionLabel.textContent = (s.label || 'OPEN').toUpperCase();
    noSessionCard.style.display = 'none';
    activeSessionContent.style.display = 'block';

    const totals = state.totals || { total_loads: 0, total_comments: 0, total_proof_media: 0 };
    statTotalLoads.textContent = totals.total_loads;
    statTotalComments.textContent = totals.total_comments;
    statTotalProof.textContent = totals.total_proof_media;

    startSessionTimer(s.started_at);

    // QR Screen UI
    qrScreenMode.textContent = s.qr_mode ? s.qr_mode.toUpperCase() : 'SESSION-LONG';
    qrScreenImg.src = state.qrDataUrl || '';
    qrScreenLoads.textContent = totals.total_loads;
    qrScreenComments.textContent = totals.total_comments;
    qrScreenUrl.textContent = state.visitorUrl || '';
  }

  // Fetch Session Entries
  async function loadEntries() {
    if (!state.activeSession) return;
    try {
      const res = await fetch('/api/host/session/entries');
      const data = await res.json();
      state.entries = data.entries || [];
      state.totals = data.totals;

      renderActiveEntries();
      renderActiveSession();
    } catch (err) {
      console.error('Failed to load entries:', err);
    }
  }

  // Render Active Entries List
  function renderActiveEntries() {
    if (!state.entries || state.entries.length === 0) {
      activeEntryList.innerHTML = '<div class="empty-card" style="padding: 20px;"><p>No uses recorded yet. Surface QR on your way out.</p></div>';
      return;
    }

    // Spec explicitly requests created_at ascending order (chronological sequence of uses)
    const sorted = [...state.entries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    activeEntryList.innerHTML = sorted.map(entry => createEntryCardHtml(entry)).join('');

    // Attach click listeners to cards
    activeEntryList.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', () => {
        const entryId = card.getAttribute('data-id');
        openEntryDetail(entryId);
      });
    });
  }

  function createEntryCardHtml(entry) {
    const timeStr = new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const isVisitor = entry.source === 'visitor';
    const sourceClass = isVisitor ? 'visitor' : 'host';
    const sourceLabel = isVisitor ? 'Visitor' : 'Host Manual';

    const bodyHtml = entry.body && entry.body.trim()
      ? `<div class="entry-body">${escapeHtml(entry.body)}</div>`
      : `<div class="entry-body empty">Anonymous silent use</div>`;

    const tagsHtml = Array.isArray(entry.tags) && entry.tags.length > 0
      ? `<div class="entry-tags">${entry.tags.map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';

    const hostNoteHtml = entry.host_note
      ? `<div class="host-note-preview"><strong>Host Note:</strong> ${escapeHtml(entry.host_note)}</div>`
      : '';

    const hasVoice = entry.voice_note_id ? '<span>🎙️ Voice note</span>' : '';
    const hasProof = entry.media_ids && entry.media_ids.length > 0 ? `<span>📸 ${entry.media_ids.length} photo(s)</span>` : '';

    return `
      <div class="entry-card" data-id="${entry.id}">
        <div class="entry-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="load-badge">#${entry.load_number || '?'}</span>
            <span class="source-badge ${sourceClass}">${sourceLabel}</span>
          </div>
          <span class="entry-time">${timeStr}</span>
        </div>
        ${bodyHtml}
        ${tagsHtml}
        ${hostNoteHtml}
        ${(hasVoice || hasProof) ? `<div class="entry-footer-meta">${hasVoice}${hasProof}</div>` : ''}
      </div>
    `;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Start Session
  btnStartSession.addEventListener('click', async () => {
    const label = startLabelInput.value.trim() || 'open';
    const qrMode = startQrModeSelect.value;

    try {
      const res = await fetch('/api/host/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, qr_mode: qrMode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start session');

      loadStatus();
    } catch (err) {
      alert(err.message);
    }
  });

  // End Session
  btnEndSession.addEventListener('click', async () => {
    if (confirm('Are you sure you want to end and archive this session?')) {
      try {
        const res = await fetch('/api/host/session/end', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to end session');

        loadStatus();
        switchTab('screen-archive');
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // Manual +1 Load
  btnAddLoad.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/host/session/load-increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to increment load');
      loadEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  // Rotate QR Token
  btnRotateToken.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/host/session/rotate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to rotate token');

      state.activeSession = data.session;
      state.qrDataUrl = data.qrDataUrl;
      state.visitorUrl = data.visitorUrl;
      renderActiveSession();
      alert('Token rotated! Any previous QR is now deactivated.');
    } catch (err) {
      alert(err.message);
    }
  });

  // Copy Link
  btnCopyUrl.addEventListener('click', () => {
    if (state.visitorUrl) {
      navigator.clipboard.writeText(state.visitorUrl);
      btnCopyUrl.textContent = 'Copied!';
      setTimeout(() => btnCopyUrl.textContent = 'Copy Link', 2000);
    }
  });

  // Door Card
  btnOpenDoorCard.addEventListener('click', () => {
    window.open('/api/host/door-card', '_blank');
  });

  // Entry Detail Modal
  function openEntryDetail(entryId) {
    const entry = state.entries.find(e => e.id === entryId);
    if (!entry) return;

    state.selectedEntry = entry;
    modalEntryTitle.textContent = `Load #${entry.load_number || '?'}`;
    modalLoadNum.textContent = `#${entry.load_number || '?'}`;
    modalBodyText.textContent = entry.body || '(Silent use)';

    modalTags.innerHTML = Array.isArray(entry.tags) && entry.tags.length > 0
      ? entry.tags.map(t => `<div class="chip active">${escapeHtml(t)}</div>`).join('')
      : '<span style="color: #666; font-size: 13px;">No tags</span>';

    // Voice note
    if (entry.voice_note_id) {
      modalVoiceSection.style.display = 'block';
      modalVoicePlayer.src = `/api/host/media/${entry.voice_note_id}`;
    } else {
      modalVoiceSection.style.display = 'none';
      modalVoicePlayer.src = '';
    }

    // Proof Gallery
    renderProofGallery(entry);

    // Host note
    modalHostNote.value = entry.host_note || '';

    entryDetailModal.style.display = 'flex';
  }

  function renderProofGallery(entry) {
    if (Array.isArray(entry.media_ids) && entry.media_ids.length > 0) {
      modalProofGallery.innerHTML = entry.media_ids.map(id => `
        <a href="/api/host/media/${id}" target="_blank">
          <img class="proof-img" src="/api/host/media/${id}" alt="Proof photo" />
        </a>
      `).join('');
    } else {
      modalProofGallery.innerHTML = '<span style="color: #666; font-size: 13px;">No photos attached yet.</span>';
    }
  }

  btnCloseModal.addEventListener('click', () => {
    entryDetailModal.style.display = 'none';
    modalVoicePlayer.pause();
    state.selectedEntry = null;
  });

  // Save Host Note
  btnSaveHostNote.addEventListener('click', async () => {
    if (!state.selectedEntry) return;
    const note = modalHostNote.value.trim();

    try {
      const res = await fetch(`/api/host/entry/${state.selectedEntry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host_note: note })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save note');

      state.selectedEntry.host_note = note;
      loadEntries();
      btnSaveHostNote.textContent = 'Saved!';
      setTimeout(() => btnSaveHostNote.textContent = 'Save Note', 1500);
    } catch (err) {
      alert(err.message);
    }
  });

  // Proof Photo Upload
  proofPhotoInput.addEventListener('change', async () => {
    if (!state.selectedEntry || !proofPhotoInput.files[0]) return;
    const file = proofPhotoInput.files[0];

    const formData = new FormData();
    formData.append('photo', file);

    try {
      const res = await fetch(`/api/host/entry/${state.selectedEntry.id}/proof`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload proof photo');

      state.selectedEntry = data.entry;
      renderProofGallery(data.entry);
      loadEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  // Debug Simulator Modal
  btnSimulateDebug.addEventListener('click', () => {
    debugModal.style.display = 'flex';
  });

  btnCloseDebug.addEventListener('click', () => {
    debugModal.style.display = 'none';
  });

  debugPresets.forEach(preset => {
    preset.addEventListener('click', () => {
      const text = preset.textContent;
      debugBody.value = text === '(blank submit)' ? '' : text;
    });
  });

  debugForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/host/session/simulate-visitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: debugBody.value })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to simulate drop');

      debugModal.style.display = 'none';
      loadEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  // Guestbook Screen (Detailed Filters & Search)
  guestbookSearch.addEventListener('input', () => {
    state.searchQuery = guestbookSearch.value.trim().toLowerCase();
    renderGuestbook();
  });

  function renderGuestbook() {
    let filtered = [...state.entries];

    if (state.filterTag) {
      filtered = filtered.filter(e => e.tags && e.tags.includes(state.filterTag));
    }

    if (state.searchQuery) {
      const q = state.searchQuery;
      filtered = filtered.filter(e =>
        (e.body && e.body.toLowerCase().includes(q)) ||
        (e.host_note && e.host_note.toLowerCase().includes(q)) ||
        (e.tags && e.tags.some(t => t.toLowerCase().includes(q)))
      );
    }

    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (filtered.length === 0) {
      guestbookFullList.innerHTML = '<div class="empty-card"><p>No entries match filter.</p></div>';
      return;
    }

    guestbookFullList.innerHTML = filtered.map(e => createEntryCardHtml(e)).join('');

    guestbookFullList.querySelectorAll('.entry-card').forEach(card => {
      card.addEventListener('click', () => openEntryDetail(card.getAttribute('data-id')));
    });

    renderFilterChips();
  }

  function renderFilterChips() {
    const allTags = new Set();
    state.entries.forEach(e => {
      if (Array.isArray(e.tags)) e.tags.forEach(t => allTags.add(t));
    });

    filterTagChips.innerHTML = Array.from(allTags).map(tag => `
      <div class="chip ${state.filterTag === tag ? 'active' : ''}" data-tag="${tag}">${escapeHtml(tag)}</div>
    `).join('');

    filterTagChips.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tag = chip.getAttribute('data-tag');
        state.filterTag = (state.filterTag === tag) ? null : tag;
        renderGuestbook();
      });
    });
  }

  // Archive Screen
  async function loadArchive() {
    try {
      const res = await fetch('/api/host/archive');
      const data = await res.json();
      const sessions = data.sessions || [];

      if (sessions.length === 0) {
        archiveList.innerHTML = '<div class="empty-card"><p>No archived sessions yet.</p></div>';
        return;
      }

      archiveList.innerHTML = sessions.map(s => {
        const startStr = new Date(s.started_at).toLocaleString();
        const totals = s.totals || { total_loads: 0, total_comments: 0 };
        return `
          <div class="card" style="margin-bottom: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="text-transform: uppercase;">${escapeHtml(s.label || 'Session')}</strong>
              <span class="source-badge" style="background: #252836;">Archived</span>
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px;">${startStr}</div>
            <div style="display: flex; gap: 14px; font-size: 13px;">
              <div><strong>${totals.total_loads}</strong> loads</div>
              <div><strong>${totals.total_comments}</strong> notes</div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load archive:', err);
    }
  }

  // Settings Screen
  async function loadSettings() {
    try {
      const res = await fetch('/api/host/settings');
      const data = await res.json();
      state.config = data.config;

      settingDefaultQrMode.value = state.config.default_qr_mode || 'session-long';
      renderTagsEditor();
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  function renderTagsEditor() {
    if (!state.config || !state.config.enabled_tags) return;
    tagsEditor.innerHTML = state.config.enabled_tags.map(tag => `
      <div class="chip active" style="display: inline-flex; align-items: center; gap: 6px; margin: 4px;">
        <span>${escapeHtml(tag)}</span>
        <span class="remove-tag-btn" data-tag="${tag}" style="cursor: pointer; opacity: 0.7;">✕</span>
      </div>
    `).join('');

    tagsEditor.querySelectorAll('.remove-tag-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = btn.getAttribute('data-tag');
        removeTag(tag);
      });
    });
  }

  async function removeTag(tag) {
    const updated = state.config.enabled_tags.filter(t => t !== tag);
    saveSettings({ enabled_tags: updated });
  }

  btnAddTag.addEventListener('click', () => {
    const newTag = newTagInput.value.trim();
    if (!newTag) return;
    if (state.config.enabled_tags.includes(newTag)) return;

    const updated = [...state.config.enabled_tags, newTag];
    newTagInput.value = '';
    saveSettings({ enabled_tags: updated });
  });

  settingDefaultQrMode.addEventListener('change', () => {
    saveSettings({ default_qr_mode: settingDefaultQrMode.value });
  });

  async function saveSettings(updates) {
    try {
      const res = await fetch('/api/host/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      const data = await res.json();
      state.config = data.config;
      renderTagsEditor();
    } catch (err) {
      alert(err.message);
    }
  }

  // Export & Import
  btnExportBackup.addEventListener('click', () => {
    window.location.href = '/api/host/export';
  });

  importBackupFile.addEventListener('change', async () => {
    if (!importBackupFile.files[0]) return;
    const file = importBackupFile.files[0];
    const text = await file.text();

    try {
      const json = JSON.parse(text);
      const res = await fetch('/api/host/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');

      alert(`Imported ${data.importedSessionsCount} sessions and ${data.importedEntriesCount} entries.`);
      loadStatus();
    } catch (err) {
      alert(err.message);
    }
  });

  btnChangePassphrase.addEventListener('click', async () => {
    const newPass = prompt('Enter new private passphrase:');
    if (!newPass) return;
    try {
      const res = await fetch('/api/host/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: newPass })
      });
      if (res.ok) {
        alert('Passphrase updated successfully.');
      }
    } catch (err) {
      alert(err.message);
    }
  });

  // Real-time Server-Sent Events (SSE)
  function initSSE() {
    const evtSource = new EventSource('/api/host/events');

    evtSource.addEventListener('entry_created', (e) => {
      const data = JSON.parse(e.data);
      state.totals = data.totals;

      // Add to entries if belongs to active session
      if (state.activeSession && state.activeSession.id === data.session_id) {
        state.entries.push(data.entry);
        renderActiveEntries();
        renderActiveSession();
      }
    });

    evtSource.addEventListener('session_started', (e) => {
      const session = JSON.parse(e.data);
      state.activeSession = session;
      loadStatus();
    });

    evtSource.addEventListener('session_ended', () => {
      state.activeSession = null;
      renderActiveSession();
    });

    evtSource.addEventListener('token_rotated', (e) => {
      const session = JSON.parse(e.data);
      if (state.activeSession && state.activeSession.id === session.id) {
        state.activeSession = session;
        loadStatus();
      }
    });

    evtSource.onerror = () => {
      // Reconnection handled automatically by browser
    };
  }

  // Initialize
  loadStatus();
  initSSE();
})();
