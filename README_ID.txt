VOLTGUARD — SMART BREAKER TUYA
================================================

ISI PAKET
- index.html       Dashboard responsif untuk desktop dan HP
- styles.css       Desain dashboard profesional
- app.js           Interaksi UI, grafik contoh, dan kontrol Tuya
- manifest.webmanifest + sw.js   Dukungan instalasi PWA/offline dasar
- assets/icon.svg  Ikon aplikasi

PENTING
Dashboard hanya mengendalikan breaker sungguhan setelah backend Tuya berhasil
dikonfigurasi dan status perangkat berhasil dibaca. Sebelum itu, kontrol fisik
dinonaktifkan dan angka yang terlihat ditandai sebagai data simulasi.
Jangan gunakan dashboard ini sebagai satu-satunya sarana pemutus darurat atau
untuk keputusan keselamatan listrik.

MENJALANKAN
1. Pastikan Node.js versi 18 atau lebih baru tersedia.
2. Untuk uji lokal, ikuti bagian BACKEND TUYA LOKAL, jalankan `npm start`, lalu
   buka http://localhost:8001.
3. Untuk akses online, ikuti bagian AKSES JARAK JAUH DENGAN SUPABASE. Hosting
   statis tanpa konfigurasi Supabase hanya menampilkan demo dan tidak dapat
   membaca atau mengendalikan perangkat.

INTEGRASI TUYA SEBENARNYA
1. Pastikan breaker sudah dipasangkan ke Tuya Smart atau Smart Life.
2. Buat project yang sesuai di Tuya Developer Platform, pilih data center/region
   yang cocok dengan akun dan perangkat, lalu otorisasi layanan yang diperlukan.
   Pilih region berdasarkan data center project Tuya, bukan IP atau zona waktu
   perangkat. Backend mendukung region us, eu, cn, in, dan sg.
3. Pastikan akun perangkat dapat dihubungkan ke project yang dibuat.
4. Baca Thing Model / specification perangkat untuk menemukan kode DP sebenarnya.
   Kode switch, voltage, current, power, energy, alarm dan trip dapat berbeda
   tergantung model/firmware. Jangan mengasumsikan kode DP universal.
5. Backend Node.js pada proyek ini menyimpan kredensial server-side,
   menandatangani permintaan Tuya, membaca status, dan mengirim perintah switch.
   Frontend hanya memanggil backend lokal. Jangan pernah memasukkan Access
   Secret/API secret ke app.js, HTML, repositori publik, atau browser.
6. Uji baca status terlebih dahulu. Setelah itu uji kontrol dengan konfirmasi,
   perangkat yang benar, dan pengawasan orang dewasa/teknisi yang kompeten.
7. Terapkan autentikasi, HTTPS, pembatasan akses, log perintah, penanganan error,
   dan perlindungan dari perintah berulang.

Dokumentasi resmi Tuya:
https://developer.tuya.com/en/docs/cloud
Referensi status perangkat:
https://developer.tuya.com/en/docs/cloud/1ef1a3044b?id=Kconf2usgnfwo
Referensi kontrol breaker (ketersediaan tergantung produk/izin project):
https://developer.tuya.com/en/docs/cloud/electric-energy-open-capacity?id=Kbi599hlehgkn

CATATAN HOSTING
GitHub Pages men-host dashboard statis melalui HTTPS; Supabase Edge Function
menjadi backend aman untuk akses Tuya. Server Node.js lokal tetap hanya untuk
pengembangan dan bind ke localhost.

AKSES JARAK JAUH DENGAN SUPABASE
- GitHub Pages dapat meng-host tampilan statis; Supabase Edge Function menangani
  permintaan Tuya server-side. Node.js lokal tidak perlu dibuka ke internet.
- Buat project Supabase dan satu akun pemilik di Authentication. Nonaktifkan
  pendaftaran publik setelah akun dibuat. Gunakan kata sandi kuat dan MFA jika tersedia.
- Buat repository GitHub, push project ke branch `main`, lalu di repository
  Settings → Pages pilih GitHub Actions sebagai source.
- Di repository Settings → Secrets and variables → Actions → Variables, tambah
  SUPABASE_URL dan SUPABASE_ANON_KEY dari Supabase. Keduanya adalah konfigurasi
  client publik; jangan pernah menaruh service-role key atau kredensial Tuya
  di file frontend. Workflow `.github/workflows/deploy-pages.yml` hanya mengemas
  file web yang diperlukan dan tidak mengunggah `.env` atau kode backend lokal.
- GitHub Actions otomatis menerbitkan ulang Pages setiap ada push ke `main`.
  Tunggu workflow Deploy VoltGuard to GitHub Pages selesai, lalu gunakan URL
  `https://<akun>.github.io/<repository>/`.
