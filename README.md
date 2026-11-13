# AkuntansiEkbis
Alat Pencatatan Keuangan Berbasis Appsript Google
# Panduan Visual Instalasi & Deployment Aplikasi Keuangan

**Versi Bahasa Indonesia — desktop/laptop — untuk pemula**

> **Tentang gambar:** Semua gambar bertanda **REKONSTRUKSI TAMPILAN DESKTOP · ILUSTRASI**. Gambar dibuat berdasarkan alur editor Google Sheets, Google Apps Script, dan tampilan aplikasi; bukan screenshot dari akun Google sungguhan. Bahasa, lokasi tombol, dan dialog bisa sedikit berbeda.

**Cakupan:** pemasangan mandiri di Google Sheet baru, menjalankan inisialisasi, membuat PIN Pemilik, menerbitkan web app, dan mencoba login. Bagian personalisasi bisnis dan penggunaan harian tidak dibahas.

## Yang harus disiapkan

- Akun Google yang akan menjadi **pemilik** spreadsheet dan deployment.
- Browser desktop/laptop, akses ke [Google Sheets](https://sheets.google.com).
- Enam berkas aplikasi: `Code.gs`, `API.gs`, `GameServer.gs`, `Index.html`, `Game.html`, `Panduan.html`.
- Koneksi internet stabil dan izin untuk menggunakan Google Apps Script.

---

## Langkah 01 — Ekstrak paket aplikasi

Buka file ZIP dan pastikan keenam berkas utama ada di komputer.

![Contoh folder hasil ekstrak paket.](gambar/01-ekstrak-file.png)

*Contoh folder hasil ekstrak paket.*

**Ikuti langkah berikut:**

1. Klik kanan file ZIP lalu pilih ekstrak/unzip.
2. Pastikan ada <b>Code.gs, API.gs, GameServer.gs, Index.html, Game.html, Panduan.html</b>.
3. Biarkan file panduan dan patch di folder; keduanya tidak perlu ditambahkan ke Apps Script.

> **Perhatian:** Gunakan berkas dari paket starter yang terpercaya. Jangan mempublikasikan PIN atau data usaha.

---

## Langkah 02 — Buat spreadsheet kosong

Spreadsheet ini akan menjadi database pribadi milik pemilik aplikasi.

![Halaman awal Google Sheets (ilustrasi pilihan Blank spreadsheet).](gambar/02-spreadsheet-baru.png)

*Halaman awal Google Sheets (ilustrasi pilihan Blank spreadsheet).*

**Ikuti langkah berikut:**

1. Login dengan akun Google yang akan menjadi pemilik aplikasi.
2. Buka <b>sheets.google.com</b>, pilih <b>Blank spreadsheet</b>.
3. Ganti judul file, misalnya <b>Keuangan - Toko Harapan</b>.

> **Perhatian:** Jangan memakai salinan spreadsheet orang lain yang sudah berisi pengguna dan transaksi.

---

## Langkah 03 — Buka editor Apps Script

Proyek yang dibuka dari spreadsheet akan terhubung langsung ke data tersebut.

![Jalur menu Extensions → Apps Script.](gambar/03-ekstensi-apps-script.png)

*Jalur menu Extensions → Apps Script.*

**Ikuti langkah berikut:**

1. Di spreadsheet baru klik <b>Extensions / Ekstensi</b>.
2. Pilih <b>Apps Script</b>.
3. Tab editor baru terbuka; ubah nama proyek menjadi <b>Aplikasi Keuangan</b>.

> **Perhatian:** Jangan membuat proyek standalone dari script.google.com untuk instalasi ini.

---

## Langkah 04 — Ganti isi Code.gs

File bawaan Code.gs perlu diganti dengan isi lengkap Code.gs dari paket.

![Editor Code.gs setelah isi aplikasi ditempel (dipersingkat untuk contoh).](gambar/04-isi-code.png)

*Editor Code.gs setelah isi aplikasi ditempel (dipersingkat untuk contoh).*

**Ikuti langkah berikut:**

1. Buka <b>Code.gs</b> di editor.
2. Hapus contoh <b>myFunction()</b>, lalu tempel seluruh isi <b>Code.gs</b> dari ZIP.
3. Gunakan editor teks untuk menyalin isi berkas, bukan menempel nama file atau tautannya.

> **Perhatian:** Jangan menghapus potongan kode di bagian akhir berkas. Paste seluruh isi file.

---

## Langkah 05 — Tambahkan dua berkas Script

API.gs dan GameServer.gs dibuat sebagai file Script, bukan HTML.

![Tombol tambah berkas dan opsi Script.](gambar/05-tambah-script.png)

*Tombol tambah berkas dan opsi Script.*

**Ikuti langkah berikut:**

1. Klik tanda <b>+</b> di bagian FILES, pilih <b>Script</b>.
2. Buat file dengan nama <b>API</b>, kemudian tempel isi API.gs.
3. Ulangi untuk <b>GameServer</b>, kemudian tempel isi GameServer.gs.

> **Perhatian:** Editor otomatis menambahkan ekstensi .gs; ketik API, bukan API.gs, jika kolom nama sudah mengelola ekstensi.

---

## Langkah 06 — Tambahkan tiga berkas HTML

Lengkapi tampilan utama, game, dan materi panduan.

![Enam berkas di daftar FILES dan opsi HTML.](gambar/06-tambah-html.png)

*Enam berkas di daftar FILES dan opsi HTML.*

**Ikuti langkah berikut:**

1. Klik <b>+</b>, pilih <b>HTML</b>.
2. Buat <b>Index</b>, <b>Game</b>, dan <b>Panduan</b>; tempel seluruh isi masing-masing berkas .html.
3. Pastikan keenam nama file muncul di panel FILES, lalu klik <b>Save / Simpan</b>.

> **Perhatian:** Kapitalisasi penting: include('Game') membutuhkan file Game.html, bukan game.html.

---

## Langkah 07 — Jalankan setupPertama()

Fungsi ini membuat sheet, daftar akun, laporan, dan data contoh.

![Pilih fungsi setupPertama dan tombol Run.](gambar/07-jalankan-setup.png)

*Pilih fungsi setupPertama dan tombol Run.*

**Ikuti langkah berikut:**

1. Simpan semua file dan pilih fungsi <b>setupPertama</b> pada dropdown di atas editor.
2. Klik <b>Run / Jalankan</b>.
3. Tunggu sampai eksekusi selesai; jika gagal buka <b>Executions / Eksekusi</b> untuk melihat error.

> **Perhatian:** <b>Hanya jalankan saat membuat spreadsheet baru.</b> Jangan menjalankan ulang setup untuk pembaruan kode.

---

## Langkah 08 — Tinjau izin Google

Google meminta persetujuan sebelum script dapat mengubah spreadsheet atau menggunakan layanan terkait.

![Dialog izin yang mungkin muncul saat Run pertama kali.](gambar/08-otorisasi.png)

*Dialog izin yang mungkin muncul saat Run pertama kali.*

**Ikuti langkah berikut:**

1. Klik <b>Review permissions / Tinjau izin</b> jika muncul.
2. Pilih akun pemilik, baca daftar izin, dan setujui hanya jika Anda memercayai kode aplikasi.
3. Kembali ke editor dan pastikan proses setup tidak menampilkan kesalahan.

> **Perhatian:** Jika muncul peringatan aplikasi belum diverifikasi, periksa asal kode dan izinnya. Jangan melewati peringatan tanpa yakin.

---

## Langkah 09 — Buka menu Keuangan

Setelah setup selesai, muat ulang spreadsheet untuk memunculkan menu tambahan.

![Menu khusus Keuangan setelah setup dan reload.](gambar/09-menu-keuangan.png)

*Menu khusus Keuangan setelah setup dan reload.*

**Ikuti langkah berikut:**

1. Kembali ke tab spreadsheet dan lakukan <b>Reload</b> browser.
2. Pada baris menu cari <b>💰 Keuangan</b>.
3. Pilih <b>👤 Atur PIN Pemilik</b>.

> **Perhatian:** Bila menu belum muncul, pastikan proyek dibuat dari spreadsheet yang sama dan fungsi setupPertama selesai.

---

## Langkah 10 — Tentukan PIN Pemilik

Login web app menggunakan nama pengguna yang ditampilkan dan PIN yang Anda buat.

![Dialog pembuatan PIN Pemilik (tanpa menampilkan PIN).](gambar/10-pin-pemilik.png)

*Dialog pembuatan PIN Pemilik (tanpa menampilkan PIN).*

**Ikuti langkah berikut:**

1. Catat <b>nama pengguna</b> yang tertera dalam dialog.
2. Masukkan PIN numerik <b>6–12 digit</b>, lalu klik <b>OK</b>.
3. Periksa pesan <b>PIN tersimpan</b> dan simpan kredensial dengan aman.

> **Perhatian:** Dialog bawaan Google Sheets mungkin menampilkan teks PIN saat diketik. Pastikan layar tidak terlihat orang lain.

---

## Langkah 11 — Mulai deployment web app

Langkah ini memublikasikan versi aplikasi agar dapat dibuka melalui tautan browser.

![Menu Deploy → New deployment.](gambar/11-buat-deployment.png)

*Menu Deploy → New deployment.*

**Ikuti langkah berikut:**

1. Kembali ke editor Apps Script.
2. Klik tombol <b>Deploy / Terapkan</b> di kanan atas.
3. Pilih <b>New deployment / Deployment baru</b>.

> **Perhatian:** Simpan seluruh perubahan kode sebelum melakukan deployment.

---

## Langkah 12 — Pilih jenis Web app

Pastikan jenis deployment adalah Web app, bukan add-on atau API executable.

![Jendela deployment: Web app terpilih.](gambar/12-pilih-web-app.png)

*Jendela deployment: Web app terpilih.*

**Ikuti langkah berikut:**

1. Pada jendela <b>New deployment</b>, klik ikon roda gigi di <b>Select type</b>.
2. Pilih <b>Web app</b>.
3. Isi deskripsi, misalnya <b>Versi pertama</b>.

> **Perhatian:** Opsi yang ditampilkan bisa sedikit berbeda tergantung bahasa Google dan kebijakan akun Workspace.

---

## Langkah 13 — Atur siapa yang menjalankan dan mengakses

Untuk arsitektur kode ini, pilih eksekusi sebagai pemilik spreadsheet.

![Konfigurasi Web app: Execute as dan Who has access.](gambar/13-atur-akses.png)

*Konfigurasi Web app: Execute as dan Who has access.*

**Ikuti langkah berikut:**

1. <b>Execute as / Jalankan sebagai:</b> pilih <b>Me / Saya</b>.
2. <b>Who has access:</b> pilih cakupan paling terbatas yang masih memberi akses kepada pengguna sasaran.
3. Klik <b>Deploy</b>. Berikan izin tambahan jika diminta.

> **Perhatian:** Jika memakai Anyone, siapa pun yang memiliki tautan dapat membuka halaman login. Lindungi PIN dan batasi distribusi tautan.

---

## Langkah 14 — Salin link aplikasi /exec

Alamat ini adalah tautan untuk mengakses aplikasi web yang telah diterbitkan.

![Hasil deployment dan tombol menyalin URL /exec.](gambar/14-salin-link.png)

*Hasil deployment dan tombol menyalin URL /exec.*

**Ikuti langkah berikut:**

1. Saat muncul pesan berhasil, cari <b>Web app URL</b>.
2. Klik <b>Copy</b> dan simpan tautan yang diakhiri <b>/exec</b>.
3. Bagikan tautan hanya kepada pengguna yang seharusnya memakai aplikasi.

> **Perhatian:** Jangan bagikan tautan /dev sebagai tautan produksi; /dev digunakan untuk pengujian dan bergantung pada akses editor.

---

## Langkah 15 — Buka web app dan coba login

Pastikan pengguna Pemilik bisa membuka aplikasi dari tautan baru.

![Tampilan login aplikasi dari struktur Index.html (direkonstruksi).](gambar/15-uji-login.png)

*Tampilan login aplikasi dari struktur Index.html (direkonstruksi).*

**Ikuti langkah berikut:**

1. Buka tautan <b>/exec</b> di tab browser baru.
2. Masukkan <b>nama pengguna</b> yang ditampilkan saat membuat PIN dan PIN yang tadi ditentukan.
3. Klik <b>Masuk</b>. Pastikan beranda aplikasi dapat ditampilkan.

> **Perhatian:** Jika halaman meminta setup/PIN, periksa apakah PIN dibuat pada spreadsheet yang sama dengan proyek deploy.

---

## Langkah 16 — Aktifkan refresh laporan tertunda

Untuk versi optimasi, jalankan fungsi ini sekali agar trigger penyegaran laporan dapat diotorisasi.

![Mengaktifkan izin pemicu refresh laporan (opsional).](gambar/16-optimasi-opsional.png)

*Mengaktifkan izin pemicu refresh laporan (opsional).*

**Ikuti langkah berikut:**

1. Di Apps Script pilih fungsi <b>installFastReportRefresh</b>.
2. Klik <b>Run</b>, lalu tinjau izin yang diminta.
3. Saat akun baru dibuat, laporan Sheets dapat disegarkan otomatis beberapa menit kemudian.

> **Perhatian:** Langkah ini tidak diperlukan agar login berfungsi. Jika refresh otomatis gagal, gunakan menu Keuangan → Perbarui Struktur Laporan.

---

## Daftar periksa akhir pemasangan

- [ ] Spreadsheet dibuat dengan akun Google pemilik sendiri.
- [ ] Seluruh 6 file kode tersimpan di proyek yang terhubung dengan spreadsheet.
- [ ] `setupPertama()` berhasil dijalankan tanpa error.
- [ ] Menu `💰 Keuangan` muncul setelah spreadsheet di-refresh.
- [ ] PIN Pemilik sudah dibuat dan nama penggunanya diketahui.
- [ ] Web app diterbitkan sebagai **Execute as: Me / Saya**.
- [ ] Pengaturan akses sesuai kebutuhan (sebaiknya paling terbatas).
- [ ] URL produksi yang digunakan berakhiran `/exec`.
- [ ] Login Pemilik berhasil dan halaman awal aplikasi tampil.
- [ ] (Opsional) `installFastReportRefresh()` telah dijalankan.

## Masalah yang sering terjadi

| Gejala | Pemeriksaan awal |
|---|---|
| Menu `💰 Keuangan` tidak ada | Reload spreadsheet, lalu pastikan `setupPertama()` berhasil. |
| Fungsi `setupPertama` tidak muncul | Simpan semua berkas dan cek apakah kode `Code.gs` ditempel lengkap. |
| `No HTML file named Game` | File `Game.html` belum ada atau penamaan/capitalization berbeda. |
| `gameAction_` tidak ditemukan | File `GameServer.gs` belum dimasukkan. |
| PIN Pemilik tidak bisa dipakai | Gunakan nama pengguna yang ditampilkan saat mengatur PIN. |
| Web app putih atau error | Periksa file `API.gs`, `Index.html` dan tab Executions. |
| Tautan tidak bisa dibuka pengguna lain | Periksa `Who has access` pada deployment. |
| Kode baru belum muncul pada `/exec` | Buat versi baru lewat `Deploy → Manage deployments → Edit → New version`. |

## Rujukan resmi

- [Membuat proyek terhubung ke Google Sheets](https://developers.google.com/apps-script/guides/projects)
- [Menerbitkan web app Google Apps Script](https://developers.google.com/apps-script/guides/web)
- [Otorisasi layanan Google Apps Script](https://developers.google.com/apps-script/guides/services/authorization)
- [Memahami installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)

**Catatan keamanan:** Jangan membagikan akses edit spreadsheet kepada pihak yang hanya membutuhkan web app. Login PIN bukan pengganti pembatasan akses Google Drive dan tidak setara dengan autentikasi perusahaan yang telah diaudit.

*Panduan ini hanya untuk instalasi baru. Jangan menjalankan `setupPertama()` pada spreadsheet produksi hanya untuk memperbarui kode.*
