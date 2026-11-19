// Karaoke-PC-F — server lokal (Node.js murni, tanpa dependensi).
// Bisa dijalankan sendiri: `node server.js`, atau dibungkus Electron (main.js).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const qr = require('./lib/qr');
const { createYtdl } = require('./lib/ytdl');

const VIDEO_EXT = ['.mp4', '.webm', '.mkv', '.m4v', '.mov', '.ogv'];
const AUDIO_EXT = ['.mp3', '.m4a', '.ogg', '.wav', '.aac', '.flac', '.opus'];
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};

const rid = (n = 8) => crypto.randomBytes(n).toString('hex').slice(0, n);
const code4 = () => String(crypto.randomInt(1000, 10000));

function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.KARAOKE_DATA || path.join(__dirname, 'data');
  const publicDir = path.join(__dirname, 'public');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'db.json');
  const songsFile = path.join(dataDir, 'songs.json');

  // ---------- data ----------
  const defaults = {
    settings: {
      venueName: 'Karaoke-PC-F', port: 8168, songDirs: [], adminPin: '1234', playerKey: rid(10),
      taxPct: 10, servicePct: 5, billBlockMin: 15, minMinutes: 60, currency: 'Rp', endingSoonMin: 10, downloadDir: '', roomYoutube: true,
      theme: 'galaxy', tickerOn: true, tickerSpeed: 60, tickerText: 'Selamat datang di Karaoke-PC-F • Scan QR di layar untuk request lagu dari HP • Pesan makanan & minuman langsung dari layar', logoVer: 0, logoPos: 'top-right',
    },
    rooms: [
      { id: 'r101', name: '101', type: 'Small', seats: 4, rate: 80000 },
      { id: 'r102', name: '102', type: 'Medium', seats: 6, rate: 120000 },
      { id: 'r103', name: '103', type: 'Medium', seats: 6, rate: 120000 },
      { id: 'r201', name: '201 VIP', type: 'VIP', seats: 12, rate: 250000 },
    ],
    menu: [
      { id: 'm1', name: 'Air Mineral', price: 10000, cat: 'Minuman' },
      { id: 'm2', name: 'Teh Botol', price: 12000, cat: 'Minuman' },
      { id: 'm3', name: 'Kopi Susu', price: 20000, cat: 'Minuman' },
      { id: 'm4', name: 'Kentang Goreng', price: 30000, cat: 'Makanan' },
      { id: 'm5', name: 'Nasi Goreng', price: 35000, cat: 'Makanan' },
    ],
    sessions: {},
    transactions: [],
  };
  let db;
  try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch { db = JSON.parse(JSON.stringify(defaults)); }
  db.settings = { ...defaults.settings, ...(db.settings || {}) };
  for (const k of ['rooms', 'menu', 'transactions']) if (!Array.isArray(db[k])) db[k] = defaults[k];
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
  if (opts.port) db.settings.port = opts.port;

  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const tmp = dbFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
      fs.renameSync(tmp, dbFile);
    }, 200);
  };
  save();

  // ---------- perpustakaan lagu ----------
  let songs = [];
  let byId = new Map();
  try { songs = JSON.parse(fs.readFileSync(songsFile, 'utf8')); } catch { songs = []; }
  const indexSongs = () => { byId = new Map(songs.map((s) => [s.id, s])); };
  indexSongs();
  let scanning = false;

  function parseName(file) {
    let base = path.basename(file, path.extname(file)).replace(/_/g, ' ').trim();
    let num = '', ytid = '';
    const y = base.match(/\s*\[([\w-]{11})\]$/);
    if (y) { ytid = y[1]; base = base.slice(0, y.index).trim(); }
    const m = base.match(/^(\d{2,7})[\s.\-]+(.*)$/);
    if (m) { num = m[1]; base = m[2]; }
    let artist = '', title = base;
    const parts = base.split(/\s+-\s+/);
    if (parts.length >= 2) { artist = parts[0].trim(); title = parts.slice(1).join(' - ').trim(); }
    // folder induk dipakai sebagai artis/kategori bila nama file tak memuat artis
    const folder = path.basename(path.dirname(file));
    return { num, artist, title, folder, ytid };
  }

  const downloadDir = () => db.settings.downloadDir || (db.settings.songDirs[0] ? path.join(db.settings.songDirs[0], 'YouTube') : path.join(dataDir, 'downloads'));
  const allDirs = () => {
    const list = [...db.settings.songDirs];
    const dl = downloadDir();
    if (!list.some((d) => path.resolve(dl).toLowerCase().startsWith(path.resolve(d).toLowerCase()))) list.push(dl);
    return list;
  };
  const dirStatus = () => allDirs().map((d) => {
    let ok = false; try { ok = fs.statSync(d).isDirectory(); } catch {}
    return { path: d, ok, count: songs.filter((s) => s.path.toLowerCase().startsWith(path.resolve(d).toLowerCase())).length };
  });

  async function scan() {
    if (scanning) return;
    scanning = true; broadcast();
    const found = [];
    const walk = async (dir, depth) => {
      if (depth > 8) return;
      let ents;
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
      const names = new Set(ents.map((e) => e.name.toLowerCase()));
      for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith('.')) await walk(full, depth + 1); continue; }
        const ext = path.extname(e.name).toLowerCase();
        const isV = VIDEO_EXT.includes(ext), isA = AUDIO_EXT.includes(ext);
        if (!isV && !isA) continue;
        const stem = e.name.slice(0, -ext.length);
        const lrcName = names.has((stem + '.lrc').toLowerCase())
          ? ents.find((x) => x.name.toLowerCase() === (stem + '.lrc').toLowerCase()).name : null;
        const p = parseName(full);
        found.push({
          id: crypto.createHash('sha1').update(full).digest('hex').slice(0, 12),
          path: full, type: isV ? 'video' : 'audio', ext, lrc: lrcName ? path.join(dir, lrcName) : null,
          ...p, plays: (byId.get(crypto.createHash('sha1').update(full).digest('hex').slice(0, 12)) || {}).plays || 0,
        });
      }
    };
    for (const d of allDirs()) await walk(d, 0);
    found.sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title, 'id'));
    songs = found; indexSongs();
    fs.writeFile(songsFile, JSON.stringify(songs), () => {});
    scanning = false; broadcast();
  }

  const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  function search(q, limit = 60, sort = '') {
    const terms = norm(q).split(' ').filter(Boolean);
    let res = songs;
    if (terms.length) {
      res = songs.filter((s) => {
        const hay = norm(`${s.num} ${s.artist} ${s.title} ${s.folder}`);
        return terms.every((t) => hay.includes(t));
      });
    }
    if (sort === 'popular') res = [...res].sort((a, b) => b.plays - a.plays);
    return { total: res.length, items: res.slice(0, limit).map(pubSong) };
  }
  const pubSong = (s) => s && ({ id: s.id, num: s.num, artist: s.artist, title: s.title, folder: s.folder, type: s.type, hasLyrics: !!s.lrc, plays: s.plays });

  // ---------- room & billing ----------
  const roomById = (id) => db.rooms.find((r) => r.id === id);
  const sess = (id) => db.sessions[id] || null;

  function calcBill(room, s, now = Date.now()) {
    const st = db.settings;
    const usedMin = Math.max(0, Math.ceil((now - s.start) / 60000));
    const block = Math.max(1, Number(st.billBlockMin) || 1);
    let billedMin;
    if (s.duration) {
      const over = Math.max(0, usedMin - s.duration);
      billedMin = s.duration + Math.ceil(over / block) * block;
    } else {
      billedMin = Math.max(Number(st.minMinutes) || 0, Math.ceil(usedMin / block) * block);
    }
    const roomCharge = Math.round((room.rate * billedMin) / 60);
    const items = s.orders.filter((o) => o.status !== 'batal');
    const fnb = items.reduce((t, o) => t + o.price * o.qty, 0);
    const sub = roomCharge + fnb;
    const service = Math.round((sub * (Number(st.servicePct) || 0)) / 100);
    const tax = Math.round(((sub + service) * (Number(st.taxPct) || 0)) / 100);
    return { usedMin, billedMin, rate: room.rate, roomCharge, fnb, items, service, tax, total: sub + service + tax };
  }

  function roomStatus(r, s) {
    if (!s) return r.status || 'free';
    if (s.call) return 'calling';
    if (s.timeup) return 'timeup';
    if (s.duration) {
      const left = s.start + s.duration * 60000 - Date.now();
      if (left <= 0) return 'overtime';
      if (left <= (Number(db.settings.endingSoonMin) || 10) * 60000) return 'ending';
    }
    return 'inuse';
  }
  function roomView(r, withSecret) {
    const s = sess(r.id);
    const v = { id: r.id, name: r.name, type: r.type, seats: r.seats || 0, rate: r.rate, active: !!s, status: roomStatus(r, s) };
    if (s) {
      v.session = {
        start: s.start, duration: s.duration || 0, guest: s.guest || '', call: s.call || 0, timeup: !!s.timeup,
        endsAt: s.duration ? s.start + s.duration * 60000 : null,
        queue: s.queue.map((q) => ({ ...pubSong(byId.get(q.songId)), qid: q.qid, by: q.by })).filter((x) => x.id),
        now: s.now ? { ...pubSong(byId.get(s.now.songId)), qid: s.now.qid, startedAt: s.now.startedAt, by: s.now.by } : null,
        played: s.played.slice(-50).reverse().map((q) => ({ ...pubSong(byId.get(q.songId)), by: q.by })).filter((x) => x.id),
        orders: s.orders,
      };
      if (withSecret) { v.session.code = s.code; v.bill = calcBill(r, s); }
    }
    return v;
  }

  // ---------- SSE ----------
  const clients = new Set();
  let version = 0;
  function broadcast(extra) {
    version++;
    const msg = `data: ${JSON.stringify({ v: version, scanning, ...(extra || {}) })}\n\n`;
    for (const c of clients) c.write(msg);
  }
  setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 20000);

  const yt = createYtdl({
    dataDir, getOutDir: downloadDir,
    onChange: () => broadcast({ yt: true }),
    onDone: async (job) => {
      await scan();
      if (job.roomId && job.file) {
        const song = songs.find((x) => x.path === job.file);
        const s = sess(job.roomId);
        if (song && s) { addToQueue(s, song.id, job.by || 'YouTube'); save(); broadcast({ alert: `Download selesai & masuk antrian: ${song.title}` }); }
      } else broadcast({ alert: `Download selesai: ${job.title}` });
    },
  });
  const ytCache = new Map();
  const ytIdOf = (url) => (String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1] || '';
  async function ytRoute(res, sub, body, roomId, role) {
    if (sub === 'status') {
      const st = yt.status();
      if (role === 'guest') return ok(res, { ytdlp: st.ytdlp, jobs: st.jobs.filter((j) => j.roomId === roomId).map(({ id, title, status, progress, error, by }) => ({ id, title, status, progress, error, by })) });
      return ok(res, st);
    }
    if (sub === 'search') {
      const q = String(body.q || '').trim();
      if (!q) return err(res, 400, 'Ketik judul lagu');
      const key = q.toLowerCase() + '|' + (body.karaoke !== false);
      let hit = ytCache.get(key);
      if (!hit || Date.now() - hit.at > 10 * 60000) {
        hit = { at: Date.now(), items: await yt.search(q + (body.karaoke === false ? '' : ' karaoke')) };
        ytCache.set(key, hit);
        if (ytCache.size > 300) ytCache.delete(ytCache.keys().next().value);
      }
      const pending = new Set(yt.status().jobs.filter((j) => ['antri', 'download', 'proses'].includes(j.status)).map((j) => ytIdOf(j.url)));
      return ok(res, { items: hit.items.map((it) => { const local = songs.find((s) => s.ytid && s.ytid === it.id); return { ...it, localId: local ? local.id : '', pending: pending.has(it.id) }; }) });
    }
    if (sub === 'add') {
      const target = roomId || body.roomId;
      const id = ytIdOf(body.url);
      const local = id && songs.find((s) => s.ytid === id);
      if (local) {
        const s = target && sess(target);
        if (s) { addToQueue(s, local.id, body.by); save(); broadcast(); }
        return ok(res, { queued: true, title: local.title });
      }
      if (role === 'guest') {
        const mine = yt.status().jobs.filter((j) => j.roomId === target && ['antri', 'download', 'proses'].includes(j.status));
        if (mine.length >= 3) return err(res, 429, 'Maksimal 3 download bersamaan per room. Tunggu yang sedang berjalan selesai.');
      }
      return ok(res, yt.add({ url: body.url, title: body.title, roomId: target, by: body.by }));
    }
    if (!roomId) {
      if (sub === 'install') { yt.install(); return ok(res); }
      if (sub === 'cancel') { yt.cancel(body.id); return ok(res); }
      if (sub === 'clear') { yt.clearDone(); return ok(res); }
      if (sub === 'update') return ok(res, { message: await yt.update() });
    }
    return err(res, 404, 'Aksi tidak dikenal');
  }

  // ---------- helpers HTTP ----------
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const ok = (res, body = { ok: true }) => send(res, 200, body);
  const err = (res, code, msg) => send(res, code, { error: msg });
  const readBody = (req) => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 12e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const isAdmin = (req, url) => isLocal(req) || (req.headers['x-admin-pin'] || url.searchParams.get('pin')) === String(db.settings.adminPin);
  const isPlayer = (req, url) => isAdmin(req, url) || url.searchParams.get('pk') === db.settings.playerKey || req.headers['x-player-key'] === db.settings.playerKey;
  const guestOk = (url, roomId) => { const s = sess(roomId); return s && url.searchParams.get('k') === s.code; };

  function lanIPs() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
    return out;
  }
  const baseUrl = (req) => {
    const ips = lanIPs();
    const host = (req.headers.host || '').split(':')[0];
    const ip = host && host !== 'localhost' && host !== '127.0.0.1' ? host : (ips[0] ? ips[0].address : 'localhost');
    return `http://${ip}:${db.settings.port}`;
  };

  function serveFile(req, res, file, type) {
    fs.stat(file, (e, st) => {
      if (e || !st.isFile()) return err(res, 404, 'File tidak ditemukan');
      const range = req.headers.range;
      const headers = { 'Content-Type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
      if (range) {
        const m = range.match(/bytes=(\d*)-(\d*)/);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (m && !m[1] && m[2]) { start = st.size - parseInt(m[2], 10); end = st.size - 1; }
        if (start >= st.size || end >= st.size || start > end) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end();
        }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { ...headers, 'Content-Length': st.size });
        fs.createReadStream(file).pipe(res);
      }
    });
  }

  function addToQueue(s, songId, by, top) {
    if (!byId.has(songId)) return false;
    const item = { qid: rid(6), songId, by: String(by || '').slice(0, 30), at: Date.now() };
    if (top) s.queue.unshift(item); else s.queue.push(item);
    if (!s.now) nextSong(s);
    return true;
  }
  function nextSong(s) {
    if (s.now) s.played.push(s.now);
    if (s.played.length > 500) s.played.splice(0, s.played.length - 500);
    const n = s.queue.shift();
    s.now = n ? { ...n, startedAt: Date.now() } : null;
    if (n) { const song = byId.get(n.songId); if (song) song.plays = (song.plays || 0) + 1; }
  }

  const CONTROL_OK = /^(pause|play|toggle|replay|vocal:(orig|inst|left|right|cycle)|lyrics:(on|off|toggle|earlier|later|reset)|tempo:(up|down|reset)|vol:(up|down)|score:toggle|cheer:\d|sound:(applause|cheer|horn|drum)|lights:(usual|birthday|romantic|party|chill)|fullscreen)$/;
  const GUEST_OPS = ['queue', 'queue-remove', 'queue-top', 'skip', 'control', 'message', 'order', 'call'];
  const PLAYER_OPS = [...GUEST_OPS, 'ended', 'queue-clear'];

  function roomOp(res, room, s, act, body, who) {
    const name = String(body.by || '').slice(0, 24);
    switch (act) {
      case 'queue':
        if (s.queue.length >= 150) return err(res, 429, 'Antrian penuh');
        if (who === 'guest' && s.queue.some((q) => q.songId === body.songId)) return err(res, 409, 'Lagu ini sudah ada di antrian');
        if (!addToQueue(s, body.songId, name || (who === 'admin' ? 'Operator' : ''), !!body.top)) return err(res, 404, 'Lagu tidak ada');
        break;
      case 'queue-remove': s.queue = s.queue.filter((q) => q.qid !== body.qid); break;
      case 'queue-top': { const i = s.queue.findIndex((q) => q.qid === body.qid); if (i > 0) s.queue.unshift(...s.queue.splice(i, 1)); break; }
      case 'queue-clear': s.queue = []; break;
      case 'skip': case 'next': s.timeup = false; nextSong(s); break;
      case 'ended':
        if (s.now && body.qid && s.now.qid !== body.qid) return ok(res);
        if (s.duration && Date.now() > s.start + s.duration * 60000) {
          if (s.now) s.played.push(s.now);
          s.now = null; s.timeup = true;
          broadcast({ alert: `${room.name}: waktu habis` });
        } else nextSong(s);
        break;
      case 'control':
        if (!CONTROL_OK.test(String(body.action))) return err(res, 400, 'Kontrol tidak dikenal');
        broadcast({ control: { room: room.id, action: String(body.action), by: name } });
        return ok(res);
      case 'message': {
        const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (text) broadcast({ control: { room: room.id, action: 'msg', text, by: name } });
        return ok(res);
      }
      case 'order': {
        const it = db.menu.find((m) => m.id === body.itemId);
        if (!it) return err(res, 404, 'Menu tidak ada');
        const qty = Math.max(1, Math.min(50, parseInt(body.qty, 10) || 1));
        s.orders.push({ id: rid(6), itemId: it.id, name: it.name, price: it.price, qty, note: String(body.note || '').slice(0, 80), status: who === 'admin' ? 'diantar' : 'baru', at: Date.now(), from: who });
        if (who !== 'admin') { save(); broadcast({ alert: `Pesanan baru ${room.name}: ${qty}x ${it.name}` }); return ok(res); }
        break;
      }
      case 'call': s.call = Date.now(); save(); broadcast({ alert: `${room.name} memanggil staf` }); return ok(res);
      // ---- khusus admin ----
      case 'ack-call': s.call = 0; break;
      case 'extend':
        s.duration = Math.max(0, (s.duration || 0) + (parseInt(body.minutes, 10) || 0));
        if (body.unlimited) s.duration = 0;
        s.timeup = false;
        if (!s.now && s.queue.length) nextSong(s);
        break;
      case 'order-status': {
        const o = s.orders.find((x) => x.id === body.id);
        if (!o) return err(res, 404, 'Pesanan tidak ada');
        if (['baru', 'diantar', 'batal'].includes(body.status)) o.status = body.status;
        break;
      }
      case 'new-code': s.code = code4(); break;
      case 'guest': s.guest = String(body.guest || '').slice(0, 40); break;
      case 'move': {
        const to = roomById(body.to);
        if (!to || sess(to.id) || to.status === 'maintenance') return err(res, 409, 'Room tujuan tidak tersedia');
        db.sessions[to.id] = s; delete db.sessions[room.id]; room.status = 'cleaning'; to.status = '';
        break;
      }
      case 'bill': return ok(res, { room: room.name, guest: s.guest, start: s.start, ...calcBill(room, s) });
      case 'checkout': {
        const now = Date.now();
        const b = calcBill(room, s, now);
        const t = {
          id: 'T' + new Date(now).toISOString().slice(2, 10).replace(/-/g, '') + '-' + rid(4).toUpperCase(),
          roomId: room.id, room: room.name, guest: s.guest, start: s.start, end: now,
          songs: s.played.length + (s.now ? 1 : 0), payment: String(body.payment || 'Tunai'), ...b,
        };
        db.transactions.push(t);
        delete db.sessions[room.id];
        room.status = 'cleaning';
        save(); broadcast(); return ok(res, t);
      }
      default: return err(res, 404, 'Aksi tidak dikenal');
    }
    save(); broadcast(); return ok(res);
  }

  // ---------- router ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
    const M = req.method;

    // halaman
    if (M === 'GET' && (p === '/' || p === '/admin')) return serveFile(req, res, path.join(publicDir, 'admin.html'));
    if (M === 'GET' && parts[0] === 'player') return serveFile(req, res, path.join(publicDir, 'player.html'));
    if (M === 'GET' && parts[0] === 'r') return serveFile(req, res, path.join(publicDir, 'guest.html'));
    if (M === 'GET' && parts[0] === 'static') {
      const f = path.normalize(path.join(publicDir, ...parts.slice(1)));
      if (!f.startsWith(publicDir)) return err(res, 403, 'forbidden');
      return serveFile(req, res, f);
    }

    if (M === 'GET' && p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ v: version, scanning })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // media (dibatasi untuk player/admin atau tamu dengan kode aktif tidak perlu)
    if (M === 'GET' && parts[0] === 'media' && parts[1]) {
      if (!isPlayer(req, url)) return err(res, 403, 'Tidak diizinkan');
      const s = byId.get(parts[1]);
      if (!s) return err(res, 404, 'Lagu tidak ada');
      return serveFile(req, res, s.path, MIME[s.ext]);
    }
    if (M === 'GET' && parts[0] === 'lyrics' && parts[1]) {
      const s = byId.get(parts[1]);
      if (!s || !s.lrc) return send(res, 200, '', 'text/plain; charset=utf-8');
      return serveFile(req, res, s.lrc, 'text/plain; charset=utf-8');
    }
    if (M === 'GET' && p === '/logo') {
      const f = ['png', 'jpg', 'webp', 'svg', 'gif'].map((e) => path.join(dataDir, 'logo.' + e)).find((x) => fs.existsSync(x));
      if (!f) return err(res, 404, 'Belum ada logo');
      return serveFile(req, res, f);
    }
    if (M === 'GET' && p === '/api/display') {
      const st = db.settings;
      return ok(res, { theme: st.theme, venue: st.venueName, tickerOn: st.tickerOn, tickerText: st.tickerText, tickerSpeed: st.tickerSpeed, logo: st.logoVer ? '/logo?v=' + st.logoVer : '', logoPos: st.logoPos });
    }
    if (M === 'GET' && p === '/api/qr') {
      try { return send(res, 200, qr.toSvg(url.searchParams.get('text') || ''), 'image/svg+xml'); } catch (e) { return err(res, 400, e.message); }
    }

    // ---- publik ----
    if (M === 'GET' && p === '/api/songs') {
      return ok(res, search(url.searchParams.get('q') || '', Math.min(300, Number(url.searchParams.get('limit')) || 60), url.searchParams.get('sort')));
    }
    if (M === 'GET' && p === '/api/artists') {
      const map = new Map();
      for (const s of songs) { const a = s.artist || s.folder || 'Lainnya'; map.set(a, (map.get(a) || 0) + 1); }
      return ok(res, { items: [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'id')).map(([name, count]) => ({ name, count })) });
    }

    // ---- tamu (HP) & player (TV room) ----
    const role = parts[0] === 'api' && (parts[1] === 'guest' || parts[1] === 'player') ? parts[1] : null;
    if (role && parts[2]) {
      const room = roomById(parts[2]);
      if (!room) return err(res, 404, 'Room tidak ditemukan');
      if (role === 'player' && !isPlayer(req, url)) return err(res, 403, 'Kunci player salah. Buka ulang link player dari Desk.');
      const active = role === 'player' ? !!sess(room.id) : guestOk(url, room.id);
      if (M === 'GET' && parts.length === 3) {
        const rv = roomView(room, role === 'player');
        delete rv.bill;
        const v = { venue: db.settings.venueName, currency: db.settings.currency, active, room: rv, youtube: !!db.settings.roomYoutube };
        if (role === 'guest' && !active) v.room = { id: room.id, name: room.name, active: false };
        if (active) v.menu = db.menu;
        if (role === 'player' && rv.session) v.guestUrl = `${baseUrl(req)}/r/${room.id}?k=${rv.session.code}`;
        return ok(res, v);
      }
      if (!active) return err(res, 403, role === 'guest' ? 'Sesi room belum dibuka atau QR sudah kedaluwarsa. Scan ulang QR di layar TV.' : 'Room sedang tutup');
      const body = await readBody(req);
      if (parts[3] === 'yt') {
        if (!db.settings.roomYoutube) return err(res, 403, 'Download YouTube dari room dimatikan oleh staf');
        if (role === 'guest' && !['search', 'add', 'status'].includes(parts[4])) return err(res, 404, 'Aksi tidak dikenal');
        try { return await ytRoute(res, parts[4], body, room.id, role); } catch (e) { return err(res, 400, e.message); }
      }
      const allowed = role === 'player' ? PLAYER_OPS : GUEST_OPS;
      if (M !== 'POST' || !allowed.includes(parts[3])) return err(res, 404, 'Aksi tidak dikenal');
      return roomOp(res, room, sess(room.id), parts[3], body, role);
    }

    // ---- admin (Desk) ----
    if (parts[0] === 'api') {
      if (!isAdmin(req, url)) return err(res, 401, 'PIN admin diperlukan');
      const body = M === 'GET' ? {} : await readBody(req);

      if (M === 'GET' && p === '/api/admin/state') {
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const today = db.transactions.filter((t) => t.end >= dayStart.getTime());
        return ok(res, {
          settings: db.settings, rooms: db.rooms.map((r) => roomView(r, true)), menu: db.menu,
          songCount: songs.length, scanning, ips: lanIPs(), baseUrl: baseUrl(req), dirs: dirStatus(), downloadDir: downloadDir(),
          today: { count: today.length, total: today.reduce((a, t) => a + t.total, 0) },
        });
      }
      if (M === 'POST' && p === '/api/settings') {
        const allowedKeys = ['venueName', 'songDirs', 'adminPin', 'taxPct', 'servicePct', 'billBlockMin', 'minMinutes', 'currency', 'port', 'endingSoonMin', 'downloadDir', 'roomYoutube', 'tickerOn', 'tickerSpeed', 'tickerText', 'logoPos', 'theme'];
        for (const k of allowedKeys) if (k in body) db.settings[k] = body[k];
        if (!Array.isArray(db.settings.songDirs)) db.settings.songDirs = [];
        db.settings.songDirs = db.settings.songDirs.map(String).map((s) => s.trim()).filter(Boolean);
        save(); broadcast({ display: true });
        if ('songDirs' in body || 'downloadDir' in body) scan();
        return ok(res);
      }
      if (M === 'POST' && p === '/api/logo') {
        const m = String(body.data || '').match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml|gif);base64,(.+)$/);
        for (const e of ['png', 'jpg', 'webp', 'svg', 'gif']) { try { fs.unlinkSync(path.join(dataDir, 'logo.' + e)); } catch {} }
        if (m) {
          const ext = { jpeg: 'jpg', 'svg+xml': 'svg' }[m[1]] || m[1];
          const buf = Buffer.from(m[2], 'base64');
          if (buf.length > 8e6) return err(res, 413, 'Logo terlalu besar (maks 8 MB)');
          fs.writeFileSync(path.join(dataDir, 'logo.' + ext), buf);
          db.settings.logoVer = Date.now();
        } else db.settings.logoVer = 0;
        save(); broadcast({ display: true }); return ok(res);
      }
      if (M === 'POST' && p === '/api/settings/reset-player-key') { db.settings.playerKey = rid(10); save(); broadcast(); return ok(res); }
      if (M === 'POST' && p === '/api/rescan') { scan(); return ok(res); }
      if (parts[1] === 'yt' && parts[2]) { try { return await ytRoute(res, parts[2], body); } catch (e) { return err(res, 400, e.message); } }
      if (M === 'POST' && p === '/api/broadcast') {
        const text = String(body.text || '').slice(0, 140);
        if (text) broadcast({ control: { room: '*', action: 'announce', text } });
        return ok(res);
      }

      if (M === 'POST' && p === '/api/rooms') {
        const name = String(body.name || '').trim();
        if (!name) return err(res, 400, 'Nama room wajib');
        let r = body.id && roomById(body.id);
        if (!r) { r = { id: 'r' + rid(5) }; db.rooms.push(r); }
        Object.assign(r, { name, type: String(body.type || ''), seats: Math.max(0, parseInt(body.seats, 10) || 0), rate: Math.max(0, Number(body.rate) || 0) });
        save(); broadcast(); return ok(res, r);
      }
      if (M === 'DELETE' && parts[1] === 'rooms' && parts[2]) {
        if (sess(parts[2])) return err(res, 409, 'Room masih aktif. Checkout dulu.');
        db.rooms = db.rooms.filter((r) => r.id !== parts[2]); save(); broadcast(); return ok(res);
      }
      if (M === 'POST' && p === '/api/menu') {
        const name = String(body.name || '').trim();
        if (!name) return err(res, 400, 'Nama menu wajib');
        let m = body.id && db.menu.find((x) => x.id === body.id);
        if (!m) { m = { id: 'm' + rid(5) }; db.menu.push(m); }
        Object.assign(m, { name, price: Math.max(0, Number(body.price) || 0), cat: String(body.cat || 'Lainnya') });
        save(); broadcast(); return ok(res, m);
      }
      if (M === 'DELETE' && parts[1] === 'menu' && parts[2]) { db.menu = db.menu.filter((m) => m.id !== parts[2]); save(); broadcast(); return ok(res); }

      if (parts[1] === 'rooms' && parts[2] && parts[3] && M === 'POST') {
        const room = roomById(parts[2]);
        if (!room) return err(res, 404, 'Room tidak ditemukan');
        const act = parts[3];
        if (act === 'start') {
          if (sess(room.id)) return err(res, 409, 'Room sudah aktif');
          if (room.status === 'maintenance') return err(res, 409, 'Room sedang maintenance');
          db.sessions[room.id] = { start: Date.now(), duration: Math.max(0, parseInt(body.duration, 10) || 0), guest: String(body.guest || '').slice(0, 40), code: code4(), queue: [], now: null, played: [], orders: [], call: 0, timeup: false };
          room.status = '';
          save(); broadcast(); return ok(res);
        }
        if (act === 'status') {
          if (sess(room.id)) return err(res, 409, 'Room masih dipakai');
          room.status = ['cleaning', 'maintenance'].includes(body.status) ? body.status : '';
          save(); broadcast(); return ok(res);
        }
        const s = sess(room.id);
        if (!s) return err(res, 409, 'Room belum aktif');
        return roomOp(res, room, s, act, body, 'admin');
      }

      if (M === 'GET' && p === '/api/transactions') {
        const from = Number(url.searchParams.get('from')) || 0;
        const to = Number(url.searchParams.get('to')) || Date.now() + 1;
        const list = db.transactions.filter((t) => t.end >= from && t.end < to).reverse();
        return ok(res, { items: list, total: list.reduce((a, t) => a + t.total, 0) });
      }
      if (M === 'GET' && p === '/api/top-songs') {
        return ok(res, { items: [...songs].filter((s) => s.plays).sort((a, b) => b.plays - a.plays).slice(0, 20).map(pubSong) });
      }
    }
    return err(res, 404, 'Tidak ditemukan');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); try { err(res, 500, 'Kesalahan server: ' + e.message); } catch {} });
  });

  return {
    server, db, scan,
    listen(port = db.settings.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
          db.settings.port = server.address().port;
          resolve(server.address().port);
        });
      });
    },
    setSongDirs(dirs) { db.settings.songDirs = dirs; save(); scan(); },
    get playerKey() { return db.settings.playerKey; },
    flush() { clearTimeout(saveTimer); fs.writeFileSync(dbFile, JSON.stringify(db, null, 1)); },
  };
}

module.exports = { createServer };

if (require.main === module) {
  const app = createServer({ port: Number(process.env.PORT) || undefined });
  app.listen().then((port) => {
    console.log(`Karaoke-PC-F jalan di http://localhost:${port}`);
    app.scan();
  });
}
