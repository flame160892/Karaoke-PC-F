// Dijalankan di runner Windows GitHub Actions: menguji tombol "Izinkan di Firewall" sungguhan.
const fw = require('../lib/firewall');
(async () => {
  const exe = process.execPath; // node.exe sebagai pengganti Karaoke-PC-F.exe
  const before = await fw.status('KPCF-TES', 3);
  console.log('sebelum:', before);
  const r = await fw.fix({ prefix: 'KPCF-TES', exe, tcpPorts: [8168], udpPorts: [8169] });
  console.log('hasil fix:', r);
  if (!r.ok || r.rules < 3) { console.error('GAGAL: aturan firewall tidak terpasang'); process.exit(1); }
  const again = await fw.fix({ prefix: 'KPCF-TES', exe, tcpPorts: [8168], udpPorts: [8169] });
  console.log('klik kedua kali:', again);
  if (!again.ok || again.rules !== 3) { console.error('GAGAL: klik ulang membuat aturan ganda'); process.exit(1); }
  require('child_process').execSync(`powershell -NoProfile -Command "Get-NetFirewallRule -DisplayName 'KPCF-TES*' | Remove-NetFirewallRule"`);
  console.log('LULUS: tombol firewall bekerja di Windows');
})();
