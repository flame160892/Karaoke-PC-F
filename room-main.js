// Karaoke-PC-F Room — aplikasi khusus layar TV di dalam room.
// Menemukan komputer kasir otomatis, memutar layar room, tersambung ulang sendiri bila jaringan/kasir mati.
'use strict';
const { app, BrowserWindow, ipcMain, Menu, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { discover, hello } = require('./lib/discover');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const cfgFile = () => path.join(app.getPath('userData'), 'room-config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1));

let win = null, mode = 'setup', retryTimer = null, failCount = 0;
const SETUP = path.join(__dirname, 'public', 'room-setup.html');

function playerUrl(c) { return `${c.server.replace(/\/$/, '')}/player/${encodeURIComponent(c.roomId)}?pk=${encodeURIComponent(c.playerKey)}`; }

function createWindow() {
  const c = readCfg();
  const displays = screen.getAllDisplays();
  const d = displays.find((x) => x.id === c.displayId) || screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    fullscreen: true, backgroundColor: '#000000', autoHideMenuBar: true, title: 'Karaoke-PC-F Room',
    webPreferences: { preload: path.join(__dirname, 'room-preload.js'), backgroundThrottling: false },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (input.key === 'F5') win.webContents.reload();
    else if (input.control && input.shift && k === 's') { e.preventDefault(); openSetup(); }
    else if (input.control && input.shift && k === 'q') { e.preventDefault(); app.quit(); }
  });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || mode !== 'player' || code === -3) return;
    goOffline();
  });
  // jika halaman player memberi 403 (kunci player diganti di Desk) → kembali ke setup
  win.webContents.on('did-navigate', (_e, url, httpCode) => { if (mode === 'player' && httpCode >= 500) goOffline(); });
  win.on('closed', () => { win = null; app.quit(); });
}

function openSetup(reason) {
  mode = 'setup'; clearTimeout(retryTimer);
  win.loadFile(SETUP, { query: reason ? { reason } : {} });
}
function openPlayer() {
  const c = readCfg();
  if (!c.server || !c.roomId || !c.playerKey) return openSetup();
  mode = 'player'; failCount = 0; clearTimeout(retryTimer);
  win.loadURL(playerUrl(c));
}
function goOffline() {
  mode = 'offline';
  const c = readCfg();
  win.loadFile(SETUP, { query: { offline: '1', venue: c.venue || '', room: c.roomName || '' } });
  scheduleRetry();
}
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    if (mode !== 'offline') return;
    const c = readCfg();
    if (await hello(c.server, 2000)) return openPlayer();
    failCount++;
    // setelah beberapa kali gagal, cari kasir lagi (IP kasir mungkin berubah)
    if (failCount % 3 === 0) {
      const list = await discover({ deep: failCount % 9 === 0 });
      const same = list.find((d) => d.venue === c.venue) || (list.length === 1 ? list[0] : null);
      if (same && same.url !== c.server) {
        try {
          const ok = await keyStillValid(same.url, c);
          if (ok) { writeCfg({ ...c, server: same.url }); return openPlayer(); }
        } catch {}
      }
    }
    if (win && !win.isDestroyed()) win.webContents.send('offline-tick', failCount);
    scheduleRetry();
  }, 5000);
}
function keyStillValid(base, c) {
  return new Promise((resolve) => {
    http.get(`${base}/api/player/${encodeURIComponent(c.roomId)}?pk=${encodeURIComponent(c.playerKey)}`, { timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode === 200); })
      .on('error', () => resolve(false)).on('timeout', function () { this.destroy(); });
  });
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch {} res.statusCode === 200 ? resolve(j) : reject(new Error(j.error || 'Gagal (' + res.statusCode + ')')); });
    });
    req.on('timeout', () => req.destroy(new Error('Kasir tidak menjawab')));
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Kasir tidak bisa dihubungi' : e.message)));
    req.end(data);
  });
}

// ---------- IPC untuk halaman setup ----------
ipcMain.handle('room:discover', async (_e, deep) => discover({ deep: !!deep }));
ipcMain.handle('room:check', async (_e, base) => {
  let url = String(base || '').trim();
  if (!/^https?:\/\//.test(url)) url = 'http://' + url;
  if (!/:\d+$/.test(url.replace(/\/$/, ''))) url = url.replace(/\/$/, '') + ':8168';
  const j = await hello(url, 2500);
  return j ? { url, venue: j.venue } : null;
});
ipcMain.handle('room:pair', async (_e, base, pin) => postJSON(base.replace(/\/$/, '') + '/api/pair', { pin }));
ipcMain.handle('room:save', async (_e, c) => {
  const old = readCfg();
  writeCfg({ ...old, ...c });
  const d = screen.getAllDisplays().find((x) => x.id === c.displayId);
  if (d && win) { win.setFullScreen(false); win.setBounds(d.bounds); win.setFullScreen(true); }
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: c.autoStart !== false });
  openPlayer();
  return true;
});
ipcMain.handle('room:config', () => ({ ...readCfg(), version: app.getVersion(), displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: `Layar ${i + 1} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' – utama' : ''}` })) }));
ipcMain.handle('room:setup', (_e, reason) => openSetup(reason));
ipcMain.handle('room:retry', () => { const c = readCfg(); if (c.server) openPlayer(); else openSetup(); });
ipcMain.handle('room:quit', () => app.quit());

// ---------- update otomatis (kanal "room") ----------
function setupUpdates() {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  if (!app.isPackaged) return;
  autoUpdater.channel = 'room';
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // terpasang saat PC/aplikasi room dimatikan, tidak mengganggu tamu
  autoUpdater.on('error', () => {});
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 15000);
  setInterval(check, 6 * 3600 * 1000);
  // room tutup (tidak ada sesi) di jam sepi → pasang update yang sudah siap
  autoUpdater.on('update-downloaded', () => {
    const tryInstall = async () => {
      const c = readCfg();
      const h = new Date().getHours();
      if (h < 4 || h > 10) return setTimeout(tryInstall, 30 * 60000);
      const busy = await new Promise((resolve) => {
        http.get(`${c.server}/api/player/${encodeURIComponent(c.roomId)}?pk=${encodeURIComponent(c.playerKey)}`, { timeout: 3000 }, (res) => {
          let b = ''; res.on('data', (x) => { b += x; }); res.on('end', () => { try { resolve(!!JSON.parse(b).room.active); } catch { resolve(true); } });
        }).on('error', () => resolve(false));
      });
      if (busy) return setTimeout(tryInstall, 30 * 60000);
      autoUpdater.quitAndInstall(true, true);
    };
    tryInstall();
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  const c = readCfg();
  if (c.server && c.roomId && c.playerKey) openPlayer(); else openSetup();
  setupUpdates();
});
app.on('window-all-closed', () => app.quit());
