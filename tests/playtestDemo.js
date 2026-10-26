const request = require('supertest');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const createApp = require('../src/server');

async function runPlaytest() {
  console.log('--- Starting Leaving QR Playtest Simulation ---');

  const tmpDir = path.join(__dirname, 'playtest_sandbox');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  const { app, sessionManager, qrService } = createApp({
    dbPath: path.join(tmpDir, 'guestbook.enc'),
    saltPath: path.join(tmpDir, '.salt'),
    mediaDir: path.join(tmpDir, 'media'),
    passphrase: 'host_secret_passphrase_playtest'
  });

  // 1. Host opens session
  console.log('1. Host opens a new session: "hosting"');
  const session = sessionManager.startSession({
    label: 'hosting',
    qr_mode: 'session-long'
  });
  console.log(`   Session ID: ${session.id}`);
  console.log(`   QR Token:   ${session.qr_token}`);
  console.log(`   Visitor URL: ${qrService.getVisitorUrl(session.qr_token)}`);

  // 2. Visitor 1 walks out, scans QR, leaves note: "tight, took it raw" + tags ["Raw"]
  console.log('2. Visitor 1 submits: "tight, took it raw" [Raw]');
  const v1 = await request(app)
    .post(`/api/visitor/submit/${session.qr_token}`)
    .field('body', 'tight, took it raw')
    .field('tags', JSON.stringify(['Raw']));
  assert.strictEqual(v1.status, 200);

  // 3. Visitor 2 drops a blank submit (silent use marker)
  console.log('3. Visitor 2 drops blank submit (silent use marker)');
  const v2 = await request(app)
    .post(`/api/visitor/submit/${session.qr_token}`)
    .field('body', '')
    .field('tags', JSON.stringify([]));
  assert.strictEqual(v2.status, 200);

  // 4. Visitor 3 leaves note: "second load, kept it in" + tags ["Kept inside"] + voice note
  console.log('4. Visitor 3 submits: "second load, kept it in" [Kept inside] with voice note');
  const v3Audio = Buffer.from('audio_samples_webm_voice_note_123');
  const v3 = await request(app)
    .post(`/api/visitor/submit/${session.qr_token}`)
    .field('body', 'second load, kept it in')
    .field('tags', JSON.stringify(['Kept inside']))
    .attach('voice_note', v3Audio, 'voice.webm');
  assert.strictEqual(v3.status, 200);

  // 5. Host checks guestbook sequence
  console.log('5. Host checks active session guestbook:');
  const entriesRes = await request(app).get('/api/host/session/entries');
  assert.strictEqual(entriesRes.status, 200);
  const entries = entriesRes.body.entries;
  assert.strictEqual(entries.length, 3);

  entries.forEach(e => {
    console.log(`   Load #${e.load_number} [${e.source}] - ${e.body || '(Silent use)'} | Tags: ${e.tags.join(', ') || 'none'}`);
  });

  // Verify created_at ascending sequence
  assert.strictEqual(entries[0].load_number, 1);
  assert.strictEqual(entries[0].body, 'tight, took it raw');
  assert.strictEqual(entries[1].load_number, 2);
  assert.strictEqual(entries[1].body, null);
  assert.strictEqual(entries[2].load_number, 3);
  assert.strictEqual(entries[2].body, 'second load, kept it in');
  assert.ok(entries[2].voice_note_id);

  // 6. Host attaches proof photo to Load #3 and adds private note
  console.log('6. Host attaches proof photo and note to Load #3:');
  const fakePhoto = Buffer.from('photo_jpeg_proof_bytes_encrypted_sandbox');
  const proofRes = await request(app)
    .post(`/api/host/entry/${entries[2].id}/proof`)
    .attach('photo', fakePhoto, 'hole_proof.jpg');
  assert.strictEqual(proofRes.status, 200);

  const noteRes = await request(app)
    .patch(`/api/host/entry/${entries[2].id}`)
    .send({ host_note: 'Filled deep, leaked after 20 mins' });
  assert.strictEqual(noteRes.status, 200);
  console.log('   Proof photo attached and host note saved.');

  // 7. Verify photo stored encrypted in sandbox
  const proofMediaId = proofRes.body.media_id;
  const encryptedFilePath = path.join(tmpDir, 'media', `${proofMediaId}.enc`);
  assert.ok(fs.existsSync(encryptedFilePath), 'Encrypted proof file must exist on disk');
  const rawBytesOnDisk = fs.readFileSync(encryptedFilePath);
  assert.notDeepStrictEqual(rawBytesOnDisk, fakePhoto, 'File on disk must be encrypted ciphertext');

  // Verify decrypted streaming
  const mediaStreamRes = await request(app).get(`/api/host/media/${proofMediaId}`);
  assert.strictEqual(mediaStreamRes.status, 200);
  assert.deepStrictEqual(mediaStreamRes.body, fakePhoto);
  console.log('   Encrypted proof verified on disk and stream-decrypted successfully.');

  // 8. Host ends session and checks archived totals
  console.log('8. Host ends session and verifies archive:');
  const endRes = await request(app).post('/api/host/session/end');
  assert.strictEqual(endRes.status, 200);
  const archived = endRes.body.session;
  assert.strictEqual(archived.status, 'archived');
  assert.strictEqual(archived.totals.total_loads, 3);
  assert.strictEqual(archived.totals.total_comments, 2);
  assert.strictEqual(archived.totals.total_proof_media, 1);
  assert.strictEqual(archived.totals.total_voice_notes, 1);
  console.log(`   Archived Totals: ${archived.totals.total_loads} loads, ${archived.totals.total_comments} comments, ${archived.totals.total_proof_media} proof photos, ${archived.totals.total_voice_notes} voice notes.`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('--- Playtest Simulation Completed Successfully! ---');
}

runPlaytest().catch(err => {
  console.error('Playtest failed:', err);
  process.exit(1);
});