- Di Supabase Authentication, tambahkan URL GitHub Pages ke Site URL dan
  Redirect URLs. Di Edge Function Secrets, atur TUYA_REGION, TUYA_ACCESS_ID,
  TUYA_ACCESS_SECRET, TUYA_DEVICE_ID, TUYA_SWITCH_DP, kode DP metrik, serta
  faktor skalanya. Secrets juga harus berisi ALLOWED_USER_ID (UUID akun pemilik)
  dan APP_ORIGINS (origin persis, misalnya https://akun.github.io, tanpa path).
  Jangan mengaktifkan pendaftaran publik setelah akun pemilik dibuat.
- Jika dashboard menampilkan `clientId is invalid`, perbarui TUYA_ACCESS_ID dan
  TUYA_ACCESS_SECRET di Supabase Secrets menggunakan kredensial aktif dari project
  Tuya Cloud yang sama. Jangan kirim Access Secret melalui chat. Pastikan project
  Tuya menggunakan data center yang sama dengan TUYA_REGION dan telah diberi izin
  API serta akses ke perangkat.
- Variabel SUPABASE_URL dan SUPABASE_ANON_KEY tersedia otomatis untuk Edge Function.
  Jangan mengatur atau menaruh service-role key di frontend.
- Dari folder proyek, login dan tautkan Supabase CLI, lalu deploy fungsi:
  `npx supabase login`, `npx supabase link --project-ref REF_PROJECT`, dan
  `npx supabase functions deploy voltguard`.
- Deploy file frontend ke GitHub Pages melalui HTTPS. Pastikan origin halaman
  persis sama dengan salah satu origin APP_ORIGINS. Fungsi memvalidasi JWT dan
  hanya menerima UUID akun yang diizinkan.
- Setelah workflow selesai, buka dashboard dan login dengan akun pemilik.
  Status dan metrik Tuya dapat dibaca publik tanpa login; siapa pun yang memiliki
  URL dapat melihatnya. Tombol ON/OFF tetap memerlukan sesi pengguna pemilik,
  yang dapat dimulai dengan tautan login email tanpa password.
  Status Tuya diperiksa setiap 3 detik selama tab dashboard terbuka dan terlihat.
  Ini polling, bukan push instan; dapat mencapai 28.800 pembacaan status per hari
  untuk satu tab yang terus aktif dan bisa terkena batas/kuota Tuya atau Supabase.
  Untuk mengurangi pemakaian API, naikkan interval pada `setInterval` di app.js.
- Tarif Rp/kWh disimpan pada profil akun Supabase sehingga berlaku lintas perangkat.
- Tarif awal biaya disetel Rp1.444,70/kWh. Biaya harian dihitung dari selisih DP
  energi kumulatif setiap pembaruan status dan disimpan pada browser/perangkat ini.
  Nilai saat ini, tegangan, arus, daya, dan status dapat dibuka online setelah
  Pages dan Supabase selesai dikonfigurasi; catatan konsumsi harian belum dibagi
  lintas browser/perangkat.
- Saat pertama kali dibuka pada suatu hari, hitungan dimulai dari pembacaan pertama
  hari itu; pemakaian sebelum dashboard dibuka tidak dapat dihitung. Untuk total
  penuh sejak tengah malam, dashboard harus sudah menerima data sebelum/saat hari
  berganti atau perangkat harus menyediakan DP konsumsi harian.
- Grafik konsumsi dan tabel riwayat pada versi ini masih data demo; polling status
  tidak membentuk riwayat historis.
- Endpoint status publik tetap dibatasi ke origin GitHub Pages melalui CORS, tetapi
  data live tidak rahasia setelah dibagikan pada situs publik. Endpoint switch tetap
  memvalidasi JWT dan ALLOWED_USER_ID di backend.

BACKEND TUYA LOKAL
- Gunakan Node.js 18 atau lebih baru; backend tidak memerlukan dependency npm tambahan.
- Salin .env.example menjadi .env, lalu isi TUYA_ACCESS_ID, TUYA_ACCESS_SECRET,
   TUYA_DEVICE_ID, dan TUYA_REGION dari project Tuya Developer Platform.
- TUYA_REGION harus sama dengan data center project Tuya (misalnya sg jika
   project memang dibuat di Singapore); zona waktu Asia/Jakarta tidak menentukan region.
   Backend menggunakan endpoint resmi Singapore `https://openapi-sg.iotbing.com`.
- Periksa Thing Model perangkat untuk mengetahui kode DP switch/tegangan/arus/daya/energi.
   Isi kode yang benar pada .env; gunakan faktor seperti 0.1 bila nilai DP perlu diskalakan.
- Jika status breaker terbaca tetapi nilai listrik kosong, bandingkan kode DP metrik
  di .env dengan kode yang tampil pada keterangan Parameter listrik. Backend lokal
  hanya menampilkan data yang benar-benar dikirim Tuya; DP antar-model berbeda.
- Untuk KWS-302WF T1, gunakan kode metrik yang dilaporkan perangkat (voltage,
  current, power, energy, temp), bukan nomor urut kolom. Faktor skala di .env
  merupakan konversi nilai mentah; cocokkan hasilnya dengan aplikasi Tuya dan
  dokumentasi model sebelum digunakan untuk keputusan keselamatan/penagihan.
- Riwayat yang ditandai SIMULASI dapat dihapus per baris atau sekaligus. Daftar
  riwayat demo disimpan di browser/perangkat ini dan tidak menghapus data Tuya.
- Jalankan `npm start`, lalu buka http://localhost:8001. Backend bind ke 127.0.0.1
   secara default dan .env tidak disajikan ke browser. Jangan mengubah HOST ke alamat
   publik tanpa menambahkan autentikasi dan HTTPS.
- Tombol ON/OFF aktif hanya setelah status switch berhasil dibaca dari Tuya.
   Jika koneksi gagal, status ditampilkan tidak diketahui dan kontrol dinonaktifkan.
- Jalankan backend hanya di localhost. Jangan mengubah HOST ke alamat publik atau
   mem-forward port tanpa menambahkan autentikasi dan HTTPS.
- Untuk deployment online, gunakan backend server-side dengan HTTPS, autentikasi,
   pembatasan akses, dan pengelolaan secret yang sesuai; jangan gunakan .env di hosting statis.
