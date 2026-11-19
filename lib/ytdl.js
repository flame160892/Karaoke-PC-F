// Download lagu dari YouTube memakai yt-dlp (diunduh otomatis ke folder data/bin).
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
const BIN_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BIN_NAME}`;

function createYtdl({ dataDir, getOutDir, onChange, onDone }) {
  const binDir = path.join(dataDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const localBin = path.join(binDir, BIN_NAME);
  const jobs = [];
  let installing = false, installMsg = '';

  const which = (cmd) => {
    try {
      const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true });
      return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
    } catch { return null; }
  };
  const ytBin = () => (fs.existsSync(localBin) ? localBin : which('yt-dlp'));
  const ffmpegBin = () => {
    const local = path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    return fs.existsSync(local) ? local : which('ffmpeg');
  };

  function status() {
    return {
      ytdlp: !!ytBin(), ffmpeg: !!ffmpegBin(), installing, installMsg, outDir: getOutDir(), binDir,
      jobs: jobs.slice(-30).reverse().map(({ proc, ...j }) => j),
    };
  }

  function fetchFollow(url, dest, depth = 0) {
    return new Promise((resolve, reject) => {
      if (depth > 6) return reject(new Error('Terlalu banyak redirect'));
      https.get(url, { headers: { 'User-Agent': 'karaoke-pc-f' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return resolve(fetchFollow(res.headers.location, dest, depth + 1)); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        const total = Number(res.headers['content-length']) || 0;
        let got = 0;
        const tmp = dest + '.part';
        const f = fs.createWriteStream(tmp);
        res.on('data', (c) => { got += c.length; if (total) { installMsg = `Mengunduh yt-dlp ${Math.round((got / total) * 100)}%`; } });
        res.pipe(f);
        f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(); }));
        f.on('error', reject);
      }).on('error', reject);
    });
  }

  async function install() {
    if (installing) return;
    installing = true; installMsg = 'Mengunduh yt-dlp…'; onChange();
    const tick = setInterval(onChange, 1000);
    try {
      await fetchFollow(BIN_URL, localBin);
      if (process.platform !== 'win32') fs.chmodSync(localBin, 0o755);
      installMsg = 'yt-dlp siap dipakai';
    } catch (e) { installMsg = 'Gagal mengunduh yt-dlp: ' + e.message + '. Periksa koneksi internet.'; }
    clearInterval(tick); installing = false; onChange();
  }

  function search(q, limit = 12) {
    return new Promise((resolve, reject) => {
      const bin = ytBin();
      if (!bin) return reject(new Error('yt-dlp belum terpasang. Klik "Pasang yt-dlp" dulu.'));
      const p = spawn(bin, [`ytsearch${limit}:${q}`, '--flat-playlist', '-J', '--no-warnings'], { windowsHide: true });
      let out = '', er = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { er += c; });
      p.on('error', reject);
      p.on('close', (code) => {
        if (code !== 0) return reject(new Error(er.split('\n').filter(Boolean).pop() || 'Pencarian gagal'));
        try {
          const j = JSON.parse(out);
          resolve((j.entries || []).map((e) => ({
            id: e.id, title: e.title, channel: e.channel || e.uploader || '', duration: e.duration || 0,
            url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
            thumb: (e.thumbnails && e.thumbnails.length ? e.thumbnails[e.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`),
          })));
        } catch (e) { reject(new Error('Hasil pencarian tidak terbaca')); }
      });
    });
  }

  function add({ url, title, roomId, by }) {
    if (!/^https?:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(String(url))) throw new Error('Link YouTube tidak valid');
    const vid = (String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/) || [])[1];
    const dup = vid && jobs.find((j) => ['antri', 'download', 'proses'].includes(j.status) && j.url.includes(vid));
    if (dup) return dup;
    const job = { id: crypto.randomBytes(4).toString('hex'), url, title: title || url, status: 'antri', progress: 0, speed: '', eta: '', roomId: roomId || '', by: by || '', file: '', error: '', at: Date.now() };
    jobs.push(job);
    pump(); onChange();
    return job;
  }

  let running = false;
  function pump() {
    if (running) return;
    const job = jobs.find((j) => j.status === 'antri');
    if (!job) return;
    const bin = ytBin();
    if (!bin) { job.status = 'gagal'; job.error = 'yt-dlp belum terpasang'; onChange(); return pump(); }
    const outDir = getOutDir();
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) { job.status = 'gagal'; job.error = 'Folder tujuan tidak bisa dibuat: ' + outDir; onChange(); return pump(); }
    running = true; job.status = 'download'; onChange();
    const ff = ffmpegBin();
    // Dengan ffmpeg: video 720p + audio terbaik digabung jadi mp4. Tanpa ffmpeg: file mp4 tunggal terbaik.
    const fmt = ff ? 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b' : 'b[ext=mp4]/b';
    const args = [job.url, '--no-playlist', '--newline', '--no-part', '--windows-filenames', '--no-mtime',
      '-f', fmt, '-P', outDir, '-o', '%(title).150B [%(id)s].%(ext)s', '--print', 'after_move:filepath'];
    if (ff) args.push('--ffmpeg-location', ff, '--merge-output-format', 'mp4');
    const p = spawn(bin, args, { windowsHide: true });
    job.proc = p;
    let last = 0, er = '';
    const onLine = (line) => {
      const m = line.match(/\[download\]\s+([\d.]+)%(?:.*?at\s+(\S+))?(?:.*?ETA\s+(\S+))?/);
      if (m) {
        job.progress = Number(m[1]); job.speed = m[2] || ''; job.eta = m[3] || '';
        if (Date.now() - last > 700) { last = Date.now(); onChange(); }
      } else if (/^[A-Za-z]:\\|^\//.test(line.trim()) && fs.existsSync(line.trim())) job.file = line.trim();
      else if (/^\[(Merger|ExtractAudio|VideoConvertor)\]/.test(line)) { job.status = 'proses'; onChange(); }
    };
    let buf = '';
    p.stdout.on('data', (c) => { buf += c; const lines = buf.split(/\r?\n/); buf = lines.pop(); lines.forEach(onLine); });
    p.stderr.on('data', (c) => { er += c; });
    p.on('error', (e) => { er += e.message; });
    p.on('close', (code) => {
      if (buf) onLine(buf);
      delete job.proc;
      running = false;
      if (code === 0) { job.status = 'selesai'; job.progress = 100; job.title = job.file ? path.basename(job.file).replace(/\s*\[[\w-]{11}\]\.\w+$/, '') : job.title; onDone(job); }
      else if (job.status !== 'batal') { job.status = 'gagal'; job.error = (er.split('\n').filter((l) => /ERROR/.test(l)).pop() || er.trim().split('\n').pop() || 'Gagal').slice(0, 200); }
      onChange(); pump();
    });
  }

  function cancel(id) {
    const j = jobs.find((x) => x.id === id);
    if (!j) return;
    if (j.proc) { j.status = 'batal'; j.proc.kill(); } else if (j.status === 'antri') j.status = 'batal';
    onChange();
  }
  function clearDone() { for (let i = jobs.length - 1; i >= 0; i--) if (['selesai', 'gagal', 'batal'].includes(jobs[i].status)) jobs.splice(i, 1); onChange(); }
  function update() {
    return new Promise((resolve) => {
      const bin = ytBin(); if (!bin) return resolve('yt-dlp belum terpasang');
      const p = spawn(bin, ['-U'], { windowsHide: true }); let o = '';
      p.stdout.on('data', (c) => { o += c; }); p.stderr.on('data', (c) => { o += c; });
      p.on('close', () => resolve(o.trim().split('\n').pop() || 'Selesai')); p.on('error', (e) => resolve(e.message));
    });
  }

  return { status, install, search, add, cancel, clearDone, update };
}

module.exports = { createYtdl };
