const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CryptoService = require('../src/services/CryptoService');

describe('CryptoService', () => {
  const testSaltPath = path.join(__dirname, 'test_salt.bin');

  it('initializes and locks by default unless unlocked', () => {
    const cs = new CryptoService({ saltPath: testSaltPath });
    assert.strictEqual(cs.getStatus().isLocked, true);
    assert.throws(() => cs.encrypt('test data'), /Database is locked/);
  });

  it('unlocks with a passphrase and encrypts/decrypts strings correctly', () => {
    const cs = new CryptoService({ saltPath: testSaltPath, passphrase: 'master_host_key_123' });
    assert.strictEqual(cs.getStatus().isLocked, false);

    const secret = 'Private load record 1: second load, kept it in';
    const encrypted = cs.encryptString(secret);
    assert.notStrictEqual(encrypted, secret);

    const decrypted = cs.decryptString(encrypted);
    assert.strictEqual(decrypted, secret);
  });

  it('encrypts and decrypts JSON objects with high fidelity', () => {
    const cs = new CryptoService({ saltPath: testSaltPath, passphrase: 'master_host_key_123' });
    const payload = {
      source: 'visitor',
      body: 'tight, took it raw',
      tags: ['Raw', 'Kept inside'],
      load_number: 2
    };

    const encrypted = cs.encryptJSON(payload);
    const decrypted = cs.decryptJSON(encrypted);
    assert.deepStrictEqual(decrypted, payload);
  });

  it('fails decryption if ciphertext or authentication tag is tampered with', () => {
    const cs = new CryptoService({ saltPath: testSaltPath, passphrase: 'master_host_key_123' });
    const encrypted = cs.encrypt(Buffer.from('authentic data'));

    // Tamper with the last byte
    encrypted[encrypted.length - 1] ^= 0x01;

    assert.throws(() => {
      cs.decrypt(encrypted);
    });
  });

  it('locks cleanly and wipes active key', () => {
    const cs = new CryptoService({ saltPath: testSaltPath, passphrase: 'master_host_key_123' });
    cs.lock();
    assert.strictEqual(cs.getStatus().isLocked, true);
    assert.throws(() => cs.encrypt('fail'), /Database is locked/);
  });

  // Cleanup test salt
  it('cleans up test artifacts', () => {
    if (fs.existsSync(testSaltPath)) {
      fs.unlinkSync(testSaltPath);
    }
  });
});
