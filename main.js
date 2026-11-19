// Karaoke-PC-F — aplikasi desktop (Electron).
// Mode "Desk": komputer kasir sekaligus server lagu.  Mode "Layar Room": komputer di dalam room.
'use strict';
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1));

let server = null, port = 0, mainWin = null;
const playerWins = new Set();

async function startServer() {
  if (server) return port;
  const { createServer } = require('./server');
  server = createServer({ dataDir: path.join(app.getPath('userData'), 'data') });
  try { port = await server.listen(); }
  catch (e) {
    if (e.code === 'EADDRINUSE') {
      dialog.showErrorBox('Port dipakai', `Port ${server.db.settings.port} sudah dipakai program lain. Karaoke-PC-F akan memakai port acak.`);
      port = await server.listen(0);
    } else throw e;
  }
  server.scan();
  return port;
}

function pickDisplay(preferSecond) {
  const all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay();
  if (preferSecond) { const other = all.find((d) => d.id !== primary.id); if (other) return other; }
  return primary;
}

function openPlayer(url, title, opts = {}) {
  const d = pickDisplay(opts.secondScreen !== false);
  const w = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    fullscreen: true, backgroundColor: '#000000', autoHideMenuBar: true, title: 'Layar ' + (title || 'Room'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  w.setMenuBarVisibility(false);
  w.loadURL(url);
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') w.setFullScreen(!w.isFullScreen());
    if (input.key === 'F5') w.reload();
    if (input.control && input.shift && input.key.toLowerCase() === 'q') w.close();
  });
  // jika server belum siap / jaringan putus, coba lagi
  w.webContents.on('did-fail-load', () => setTimeout(() => !w.isDestroyed() && w.loadURL(url), 3000));
  playerWins.add(w); w.on('closed', () => playerWins.delete(w));
  return w;
}

async function runDesk() {
  await startServer();
  mainWin = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 680, backgroundColor: '#0b0618', title: 'Karaoke-PC-F — Desk',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWin.maximize();
  mainWin.loadURL(`http://127.0.0.1:${port}/`);
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('about:blank') || url === '') return { action: 'allow', overrideBrowserWindowOptions: { width: 380, height: 640, autoHideMenuBar: true } };
    if (/\/player\//.test(url)) { openPlayer(url, 'Room'); return { action: 'deny' }; }
    shell.openExternal(url); return { action: 'deny' };
  });
  mainWin.on('close', (e) => {
    const r = dialog.showMessageBoxSync(mainWin, { type: 'question', buttons: ['Tutup aplikasi', 'Batal'], defaultId: 1, title: 'Tutup', message: 'Menutup Desk akan menghentikan server lagu untuk semua room. Lanjut?' });
    if (r !== 0) e.preventDefault();
  });
  mainWin.on('closed', () => { playerWins.forEach((w) => w.destroy()); app.quit(); });
}

function runRoom(url) { const w = openPlayer(url, 'Room', { secondScreen: false }); w.on('closed', () => { if (!playerWins.size && !mainWin) app.quit(); }); }

function runLauncher() {
  const w = new BrowserWindow({ width: 760, height: 620, resizable: false, backgroundColor: '#0b0618', title: 'Karaoke-PC-F', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  w.loadFile(path.join(__dirname, 'public', 'launch.html'));
  return w;
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Aplikasi', submenu: [
      { label: 'Ganti mode (Desk / Layar Room)…', click: () => { const c = readCfg(); delete c.mode; writeCfg(c); app.relaunch(); app.exit(0); } },
      { label: 'Buka folder data', click: () => shell.openPath(path.join(app.getPath('userData'), 'data')) },
      { type: 'separator' }, { role: 'reload', label: 'Muat ulang' }, { role: 'toggleDevTools', label: 'Developer tools' },
      { type: 'separator' }, { role: 'quit', label: 'Keluar' },
    ] },
    { label: 'Tampilan', submenu: [{ role: 'zoomIn', label: 'Perbesar' }, { role: 'zoomOut', label: 'Perkecil' }, { role: 'resetZoom', label: 'Ukuran normal' }, { role: 'togglefullscreen', label: 'Layar penuh' }] },
  ]));
}

ipcMain.handle('pick-folder', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Pilih folder lagu (boleh di hardisk eksternal)', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open-player', (e, url, title) => { openPlayer(url, title); return true; });
ipcMain.handle('launch', async (e, mode, url, remember) => {
  const c = readCfg();
  if (remember) { c.mode = mode; if (url) c.roomUrl = url; } else { delete c.mode; if (url) c.roomUrl = url; }
  writeCfg(c);
  const launcher = BrowserWindow.fromWebContents(e.sender);
  if (mode === 'desk') await runDesk(); else runRoom(url);
  launcher.close();
  return true;
});
ipcMain.handle('get-config', () => readCfg());

app.on('second-instance', () => { const w = mainWin || [...playerWins][0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(async () => {
  buildMenu();
  const c = readCfg();
  if (c.mode === 'desk') await runDesk();
  else if (c.mode === 'room' && c.roomUrl) runRoom(c.roomUrl);
  else runLauncher();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server && server.flush(); } catch {} });
