// Mencari komputer kasir Karaoke-PC-F di jaringan lokal.
// 1) UDP broadcast ke port 8169   2) cadangan: cek /api/hello ke semua IP di subnet /24.
'use strict';
const dgram = require('dgram');
const http = require('http');
const os = require('os');

const DISCOVERY_PORT = 8169;
const DEFAULT_PORT = 8168;

function localNets() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number), mask = (a.netmask || '255.255.255.0').split('.').map(Number);
      out.push({ address: a.address, broadcast: ip.map((o, i) => (o & mask[i]) | (~mask[i] & 255)).join('.'), prefix: ip.slice(0, 3).join('.') });
    }
  }
  return out;
}

function hello(base, timeout = 1500) {
  return new Promise((resolve) => {
    const req = http.get(base.replace(/\/$/, '') + '/api/hello', { timeout }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(b); resolve(j.app === 'karaoke-pc-f' ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

function udpScan(ms = 1500, extraTargets = []) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return resolve([]); }
    const done = () => { try { sock.close(); } catch {} resolve([...found.values()]); };
    sock.on('error', done);
    sock.on('message', (msg, rinfo) => {
      try {
        const j = JSON.parse(String(msg));
        if (j.app === 'karaoke-pc-f') found.set(rinfo.address + ':' + j.port, { host: rinfo.address, port: j.port, venue: j.venue, url: `http://${rinfo.address}:${j.port}` });
      } catch {}
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch {}
      const msg = Buffer.from('KARAOKE-PC-F?');
      const targets = new Set(['255.255.255.255', ...localNets().map((n) => n.broadcast), ...extraTargets]);
      const blast = () => targets.forEach((t) => sock.send(msg, DISCOVERY_PORT, t, () => {}));
      blast(); setTimeout(blast, 400);
      setTimeout(done, ms);
    });
  });
}

async function httpScan(port = DEFAULT_PORT, concurrency = 48) {
  const hosts = [];
  for (const n of localNets()) for (let i = 1; i < 255; i++) hosts.push(`${n.prefix}.${i}`);
  const found = [];
  let idx = 0;
  const worker = async () => {
    while (idx < hosts.length) {
      const h = hosts[idx++];
      const j = await hello(`http://${h}:${port}`, 700);
      if (j) found.push({ host: h, port: j.port || port, venue: j.venue, url: `http://${h}:${j.port || port}` });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return found;
}

// Cari kasir: UDP dulu (cepat), kalau kosong lanjut scan HTTP.
async function discover({ deep = true, extraTargets = [] } = {}) {
  let list = await udpScan(1500, extraTargets);
  if (!list.length && deep) list = await httpScan();
  const uniq = new Map(list.map((d) => [d.url, d]));
  return [...uniq.values()];
}

module.exports = { discover, udpScan, httpScan, hello, localNets, DEFAULT_PORT };
