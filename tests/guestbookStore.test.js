const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CryptoService = require('../src/services/CryptoService');
const { GuestbookStore, DEFAULT_TAGS } = require('../src/services/GuestbookStore');

describe('GuestbookStore', () => {
  const tmpDir = path.join(__dirname, 'tmp_store_test');
  const dbPath = path.join(tmpDir, 'guestbook.enc');
  const saltPath = path.join(tmpDir, '.salt');
  let cryptoService;
  let store;

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    cryptoService = new CryptoService({ saltPath, passphrase: 'test_passphrase_store' });
    store = new GuestbookStore(cryptoService, { dbPath });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('initializes with default tags and empty sessions', () => {
    const config = store.getConfig();
    assert.deepStrictEqual(config.enabled_tags, DEFAULT_TAGS);
    assert.strictEqual(store.getActiveSession(), null);
  });

  it('creates and retrieves an active session', () => {
    const session = store.createSession({ label: 'hosting', qr_mode: 'session-long' });
    assert.ok(session.id);
    assert.strictEqual(session.label, 'hosting');
    assert.strictEqual(session.status, 'active');

    const retrieved = store.getActiveSession();
    assert.strictEqual(retrieved.id, session.id);
  });

  it('orders entries strictly by created_at ASCENDING', () => {
    const session = store.createSession({ label: 'open' });

    // Insert entries out of chronological order
    const t1 = new Date(Date.now() - 30000).toISOString();
    const t2 = new Date(Date.now() - 20000).toISOString();
    const t3 = new Date(Date.now() - 10000).toISOString();

    store.createEntry({ session_id: session.id, body: 'third load', created_at: t3, load_number: 3 });
    store.createEntry({ session_id: session.id, body: 'first load', created_at: t1, load_number: 1 });
    store.createEntry({ session_id: session.id, body: 'second load', created_at: t2, load_number: 2 });

    const entries = store.getEntries(session.id);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].body, 'first load');
    assert.strictEqual(entries[1].body, 'second load');
    assert.strictEqual(entries[2].body, 'third load');
  });

  it('treats blank submits as valid silent use markers and auto-increments load numbers', () => {
    const session = store.createSession({ label: 'open' });

    const e1 = store.createEntry({ session_id: session.id, body: null, tags: [] });
    assert.strictEqual(e1.load_number, 1);
    assert.strictEqual(e1.body, null);

    const e2 = store.createEntry({ session_id: session.id, body: '', tags: ['Raw'] });
    assert.strictEqual(e2.load_number, 2);
    assert.strictEqual(e2.body, null);
    assert.deepStrictEqual(e2.tags, ['Raw']);

    const totals = store.getSessionTotals(session.id);
    assert.strictEqual(totals.total_loads, 2);
    assert.strictEqual(totals.total_comments, 0); // No non-empty comments
    assert.strictEqual(totals.tag_counts['Raw'], 1);
  });

  it('allows host to append private notes and proof media after the fact', () => {
    const session = store.createSession({ label: 'open' });
    const entry = store.createEntry({
      session_id: session.id,
      body: 'tight, took it raw',
      tags: ['Raw', 'Kept inside']
    });

    store.updateEntry(entry.id, {
      host_note: 'Guy was tall, heavy load',
      media_ids: ['media-proof-uuid-1']
    });

    const updated = store.getEntry(entry.id);
    assert.strictEqual(updated.host_note, 'Guy was tall, heavy load');
    assert.deepStrictEqual(updated.media_ids, ['media-proof-uuid-1']);
  });

  it('ends session and freezes immutable archive totals', () => {
    const session = store.createSession({ label: 'cruising' });
    store.createEntry({ session_id: session.id, body: 'came back for another', tags: ['Came back'] });
    store.createEntry({ session_id: session.id, body: null, tags: [] });

    const archived = store.endSession(session.id);
    assert.strictEqual(archived.status, 'archived');
    assert.ok(archived.ended_at);
    assert.strictEqual(archived.totals.total_loads, 2);
    assert.strictEqual(archived.totals.total_comments, 1);
    assert.strictEqual(archived.totals.tag_counts['Came back'], 1);

    assert.strictEqual(store.getActiveSession(), null);
  });

  it('persists encrypted data on disk and recovers upon reload', () => {
    const session = store.createSession({ label: 'encrypted_test' });
    store.createEntry({ session_id: session.id, body: 'pushed it back in', tags: ['Pushed back'] });

    // Create a new store instance pointing to same file
    const store2 = new GuestbookStore(cryptoService, { dbPath });
    const entries = store2.getEntries(session.id);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].body, 'pushed it back in');
  });
});
