// Windows Firewall: cek status & pasang aturan izin dengan 1 klik (minta izin admin lewat UAC).
'use strict';
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'"; // string PowerShell bertanda kutip tunggal

function ps(cmd, timeout = 20000) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout }, (e, out) => resolve(e ? null : String(out).trim()));
  });
}

// Isi skrip yang dijalankan sebagai admin.
function buildScript({ prefix, exe, tcpPorts = [], udpPorts = [], logFile }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    'try {',
    `  $exe = ${q(exe)}`,
    `  Get-NetFirewallRule -DisplayName ${q(prefix + '*')} -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue`,
    '  # aturan BLOKIR yang dibuat Windows bila dulu memilih "Cancel" pada pop-up firewall',
    "  Get-NetFirewallApplicationFilter -Program $exe -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Action -eq 'Block' } | Remove-NetFirewallRule -ErrorAction SilentlyContinue",
    `  New-NetFirewallRule -DisplayName ${q(prefix + ' (aplikasi)')} -Direction Inbound -Program $exe -Action Allow -Profile Any | Out-Null`,
  ];
  for (const p of tcpPorts) lines.push(`  New-NetFirewallRule -DisplayName ${q(`${prefix} (TCP ${p})`)} -Direction Inbound -Protocol TCP -LocalPort ${Number(p)} -Action Allow -Profile Any | Out-Null`);
  for (const p of udpPorts) lines.push(`  New-NetFirewallRule -DisplayName ${q(`${prefix} (UDP ${p})`)} -Direction Inbound -Protocol UDP -LocalPort ${Number(p)} -Action Allow -Profile Any | Out-Null`);
  lines.push('  exit 0', '} catch {', `  $_ | Out-File -FilePath ${q(logFile)} -Encoding utf8`, '  exit 1', '}');
  return lines.join('\r\n');
}

async function status(prefix, need = 1) {
  if (!isWin) return { supported: false, ok: true, rules: 0 };
  const out = await ps(`@(Get-NetFirewallRule -DisplayName ${q(prefix + '*')} -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' -and $_.Action -eq 'Allow' }).Count`);
  if (out === null) return { supported: true, ok: false, rules: 0, unknown: true };
  const rules = parseInt(out, 10) || 0;
  return { supported: true, ok: rules >= need, rules };
}

async function fix(opts) {
  const need = 1 + (opts.tcpPorts || []).length + (opts.udpPorts || []).length;
  if (!isWin) return { supported: false, ok: true, message: 'Bukan Windows — tidak perlu.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kpcf-fw-'));
  const file = path.join(dir, 'izinkan-firewall.ps1');
  const logFile = path.join(dir, 'error.txt');
  // BOM agar Windows PowerShell 5.1 membaca UTF-8 dengan benar
  fs.writeFileSync(file, '﻿' + buildScript({ ...opts, logFile }), 'utf8');
  const launcher = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + ${q(file)} + '"'); exit $p.ExitCode } catch { exit 1223 }`;
  const code = await new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', launcher], { windowsHide: true });
    p.on('close', (c) => resolve(c));
    p.on('error', () => resolve(-1));
  });
  let detail = '';
  try { detail = fs.readFileSync(logFile, 'utf8').trim().split(/\r?\n/)[0]; } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  const st = await status(opts.prefix, need);
  if (code === 1223) return { ...st, cancelled: true, message: 'Dibatalkan — klik "Yes" saat Windows meminta izin.' };
  if (code !== 0) return { ...st, message: 'Gagal mengubah firewall' + (detail ? ': ' + detail : '.') };
  return { ...st, message: st.ok ? 'Firewall sudah diizinkan ✔' : 'Aturan dipasang, tapi belum terbaca. Coba lagi.' };
}

module.exports = { status, fix, buildScript };
