// Fungsi bersama untuk Desk, Player, dan halaman tamu.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const THEMES = [
  { id: 'galaxy', name: 'Galaxy Ungu', c: ['#0b0618', '#ff3d8b', '#ff8a3d', '#38d6f5'] },
  { id: 'api', name: 'Merah Api & Hitam', c: ['#070505', '#ff3b2f', '#ffa62b', '#ffb547'] },
  { id: 'gold', name: 'Emas Mewah', c: ['#0a0806', '#e6b450', '#f7dc8f', '#9c7a3c'] },
  { id: 'neon', name: 'Neon Biru', c: ['#030914', '#00d2ff', '#3a7bff', '#00ffd5'] },
];
function applyTheme(t) {
  if (!THEMES.some((x) => x.id === t)) t = 'galaxy';
  document.documentElement.dataset.theme = t;
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--bg1').trim();
  try { localStorage.setItem('theme', JSON.stringify(t)); } catch {}
}
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const pin = store.get('adminPin', '');
  if (pin) opt.headers['x-admin-pin'] = pin;
  const r = await fetch(path, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Gagal (' + r.status + ')'); e.status = r.status; throw e; }
  return j;
}

try { applyTheme(JSON.parse(localStorage.getItem('theme')) || 'galaxy'); } catch { applyTheme('galaxy'); }

function toast(msg, ms = 3500) {
  let w = $('.toast-wrap');
  if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; w.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function rupiah(n, cur = 'Rp') { return cur + ' ' + Math.round(n || 0).toLocaleString('id-ID'); }
function hhmm(t) { const d = new Date(t); return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':'); }
function dur(ms) {
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (neg ? '-' : '') + h + ':' + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
}

const GRADS = [
  ['#ff3d8b', '#9b3dff'], ['#38d6f5', '#5b5cff'], ['#ff8a3d', '#e83d6b'], ['#27c28a', '#1f7fae'],
  ['#b061ff', '#ff5bb0'], ['#f5b83d', '#ff6a3d'], ['#5b8cff', '#38d6c0'], ['#e33d9b', '#ff9a5b'],
];
function initials(s) {
  const w = String(s || '?').replace(/\(.*?\)|\[.*?\]/g, '').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || '?')[0] + (w[1] ? w[1][0] : (w[0] || '')[1] || '')).toUpperCase();
}
function coverHTML(song, size = 52) {
  const t = song.title || '?';
  let h = 0; for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [a, b] = GRADS[h % GRADS.length];
  return `<div class="cover" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .38)}px;background:linear-gradient(135deg,${a},${b})">${esc(initials(t))}</div>`;
}
function songLine(s) { return esc(s.title) + (s.artist ? ` <span class="muted">· ${esc(s.artist)}</span>` : ''); }

function listen(onMsg) {
  let es, retry;
  const open = () => {
    es = new EventSource('/events');
    es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
    es.onerror = () => { es.close(); clearTimeout(retry); retry = setTimeout(open, 2000); };
  };
  open();
}

function parseLRC(txt) {
  const out = [];
  for (const line of String(txt || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const t of tags) out.push({ t: Number(t[1]) * 60 + Number(t[2].replace(':', '.')), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function ytCardHTML(x) {
  const d = x.duration ? Math.floor(x.duration / 60) + ':' + String(x.duration % 60).padStart(2, '0') : '';
  const btn = x.localId ? `<button class="btn sm pri" data-add="${x.localId}">+ Tambah</button>`
    : x.pending ? `<button class="btn sm" disabled>⏳ Sedang didownload</button>`
    : `<button class="btn sm pri" data-ytd="${esc(x.url)}" data-title="${esc(x.title)}">⬇ Download<span class="hide-sm"> &amp; Antrikan</span></button>`;
  return `<div class="yt-card"><div class="yt-th" style="background-image:url('${esc(x.thumb)}')">${d ? `<span>${d}</span>` : ''}</div><div class="grow" style="min-width:0"><div class="t yt-t">${esc(x.title)}</div><div class="a ell">${esc(x.channel)}${x.localId ? ' · <span class="tag">tersimpan</span>' : ''}</div></div>${btn}</div>`;
}
function jobsHTML(jobs) {
  return jobs.filter((j) => ['antri', 'download', 'proses', 'gagal'].includes(j.status)).slice(0, 5).map((j) => `<div class="job"><div class="row"><div class="grow ell">⬇ ${esc(j.title)}</div><span class="tag">${j.status === 'download' ? Math.round(j.progress) + '%' : esc(j.status)}</span></div>${j.status === 'download' ? `<div class="prog"><i style="width:${j.progress}%"></i></div>` : ''}${j.error ? `<div class="muted" style="font-size:11px">${esc(j.error)}</div>` : ''}</div>`).join('');
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

const STATUS = {
  free: { label: 'Kosong', color: '#3a2d66' }, inuse: { label: 'Dipakai', color: '#1f9d6e' },
  ending: { label: 'Hampir habis', color: '#d9862a' }, overtime: { label: 'Lewat waktu', color: '#d0453c' },
  timeup: { label: 'Waktu habis', color: '#d0453c' }, calling: { label: 'Memanggil', color: '#e0335e' },
  cleaning: { label: 'Dibersihkan', color: '#8a6d2a' }, maintenance: { label: 'Maintenance', color: '#4b4b5c' },
};
