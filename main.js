// Karaoke-PC-F — aplikasi desktop (Electron).
// Aplikasi KASIR (Desk + server lagu). Layar TV room memakai aplikasi terpisah: Karaoke-PC-F Room (room-main.js).
'use strict';
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 1));

let server = null, port = 0, mainWin = null, appMode = '', updating = false, manualCheck = false, readyVersion = '';
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { autoUpdater = null; }

// ---------- update otomatis dari GitHub Releases ----------
function setupUpdates() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // mode room: terpasang saat aplikasi/PC ditutup
  autoUpdater.on('update-available', (info) => { if (manualCheck) dialog.showMessageBox({ type: 'info', message: `Versi ${info.version} tersedia`, detail: 'Sedang didownload di belakang layar. Anda akan diberi tahu saat siap dipasang.' }); manualCheck = false; });
  autoUpdater.on('update-not-available', () => { if (manualCheck) dialog.showMessageBox({ type: 'info', message: 'Aplikasi sudah versi terbaru', detail: 'Versi ' + app.getVersion() }); manualCheck = false; });
  autoUpdater.on('error', (e) => { if (manualCheck) dialog.showMessageBox({ type: 'warning', message: 'Gagal cek update', detail: 'Periksa koneksi internet.\n\n' + (e && e.message ? e.message.split('\n')[0] : '') }); manualCheck = false; });
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version;
    if (appMode !== 'desk' || !mainWin) return; // layar room: jangan ganggu tamu, pasang saat ditutup
    mainWin.webContents.send('update-ready', info.version);
    promptInstall();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 3600 * 1000);
}
async function promptInstall() {
  if (!readyVersion) return;
  const r = await dialog.showMessageBox(mainWin, {
    type: 'info', buttons: ['Pasang sekarang', 'Nanti'], defaultId: 0, cancelId: 1, title: 'Update tersedia',
    message: `Karaoke-PC-F versi ${readyVersion} siap dipasang`,
    detail: `Versi sekarang ${app.getVersion()}. Aplikasi akan tertutup ± 1 menit lalu terbuka lagi otomatis. Layar room tersambung kembali sendiri.\n\nPilih "Nanti" bila room sedang ramai — update akan terpasang saat aplikasi ditutup.`,
  });
  if (r.response === 0) installNow();
}
function installNow() {
  updating = true;
  try { server && server.flush(); } catch {}
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}
function manualUpdateCheck() {
  if (!autoUpdater || !app.isPackaged) { dialog.showMessageBox({ type: 'info', message: 'Cek update hanya tersedia di aplikasi yang sudah diinstall.' }); return; }
  if (readyVersion) return promptInstall();
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}
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
    if (updating) return;
    const r = dialog.showMessageBoxSync(mainWin, { type: 'question', buttons: ['Tutup aplikasi', 'Batal'], defaultId: 1, title: 'Tutup', message: 'Menutup Desk akan menghentikan server lagu untuk semua room. Lanjut?' });
    if (r !== 0) e.preventDefault();
  });
  mainWin.on('closed', () => { playerWins.forEach((w) => w.destroy()); app.quit(); });
}

function runRoom(url) { const w = openPlayer(url, 'Room', { secondScreen: false }); w.on('closed', () => { if (!playerWins.size && !mainWin) app.quit(); }); }


function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Aplikasi', submenu: [
      { label: 'Cek update…', click: () => manualUpdateCheck() },
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
ipcMain.handle('get-config', () => readCfg());
ipcMain.handle('app-info', () => ({ version: app.getVersion(), readyVersion }));
ipcMain.handle('check-update', () => { manualUpdateCheck(); return true; });

app.on('second-instance', () => { const w = mainWin || [...playerWins][0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(async () => {
  buildMenu();
  const c = readCfg();
  if (c.mode === 'room' && c.roomUrl) { appMode = 'room'; runRoom(c.roomUrl); } // pemasangan lama (v1.0/1.1) yang dipakai sebagai layar room
  else { appMode = 'desk'; await runDesk(); }
  setupUpdates();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server && server.flush(); } catch {} });
