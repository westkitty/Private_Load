const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CryptoService = require('../src/services/CryptoService');
const { GuestbookStore } = require('../src/services/GuestbookStore');
const QRService = require('../src/services/QRService');
const SessionManager = require('../src/services/SessionManager');

describe('SessionManager', () => {
  const tmpDir = path.join(__dirname, 'tmp_mgr_test');
  const dbPath = path.join(tmpDir, 'guestbook.enc');
  const saltPath = path.join(tmpDir, '.salt');
  let store;
  let qrService;
  let manager;

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const cryptoService = new CryptoService({ saltPath, passphrase: 'mgr_test_pass' });
    store = new GuestbookStore(cryptoService, { dbPath });
    qrService = new QRService({ port: 3000, hostIp: '192.168.1.50' });
    manager = new SessionManager(store, qrService);
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates tokens for active sessions', () => {
    const session = manager.startSession({ label: 'open', qr_mode: 'session-long' });
    const checkValid = manager.validateToken(session.qr_token);
    assert.strictEqual(checkValid.valid, true);
    assert.strictEqual(checkValid.session.id, session.id);

    const checkInvalid = manager.validateToken('non_existent_token');
    assert.strictEqual(checkInvalid.valid, false);
  });

  it('automatically rotates token upon visitor submission in single-use mode', () => {
    const session = manager.startSession({ label: 'open', qr_mode: 'single-use' });
    const token1 = session.qr_token;

    manager.submitEntry({
      token: token1,
      source: 'visitor',
      body: 'quick'
    });

    // Old token must be invalidated
    const checkOld = manager.validateToken(token1);
    assert.strictEqual(checkOld.valid, false);

    // Active session has new rotated token
    const active = manager.getActiveSession();
    assert.notStrictEqual(active.qr_token, token1);

    const checkNew = manager.validateToken(active.qr_token);
    assert.strictEqual(checkNew.valid, true);
  });

  it('handles time-boxed expiration properly', () => {
    const session = manager.startSession({
      label: 'timed',
      qr_mode: 'time-boxed',
      time_box_minutes: -1 // Already expired 1 minute ago
    });

    const checkExpired = manager.validateToken(session.qr_token);
    assert.strictEqual(checkExpired.valid, false);
    assert.match(checkExpired.error, /expired/);
  });

  it('emits events on entry creation and manual host increments', (t, done) => {
    const session = manager.startSession({ label: 'event_test' });

    manager.once('entry_created', ({ entry, totals }) => {
      assert.strictEqual(entry.session_id, session.id);
      assert.strictEqual(totals.total_loads, 1);
      done();
    });

    manager.manualIncrementLoad('Host observed load');
  });
});
