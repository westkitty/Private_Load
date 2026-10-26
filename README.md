# Leaving QR — Private Sequential Load Guestbook

A local-first, mobile-optimized application for tracking uses in high-volume, sequential order. 
When hosting or cruising, the host opens a session to generate a scannable Leaving QR code. On the way out, any visitor can scan the code with a standard mobile camera and immediately drop an anonymous note, tags, load count, voice note, or simply tap submit blank (registering a silent use). 

All data lands exclusively on the host's device in an authenticated, encrypted database (AES-256-GCM with PBKDF2 key derivation). No accounts, no cloud dependencies, and zero tracking.

---

## Key Features

- **Local-First & Airplane-Mode Ready**: Runs a local embedded HTTP service on the host device. Automatically detects local Wi-Fi / hotspot IP (`http://<LAN-IP>:3000/l/<token>`) so anyone on the same network can scan and submit without installing anything.
- **Ultra-Lightweight Visitor Form**: Single standalone HTML/JS screen (< 15 KB, 0 dependencies), dark OLED design, max 280 char text area, selectable tag chips, load # selector, optional voice note (`MediaRecorder`), always-enabled submit button (blank submit = silent use marker), instant "Got it" confirmation.
- **QR Token Modes**:
  - `session-long` (default: persistent for the session)
  - `single-use` (rotates token immediately after each submission)
  - `time-boxed` (configurable expiry, e.g. 15 minutes)
  - `reusable-door-token` (printable bedside/door card layout)
- **Chronological Sequence of Uses**: Guestbook is strictly sorted by `created_at` ASCENDING within each session, showing sequential load numbers (`#1`, `#2`, `#3`...).
- **Host Capture & Threading**: Host can attach private notes and encrypted proof photos (from camera or library) directly to any visitor entry. Photos stay encrypted inside the app sandbox.
- **Real-Time Live Feed**: Integrated Server-Sent Events (SSE) updates the host screen in real-time as visitors submit.
- **Archiving & Summary Totals**: Ending a session computes and freezes total loads, comments, voice notes, proof photos, and tag counts.
- **Passphrase Security & Backup**: Host vault can be locked with a custom passphrase. Supports encrypted JSON backup export and import.

---

## Quick Start

### 1. Requirements
- Node.js (v18+)

### 2. Start Application
```bash
npm start
```
By default, the server starts on port `3000` and displays:
```
=======================================================
 Leaving QR — Private Sequential Load Guestbook
=======================================================
 Host Web Interface:  http://localhost:3000/host
 Local Network IP:    192.168.1.50
 Visitor Base URL:    http://192.168.1.50:3000/l/<token>
 Encrypted Database:  aes-256-gcm authenticated
 Status:              Ready for sequential logging
=======================================================
```

### 3. Open Host App
Open your mobile browser or desktop browser to `http://localhost:3000/host` (or your LAN IP from your phone).

### 4. Open Session & Surface QR
Tap **"Open Session & Surface QR"**. Show the QR code or tap the **QR** tab for full-screen display. Visitors scan the code as they walk out.

---

## Visitor Submission Examples

The visitor form comfortably accepts direct domain comments, including:
- *"second load, kept it in"*
- *"still leaking from the last guy"*
- *"tight, took it raw"*
- *"quick"*
- *"came back for another"*
- *"used you while you were open"*
- *"group turn"*
- *"pushed it back in"*
- *"rough"*
- Blank submission (silent use marker)

Configurable tag chips: `Raw`, `Kept inside`, `Leaked`, `Pushed back`, `Rough`, `Quick`, `Came back`, `Already open`, `Public`, `Car`, `Group`, `Load #`.

---

## Running Automated Tests

Run the full test suite (unit tests, crypto verification, session manager, and end-to-end integration flows):

```bash
npm test
```

Run the playtest simulation:
```bash
node tests/playtestDemo.js
```
