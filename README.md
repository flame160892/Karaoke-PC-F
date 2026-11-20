# Karaoke-PC-F

Sistem karaoke untuk Windows: **Desk kasir** (banyak room), **layar TV room**, dan **request lagu dari HP tamu** (scan QR).

## Fitur
- **Desk staf**: status room (kosong, dipakai, hampir habis, memanggil, dibersihkan, maintenance), buka room 1/2/3 jam atau tanpa batas, tambah waktu, pindah room, pesanan F&B, checkout + cetak struk, laporan shift, export CSV, broadcast pengumuman.
- **Layar room (TV)**: menu tile, cari lagu, lagu hits, artis, antrian, riwayat, party (pesan terbang, emoji, suara penonton, lampu), video layar penuh + QR request, lirik `.lrc`, Vocal Cut / Ch Kiri / Ch Kanan, tempo, volume.
- **Logo tempat usaha & running text** di layar room — ubah kapan saja dari Desk → *Logo & Running Text*, langsung tampil.
- **HP tamu**: cari & request lagu, lihat giliran, remote (pause/skip/vokal/lirik), cheer, kirim pesan ke layar, pesan makanan, panggil staf.
- **Lagu dari hardisk server**: internal atau **hardisk eksternal** (mis. `E:\KARAOKE`), bisa banyak folder. Room memutar lagu langsung dari hardisk server lewat jaringan.
- **Download YouTube** (yt-dlp): cari → download → tersimpan permanen di hardisk → otomatis masuk antrian room.

## Dua aplikasi
| Install di | File | Fungsi |
|---|---|---|
| Komputer **kasir** | `Karaoke-PC-F-Setup-x.y.z.exe` | Desk, billing, penyimpanan lagu (hardisk internal/eksternal), download YouTube |
| PC/TV **setiap room** | `Karaoke-PC-F-Room-Setup-x.y.z.exe` | Layar karaoke room — otomatis menemukan kasir, masukkan PIN, pilih room |

Download keduanya di halaman **Releases**.

## Cara pakai
1. **Kasir**: install `Karaoke-PC-F-Setup`. Izinkan di **Windows Firewall** (jaringan Private) saat pertama dibuka.
2. Desk → **Lagu & Hardisk** → tambahkan folder lagu (MP4, MKV, WEBM, MP3, M4A; nama `Artis - Judul.mp4`; lirik opsional `.lrc`).
3. Desk → **YouTube** → **Pasang yt-dlp** (sekali). Untuk 720p taruh `ffmpeg.exe` di folder `bin` yang ditunjukkan.
4. **Room**: install `Karaoke-PC-F-Room-Setup` di PC room → aplikasi mencari kasir otomatis → masukkan **PIN admin** (bawaan 1234, ganti di Desk → Pengaturan) → pilih room → **Mulai**. PC room otomatis membuka layar room saat dinyalakan dan tersambung ulang sendiri bila kasir/jaringan sempat mati.
   Di layar room: **Ctrl+Shift+S** = pengaturan, **F11** = layar penuh, **Ctrl+Shift+Q** = keluar.
5. Tanpa PC room terpisah: Desk → room → **Buka Layar Room** → *Buka di layar kedua komputer ini*.

Pintasan di layar room: Spasi = pause · N = skip · R = ulang · F = layar penuh · L = lirik · C = vocal cut.

## Build installer (.exe)
Setiap push ke `main`, GitHub Actions membuat installer dan menerbitkannya di **Releases**. Aplikasi yang sudah terpasang mengecek Releases otomatis (saat dibuka & tiap 6 jam): di Desk muncul tawaran "Pasang sekarang"; di Layar Room update terpasang saat aplikasi/PC ditutup. Cek manual: menu Aplikasi → Cek update. Naikkan `version` di package.json untuk rilis baru.
Atau di PC Windows: `npm install` lalu `npm run dist` (hasil di folder `dist`).

Jalankan tanpa Electron (tes): `node server.js` lalu buka `http://localhost:8168`.

> Catatan lisensi: untuk pemutaran komersial di tempat usaha, pastikan memiliki lisensi pengumuman musik (LMKN), dan hanya unduh video yang diizinkan pemiliknya.
