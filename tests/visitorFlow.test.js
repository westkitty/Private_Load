const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const createApp = require('../src/server');

describe('Visitor Flow & Host API Integration', () => {
  const tmpDir = path.join(__dirname, 'tmp_integration_test');
  const dbPath = path.join(tmpDir, 'guestbook.enc');
  const saltPath = path.join(tmpDir, '.salt');
  const mediaDir = path.join(tmpDir, 'media');
  let app;
  let sessionManager;

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    const serverObj = createApp({
      dbPath,
      saltPath,
      mediaDir,
      passphrase: 'test_integration_passphrase_2026'
    });

    app = serverObj.app;
    sessionManager = serverObj.sessionManager;
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('serves the visitor form under 15 KB and session config for valid token', async () => {
    const session = sessionManager.startSession({ label: 'open', qr_mode: 'session-long' });

    const resPage = await request(app).get(`/l/${session.qr_token}`);
    assert.strictEqual(resPage.status, 200);
    assert.match(resPage.text, /LEAVING/);
    assert.ok(resPage.text.length < 15360, `Form size is ${resPage.text.length} bytes, must be under 15KB`);

    const resConfig = await request(app).get(`/api/visitor/session/${session.qr_token}`);
    assert.strictEqual(resConfig.status, 200);
    assert.strictEqual(resConfig.body.label, 'open');
    assert.ok(Array.isArray(resConfig.body.enabled_tags));
  });

  it('rejects invalid or closed tokens gracefully with 404', async () => {
    const res = await request(app).get('/l/bogus_invalid_token');
    assert.strictEqual(res.status, 404);
    assert.match(res.text, /Session Unavailable/);
  });

  it('accepts anonymous visitor submission with text, tags, and custom load #', async () => {
    const session = sessionManager.startSession({ label: 'hosting' });

    const res = await request(app)
      .post(`/api/visitor/submit/${session.qr_token}`)
      .field('body', 'second load, kept it in')
      .field('tags', JSON.stringify(['Raw', 'Kept inside']))
      .field('load_number', '2');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.message, 'Got it');

    // Verify host entries
    const hostRes = await request(app).get('/api/host/session/entries');
    assert.strictEqual(hostRes.status, 200);
    assert.strictEqual(hostRes.body.entries.length, 1);
    const entry = hostRes.body.entries[0];
    assert.strictEqual(entry.body, 'second load, kept it in');
    assert.deepStrictEqual(entry.tags, ['Raw', 'Kept inside']);
    assert.strictEqual(entry.load_number, 2);
    assert.strictEqual(entry.source, 'visitor');
  });

  it('accepts blank visitor submit as valid silent use marker', async () => {
    const session = sessionManager.startSession({ label: 'open' });

    const res = await request(app)
      .post(`/api/visitor/submit/${session.qr_token}`)
      .field('body', '')
      .field('tags', JSON.stringify([]));

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    const hostRes = await request(app).get('/api/host/session/entries');
    assert.strictEqual(hostRes.body.entries.length, 1);
    const entry = hostRes.body.entries[0];
    assert.strictEqual(entry.body, null);
    assert.strictEqual(entry.load_number, 1);
  });

  it('accepts visitor voice note and saves encrypted in sandbox', async () => {
    const session = sessionManager.startSession({ label: 'open' });
    const fakeAudioBuffer = Buffer.from('RIFF....WAVEfmt....data....fakeaudiobytes');

    const res = await request(app)
      .post(`/api/visitor/submit/${session.qr_token}`)
      .field('body', 'tight, took it raw')
      .attach('voice_note', fakeAudioBuffer, 'voice.webm');

    assert.strictEqual(res.status, 200);

    const hostRes = await request(app).get('/api/host/session/entries');
    const entry = hostRes.body.entries[0];
    assert.ok(entry.voice_note_id);

    // Verify decrypted media can be retrieved
    const mediaRes = await request(app).get(`/api/host/media/${entry.voice_note_id}`);
    assert.strictEqual(mediaRes.status, 200);
    assert.deepStrictEqual(mediaRes.body, fakeAudioBuffer);
  });

  it('allows host to attach proof photo and host notes to entry', async () => {
    const session = sessionManager.startSession({ label: 'open' });
    sessionManager.submitEntry({ token: session.qr_token, body: 'quick' });

    const entriesRes = await request(app).get('/api/host/session/entries');
    const entryId = entriesRes.body.entries[0].id;

    // Attach proof photo
    const fakePhoto = Buffer.from('fake_jpeg_image_bytes_proof_123');
    const proofRes = await request(app)
      .post(`/api/host/entry/${entryId}/proof`)
      .attach('photo', fakePhoto, 'proof.jpg');

    assert.strictEqual(proofRes.status, 200);
    assert.ok(proofRes.body.media_id);

    // Save host note
    const noteRes = await request(app)
      .patch(`/api/host/entry/${entryId}`)
      .send({ host_note: 'Verified in car' });

    assert.strictEqual(noteRes.status, 200);
    assert.strictEqual(noteRes.body.entry.host_note, 'Verified in car');
    assert.strictEqual(noteRes.body.entry.media_ids.length, 1);

    // Decrypt and stream proof photo
    const mediaRes = await request(app).get(`/api/host/media/${proofRes.body.media_id}`);
    assert.strictEqual(mediaRes.status, 200);
    assert.deepStrictEqual(mediaRes.body, fakePhoto);
  });

  it('archives session with frozen totals on end', async () => {
    const session = sessionManager.startSession({ label: 'hosting' });
    sessionManager.submitEntry({ token: session.qr_token, body: 'load 1', tags: ['Raw'] });
    sessionManager.submitEntry({ token: session.qr_token, body: '', tags: [] });

    const endRes = await request(app).post('/api/host/session/end');
    assert.strictEqual(endRes.status, 200);
    assert.strictEqual(endRes.body.session.status, 'archived');
    assert.strictEqual(endRes.body.session.totals.total_loads, 2);

    const archiveRes = await request(app).get('/api/host/archive');
    assert.strictEqual(archiveRes.status, 200);
    assert.strictEqual(archiveRes.body.sessions.length, 1);
  });
});
