# Karaoke-PC-F

Sistem karaoke untuk Windows: **Desk kasir** (banyak room), **layar TV room**, dan **request lagu dari HP tamu** (scan QR).

## Fitur
- **Desk staf**: status room (kosong, dipakai, hampir habis, memanggil, dibersihkan, maintenance), buka room 1/2/3 jam atau tanpa batas, tambah waktu, pindah room, pesanan F&B, checkout + cetak struk, laporan shift, export CSV, broadcast pengumuman.
- **Layar room (TV)**: menu tile, cari lagu, lagu hits, artis, antrian, riwayat, party (pesan terbang, emoji, suara penonton, lampu), video layar penuh + QR request, lirik `.lrc`, Vocal Cut / Ch Kiri / Ch Kanan, tempo, volume.
- **Logo tempat usaha & running text** di layar room — ubah kapan saja dari Desk → *Logo & Running Text*, langsung tampil.
- **HP tamu**: cari & request lagu, lihat giliran, remote (pause/skip/vokal/lirik), cheer, kirim pesan ke layar, pesan makanan, panggil staf.
- **Lagu dari hardisk server**: internal atau **hardisk eksternal** (mis. `E:\KARAOKE`), bisa banyak folder. Room memutar lagu langsung dari hardisk server lewat jaringan.
- **Download YouTube** (yt-dlp): cari → download → tersimpan permanen di hardisk → otomatis masuk antrian room.

## Cara pakai
1. Install `Karaoke-PC-F-Setup.exe` di komputer kasir → pilih **Komputer Kasir / Server (Desk)**.
2. Desk → **Lagu & Hardisk** → tambahkan folder lagu (format MP4, MKV, WEBM, MP3, M4A; nama file `Artis - Judul.mp4`; lirik opsional `Artis - Judul.lrc`).
3. Desk → **YouTube** → klik **Pasang yt-dlp** (sekali saja). Untuk kualitas 720p, taruh `ffmpeg.exe` di folder `bin` yang ditunjukkan.
4. Klik room → **Buka Layar Room**:
   - komputer yang sama dengan monitor/TV kedua → *Buka di layar kedua*;
   - PC room lain → install aplikasi yang sama, pilih **Layar Room**, tempel link-nya.
5. Izinkan aplikasi di **Windows Firewall** (jaringan Private) saat pertama dijalankan, supaya PC room & HP tamu bisa terhubung (port default 8168).

Pintasan di layar room: Spasi = pause · N = skip · R = ulang · F = layar penuh · L = lirik · C = vocal cut · F11 = layar penuh jendela.

## Build installer (.exe)
Setiap push ke `main`, GitHub Actions membuat installer dan menerbitkannya di halaman **Releases** (naikkan `version` di package.json untuk rilis baru).
Atau di PC Windows: `npm install` lalu `npm run dist` (hasil di folder `dist`).

Jalankan tanpa Electron (tes): `node server.js` lalu buka `http://localhost:8168`.

> Catatan lisensi: untuk pemutaran komersial di tempat usaha, pastikan memiliki lisensi pengumuman musik (LMKN), dan hanya unduh video yang diizinkan pemiliknya.
