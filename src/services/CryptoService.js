const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class CryptoService {
  constructor(options = {}) {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 12;  // 96 bits recommended for GCM
    this.tagLength = 16; // 128 bits
    this.saltLength = 16;
    this.iterations = 100000;
    this.digest = 'sha256';

    this.activeKey = null;
    this.isLocked = true;
    this.salt = null;

    // Optional persistent salt path
    this.saltPath = options.saltPath || path.join(__dirname, '../../data/.salt');
    this._initSalt();

    if (options.passphrase) {
      this.unlock(options.passphrase);
    }
  }

  _initSalt() {
    try {
      if (fs.existsSync(this.saltPath)) {
        this.salt = fs.readFileSync(this.saltPath);
      } else {
        const dir = path.dirname(this.saltPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        this.salt = crypto.randomBytes(this.saltLength);
        fs.writeFileSync(this.saltPath, this.salt, { mode: 0o600 });
      }
    } catch (err) {
      this.salt = crypto.randomBytes(this.saltLength);
    }
  }

  deriveKey(passphrase, customSalt = null) {
    const saltToUse = customSalt || this.salt;
    return crypto.pbkdf2Sync(
      passphrase,
      saltToUse,
      this.iterations,
      this.keyLength,
      this.digest
    );
  }

  unlock(passphrase) {
    if (!passphrase || typeof passphrase !== 'string') {
      throw new Error('Valid passphrase required to unlock');
    }
    this.activeKey = this.deriveKey(passphrase);
    this.isLocked = false;
    return true;
  }

  lock() {
    if (this.activeKey) {
      this.activeKey.fill(0); // Zero memory
      this.activeKey = null;
    }
    this.isLocked = true;
  }

  getStatus() {
    return {
      isLocked: this.isLocked,
      hasSalt: !!this.salt
    };
  }

  encrypt(plainData, key = null) {
    const encKey = key || this.activeKey;
    if (!encKey) {
      throw new Error('Database is locked. Passphrase required for encryption.');
    }

    const dataBuffer = Buffer.isBuffer(plainData)
      ? plainData
      : Buffer.from(typeof plainData === 'object' ? JSON.stringify(plainData) : String(plainData), 'utf8');

    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, encKey, iv);

    const encrypted = Buffer.concat([cipher.update(dataBuffer), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Packed format: [iv (12)][tag (16)][encrypted data]
    return Buffer.concat([iv, tag, encrypted]);
  }

  decrypt(packedBuffer, key = null) {
    const encKey = key || this.activeKey;
    if (!encKey) {
      throw new Error('Database is locked. Passphrase required for decryption.');
    }

    if (!Buffer.isBuffer(packedBuffer)) {
      packedBuffer = Buffer.from(packedBuffer, 'base64');
    }

    if (packedBuffer.length < this.ivLength + this.tagLength) {
      throw new Error('Invalid encrypted payload length');
    }

    const iv = packedBuffer.subarray(0, this.ivLength);
    const tag = packedBuffer.subarray(this.ivLength, this.ivLength + this.tagLength);
    const encrypted = packedBuffer.subarray(this.ivLength + this.tagLength);

    const decipher = crypto.createDecipheriv(this.algorithm, encKey, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted;
  }

  encryptString(str, key = null) {
    const encrypted = this.encrypt(str, key);
    return encrypted.toString('base64');
  }

  decryptString(base64Str, key = null) {
    const decrypted = this.decrypt(Buffer.from(base64Str, 'base64'), key);
    return decrypted.toString('utf8');
  }

  encryptJSON(obj, key = null) {
    return this.encryptString(JSON.stringify(obj), key);
  }

  decryptJSON(base64Str, key = null) {
    const decryptedStr = this.decryptString(base64Str, key);
    return JSON.parse(decryptedStr);
  }

  // Encrypt file to destination
  encryptFile(sourcePath, destPath, key = null) {
    const data = fs.readFileSync(sourcePath);
    const encrypted = this.encrypt(data, key);
    fs.writeFileSync(destPath, encrypted, { mode: 0o600 });
    return destPath;
  }

  // Decrypt file to buffer
  decryptFile(filePath, key = null) {
    const encryptedData = fs.readFileSync(filePath);
    return this.decrypt(encryptedData, key);
  }
}

module.exports = CryptoService;
