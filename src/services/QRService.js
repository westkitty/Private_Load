const os = require('os');
const QRCode = require('qrcode');

class QRService {
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.hostIp = options.hostIp || this._detectLocalIp();
  }

  _detectLocalIp() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip over non-IPv4 and internal/loopback addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          // Prefer standard Wi-Fi (en0 on Mac)
          if (name === 'en0') {
            return iface.address;
          }
          candidates.push(iface.address);
        }
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    return 'localhost';
  }

  setHostIp(ip) {
    this.hostIp = ip;
  }

  setPort(port) {
    this.port = port;
  }

  getVisitorUrl(token) {
    return `http://${this.hostIp}:${this.port}/l/${token}`;
  }

  async generateQRCodeDataUrl(token, options = {}) {
    const url = this.getVisitorUrl(token);
    return await QRCode.toDataURL(url, {
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin || 2,
      width: options.width || 400,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#ffffff'
      }
    });
  }

  async generateQRCodeSVG(token, options = {}) {
    const url = this.getVisitorUrl(token);
    return await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: options.errorCorrectionLevel || 'M',
      margin: options.margin || 2,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#ffffff'
      }
    });
  }

  /**
   * Generates a printable door card HTML layout.
   */
  async generatePrintableCard(token, label = 'Private Guestbook') {
    const url = this.getVisitorUrl(token);
    const qrDataUrl = await this.generateQRCodeDataUrl(token, { width: 320 });

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Leaving QR — Door Card</title>
  <style>
    @media print {
      body { margin: 0; background: white; }
      .no-print { display: none; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #111;
      color: #eee;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #ffffff;
      color: #111111;
      border: 2px solid #333;
      border-radius: 16px;
      padding: 32px;
      width: 320px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .title {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .subtitle {
      font-size: 13px;
      color: #666;
      margin-bottom: 24px;
    }
    .qr-container img {
      width: 260px;
      height: 260px;
      display: block;
      margin: 0 auto;
    }
    .instructions {
      margin-top: 20px;
      font-size: 14px;
      line-height: 1.4;
      font-weight: 600;
      color: #222;
    }
    .sub-instructions {
      font-size: 11px;
      color: #777;
      margin-top: 8px;
    }
    .url {
      font-family: monospace;
      font-size: 10px;
      color: #888;
      margin-top: 16px;
      word-break: break-all;
    }
    .print-btn {
      margin-top: 20px;
      background: #e63946;
      color: white;
      border: none;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: bold;
      border-radius: 8px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">${label}</div>
    <div class="subtitle">On your way out</div>
    <div class="qr-container">
      <img src="${qrDataUrl}" alt="Scan to leave comment" />
    </div>
    <div class="instructions">Scan to leave an anonymous note.</div>
    <div class="sub-instructions">No account. No cloud. Instant & private.</div>
    <div class="url">${url}</div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">Print Card</button>
</body>
</html>`;
  }
}

module.exports = QRService;
