const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class MediaService {
  constructor(cryptoService, options = {}) {
    this.cryptoService = cryptoService;
    this.mediaDir = options.mediaDir || path.join(__dirname, '../../data/media');
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.mediaDir)) {
      fs.mkdirSync(this.mediaDir, { recursive: true });
    }
  }

  /**
   * Save an incoming buffer as an encrypted media item in the sandbox.
   * @param {Buffer} buffer - Raw file bytes
   * @param {string} mimeType - e.g. "image/jpeg", "audio/webm"
   * @param {string} originalName - optional file name
   * @returns {Object} { id, filename, mimeType, size }
   */
  saveEncryptedMedia(buffer, mimeType = 'application/octet-stream', originalName = '') {
    if (this.cryptoService.isLocked) {
      throw new Error('Cannot store media: Encrypted storage is locked');
    }

    const id = uuidv4();
    const encFilename = `${id}.enc`;
    const destPath = path.join(this.mediaDir, encFilename);

    // Metadata header + data
    const meta = {
      id,
      mimeType,
      originalName,
      created_at: new Date().toISOString()
    };

    const metaBuffer = Buffer.from(JSON.stringify(meta), 'utf8');
    const metaLen = Buffer.alloc(4);
    metaLen.writeUInt32BE(metaBuffer.length, 0);

    const fullPayload = Buffer.concat([metaLen, metaBuffer, buffer]);
    const encrypted = this.cryptoService.encrypt(fullPayload);

    fs.writeFileSync(destPath, encrypted, { mode: 0o600 });

    return {
      id,
      encFilename,
      mimeType,
      size: buffer.length
    };
  }

  /**
   * Decrypt and retrieve media by ID.
   * @param {string} id
   * @returns {Object} { meta, buffer }
   */
  getDecryptedMedia(id) {
    if (this.cryptoService.isLocked) {
      throw new Error('Cannot read media: Encrypted storage is locked');
    }

    // Sanitize id to prevent directory traversal
    const safeId = path.basename(id).replace(/\.enc$/, '');
    const filePath = path.join(this.mediaDir, `${safeId}.enc`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const encryptedData = fs.readFileSync(filePath);
    const decryptedPayload = this.cryptoService.decrypt(encryptedData);

    const metaLen = decryptedPayload.readUInt32BE(0);
    const metaBuffer = decryptedPayload.subarray(4, 4 + metaLen);
    const meta = JSON.parse(metaBuffer.toString('utf8'));
    const buffer = decryptedPayload.subarray(4 + metaLen);

    return { meta, buffer };
  }

  /**
   * Delete media file by ID.
   */
  deleteMedia(id) {
    const safeId = path.basename(id).replace(/\.enc$/, '');
    const filePath = path.join(this.mediaDir, `${safeId}.enc`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}

module.exports = MediaService;
