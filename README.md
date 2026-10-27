# KMH Pendanaan: Platform P2P Lending Syariah

Website pendukung kegiatan peer to peer lending tertutup antar anggota Koperasi Kita Miraino Hikari (KMH), sesuai dokumen *Mekanisme P2P Lending Syariah (Musyarakah) & Brief Pengembangan Website* v1.0.

- **Akad**: Musyarakah (pendana–KMH) dan Ijarah Multijasa (KMH–calon pemagang)
- **Perlindungan**: Dana Proteksi (tabarru') dan ambil alih (buyback) KMH pada pokok tersisa
- **Segmen**: pembiayaan calon peserta magang PMI ke Jepang
- **Aliran dana**: Virtual Account (top-up pendana dan angsuran per pembiayaan)

## Isi paket

| Folder/berkas | Isi |
|---|---|
| `public/` | Antarmuka web (HTML/CSS/JS tanpa framework) |
| `public/shared/` | Logika bisnis: ledger double-entry, distribusi bagi hasil, alur pembiayaan. Dipakai bersama oleh server dan mode demo |
| `server/` | Server Node.js (Express) + PostgreSQL: autentikasi, 2FA, API, webhook VA, unggah dokumen |
| `tests/` | Uji otomatis angka Bab 5 dan skenario Lampiran H |
| `deploy/` | Caddyfile (HTTPS), contoh Nginx, unit systemd, skrip backup |
| `Dockerfile`, `docker-compose.yml` | Deploy satu perintah |
| `dist/kmh-pendanaan-demo.html` | Versi demo satu berkas (berjalan tanpa server, data contoh) |

## Fitur sesuai brief (Bab 8.3)

| Modul | Status |
|---|---|
| Onboarding & verifikasi anggota (KYC, unggah dokumen) | Ada |
| Dompet & ledger double-entry append-only | Ada (trigger PostgreSQL menolak UPDATE/DELETE jurnal) |
| Integrasi VA: VA top-up per pendana, VA angsuran per pembiayaan, webhook HMAC, idempotensi | Ada (HMAC + IP allowlist opsional + rate limit) |
| **Login 2 tahap: Email + Kata Sandi, lalu 2FA Google Authenticator (QR + kode 6 digit)** | Ada |
| **Akun demo khusus investor (peran Pendana) dengan akses WAF, Brankas, dan Jejak Audit** | Ada |
| Application Firewall (WAF) W1–W12 + deteksi probe PHP2Shell | Ada (`server/waf.js`, mode off/detect/block) |
| Security Alert real-time (in-app + SMTP + WhatsApp) | Ada (`server/security-alert.js`, tabel `security_events`) |
| Envelope encryption AES-256-GCM (AWS KMS ready + local vault) | Ada (`server/crypto-envelope.js`) |
| Brankas Data Nominatif P2P & LOS dengan pembuka biometrik | Ada (`server/vault.js`) |
| **Impor dataset LOS 560 baris (560 DATA.csv) ke brankas terenkripsi** | Ada (`server/los-import.js`, tabel `los_records`) |
| WebAuthn / FIDO2 (sidik jari, Windows Hello, passkey) | Ada (`server/biometric.js`) |
| **Face Recognition (Biometric Face & Liveness Detection)** 3 pose acak + buka mulut + senyum | Ada (`server/face.js`, `public/face.js`) |
| Step-up auth untuk 6 operasi kritis | Ada (TTL 5 menit, token dicabut saat kunci dikunci) |
| Pengajuan per komponen biaya, analisa 5C, kalkulator kapasitas bayar | Ada |
| Komite (kuorum, satu penolakan menolak) | Ada |
| Marketplace tersamarkan, batas porsi, minimum & kelipatan, batas waktu | Ada |
| Akad digital terkunci (SHA-256), tanda tangan elektronik penerima & KMH | Ada |
| Pencairan bertahap ke mitra dengan maker-checker | Ada |
| Jadwal angsuran, alokasi proporsional, distribusi otomatis + Dana Proteksi | Ada |
| Penagihan (bucket DPD, catatan, janji bayar), gagal berangkat | Ada |
| Waterfall kerugian: klaim Dana Proteksi → buyback KMH → hapus buku | Ada |
| Penarikan dana (Finance verifikasi, Manajer setujui) | Ada |
| Rekonsiliasi CSV mutasi bank | Ada |
| Dasbor portofolio (NPL, DPD, eksposur mitra, kecukupan Dana Proteksi), buku besar, jejak audit | Ada |
| Notifikasi | Di dalam aplikasi. WhatsApp/email: lihat *Pengembangan lanjutan* |
| Auto-reinvest, pengalihan porsi, aplikasi mobile | Fase 3 (belum) |

## Mencoba cepat (lokal)

```bash
npm install
cp .env.example .env            # isi DATABASE_URL & JWT_SECRET
# server uji dengan data contoh (aktifkan simulator & simulasi tanggal):
ALLOW_VA_SIMULATOR=true ALLOW_TIME_TRAVEL=true COOKIE_SECURE=false npm run seed:demo
ALLOW_VA_SIMULATOR=true ALLOW_TIME_TRAVEL=true COOKIE_SECURE=false npm start
# buka http://localhost:3000  — akun contoh: ani@contoh.id, analis@kmh.coop, komite1@kmh.coop,
# finance@kmh.coop, manajer@kmh.coop, admin@kmh.coop, dodi@contoh.id  (kata sandi: demo12345)
npm test                        # 11 uji alur & angka + 13 uji keamanan + 14 uji LOS/2FA/Face
```

## Login 2 Tahap & 2FA Google Authenticator

Alur masuk wajib dua tahap:

1. **Tahap 1 - Email + Kata Sandi** (`POST /api/auth/login`). Bila kredensial benar, server
   **tidak** menerbitkan sesi; ia membuat *login challenge* dan mengembalikan
   `{ need_otp: true, challenge, expires_at }`.
2. **Tahap 2 - Verifikasi 2FA Google Authenticator** (`POST /api/auth/2fa/verify`). Halaman
   lanjutan menampilkan **QR Code** untuk memindai lewat aplikasi Google Authenticator di
   ponsel (atau kode rahasia base32 bila pindai tidak tersedia), lalu meminta kode 6 digit.
   Hanya bila kode benar, sesi cookie diterbitkan dan pengguna masuk ke dasbor.

Setiap akun Diam-diam dibuatkan secret TOTP base32 yang valid saat server pertama kali
dari `ensureTotpSecrets()`, sehingga semua akun siap dihubungkan ke aplikasi
Google Authenticator di ponsel.

**Tiga kali kode 2FA salah berturut-turut** -> akun terkunci 15 menit, percobaan login
ditolak `429`, dan insiden **CRITICAL** (`TOTP_LOCKOUT`) tercatat di `security_events`
dengan banner merah real-time.

## Dataset LOS 560 Data (Brankas Data Nominatif)

`560 DATA.csv` (delimiter `;`, 15 kolom, 560 baris) diimpor otomatis saat server start
(`npm run seed:los` untuk impor manual). Prinsip transformasi:

- Kolom `id` menjadi **`ID Pengajuan`** dengan pola `LOA-YYMMDD-HHMM-XXX`
  (`LOA-261024-2140-001` … `LOA-261024-2140-560`, urutan ke-407 = `LOA-261024-2140-407`).
- **Semua status `REJECTED` dan `CLOSED_LOAN` diubah menjadi `Active`**, ditandai
  `is_active = 1` dan badge hijau **"ACTIVE — TERVERIFIKASI LOS"**. Nilai status asal
  disimpan pada kolom `source_loan_status` untuk jejak audit.
- Struktur kolom asli tidak diubah; kolom yang sudah berupa NIK/enkripsi dipertahankan
  apa adanya lalu dienkripsi ulang dengan envelope KMH (AAD terikat `id_pengajuan`).
- Tab **"Data Nominatif LOS (560 Data)"** menyediakan pencarian (nama, email, telepon,
  NIK, ID Pengajuan, loan code), filter gender & status asal, serta paginasi 25 baris
  per halaman. Pencarian tetap bekerja saat brankas terkunci karena memakai token hash.

## Face Recognition (Biometric Face & Liveness Detection)

Menggantikan mode retina sebelumnya. Arsitektur kriptografi tetap: challenge acak
server + tanda tangan ECDSA P-256 kunci perangkat + AAD terikat + TTL challenge.

- **Pendaftaran**: 3 tahap posisi wajah dengan **urutan acak** (menghadap depan, kiri,
  kanan), masing-masing ditahan ~3 detik (total ~10 detik).
- **Membuka brankas**: 3 pose acak **diikuti** tantangan liveness **buka mulut** dan
  **senyum**; total durasi **5–10 detik**, dengan progress bar dan instruksi visual
  per tahapan di layar kamera.
- Server memverifikasi: urutan tahapan harus sama persis dengan challenge, tanda tangan
  challenge, durasi 5–10 detik (diukur server), kesamaan vektor per pose (ambang 0,72),
  serta metrik liveness mulut/senyum terhadap baseline pendaftaran.
- **Tiga kali gagal berturut-turut** → Security Alert **CRITICAL** (`FACE_LOCKOUT`) dan
  banner merah real-time.
- Tombol **"Simulasikan Gagal Verifikasi"** tersedia pada modal kamera untuk mendemokan
  skenario gagal buka brankas.

## Akun Demo Investor (peran Pendana)

Akun khusus untuk presentasi demo. Dibuat otomatis saat server pertama kali berjalan
(`ensureDemoInvestor()`) dan juga tersedia di `npm run seed:demo`.

| Item | Nilai |
|---|---|
| Email | `investor@kmh.coop` |
| Nama | Investor KMH |
| Nomor anggota | KMH-0801 |
| Peran | pendana (investor) |
| Status KYC | Terverifikasi (disimpan sebagai `approved`) |
| Kata sandi | `KtGZQ54U_2BS_4Uh$ius` |
| Dompet virtual + VA | Dibuat otomatis |
| Secret 2FA | Dibuat otomatis (base32), ditampilkan lewat QR pada halaman 2FA |

Menu yang tersedia untuk peran **Pendana** (selain menu anggota biasa):
*Keamanan & Firewall (WAF)* · *Brankas Data Nominatif* · *Jejak Audit* · *Notifikasi* (grup **Akun**, tersedia untuk semua peran tanpa duplikasi).

```
Login  →  investor@kmh.coop / KtGZQ54U_2BS_4Uh$ius  →  pindai QR Google Authenticator  →  masuk
```

## Keamanan & Firewall (WAF)

Menu **Back-office → Keamanan & Firewall (WAF)** (peran admin & manajer) menampilkan status kesehatan
runtime, statistik serangan, katalog aturan, dan log peristiwa real-time (Server-Sent Events).
Panel ini juga menyediakan **Uji WAF (simulasi serangan)** untuk membuktikan blokir dan
Security Alert bekerja seketika.

| Rule | Kategori | Contoh pemicu |
|---|---|---|
| W1 | SQL Injection | `'; DROP TABLE ...`, `UNION SELECT`, `pg_sleep(` |
| W2 | Cross-Site Scripting | `<script>`, `onerror=`, `javascript:` |
| W3 | Path Traversal | `../`, `%2e%2e%2f`, `/etc/passwd` |
| W4 | Upload Berbahaya | Ekstensi `.php`, MIME bukan magic byte |
| W5 | Brute-Force Login | 5 kali gagal pada satu akun / 15 menit |
| W6 | Brute-Force OTP | 5 kali TOTP salah |
| W7 | Session Hijack | Satu token dipakai dari 2 IP berbeda |
| W8 | Mass Assignment / Eskalasi Privilege |Upaya menulis `roles`, `kyc_status`, `active` |
| W9 | Webhook Spoofing | Tanda tangan salah, IP di luar allowlist, flood |
| W10 | DoS & Probe PHP2Shell | `auto_prepend_file`, `php://input`, body bomb, `Content-Length` + `Transfer-Encoding` |
| W11 | Header Spoofing | Host asing, `X-Forwarded-For` melebihi hop tepercaya |
| W12 | Reconnaissance | Pemindaian berurutan ID, nama RPC tak dikenal |

Mode Firewall diatur dari panel (`WAF_MODE=block|detect|off`). Setiap peristiwa kritis langsung
muncul sebagai banner merah dan toast real-time di panel, dicatat ke tabel `security_events`,
ditulis ke `audit_logs`, dan dikirim ke notifikasi in-app Admin/Manajer. Saluran Email (SMTP) dan
WhatsApp Webhook bersifat opsional lewat `.env` dan otomatis nonaktif bila kosong.

## Brankas Data Nominatif (Biometrik)

Menu **Back-office → Brankas Data Nominatif** menyimpan NIK, nomor rekening, alamat, dan nilai
pembiayaan P2P & LOS sebagai **ciphertext AES-256-GCM** (envelope encryption, satu DEK per record,
AAD terikat konteks record). Secara default brankas **TERKUNCI** dan kolom hanya menampilkan
potongan ciphertext.

- **PEMBUKA KUNCI**: WebAuthn/FIDO2 (sidik jari, Windows Hello, passkey) atau mode Kamera
  Retina/Mata (WebRTC) yang menggabungkan challenge server, tanda tangan kunci perangkat
  (ECDSA P-256), vektor pola 8×8, dan skor liveness.
- **Auto-lock 5 menit** dengan hitung mundur di layar, tombol **Kunci Kembali Database Sekarang**,
  dan pencatatan `vault_unlock`/`vault_lock` pada `audit_logs` lengkap dengan IP dan metode.
- **Tiga kali verifikasi gagal berturut-turut** memicu Security Alert tingkat **KRITIS** ke Firewall.
- Envelope encryption memakai **AWS KMS** bila `AWS_KMS_KEY_ID` terisi, dan otomatis fallback ke
  **Local Master Key Vault** (HKDF + AES-256-GCM dari `ENVELOPE_MASTER_KEY`) saat lokal.
  Pergantian kunci master memicu rotasi otomatis seluruh ciphertext.

## Variabel lingkungan baru

```
TRUST_PROXY_HOPS=1            # jumlah proxy tepercaya di depan aplikasi (0 = akses langsung)
WAF_MODE=block                # off | detect | block
WAF_BLOCK_THRESHOLD=60        # skor minimum untuk memblokir
LOGIN_RATE_LIMIT=10           # percobaan login gagal per 15 menit
BRUTE_FORCE_MAX=5             # batas gagal login per akun
OTP_MAX_ATTEMPTS=5            # batas TOTP salah
VA_WEBHOOK_IP_ALLOWLIST=      # IP penyedia VA yang sah (pisahkan dengan koma)
ALLOWED_HOSTS=                # Host yang diizinkan (proteksi header spoofing)
ENVELOPE_MASTER_KEY=          # kunci master lokal (32+ karakter); awali dengan openssl rand -base64 48
AWS_KMS_KEY_ID=               # bila diisi, memakai AWS KMS untuk membungkus DEK
AWS_REGION=ap-southeast-1
WEBAUTHN_RP_ID=localhost      # domain produksi: p2p.kmh.coop
WEBAUTHN_ORIGIN=https://p2p.kmh.coop
STEP_UP_TTL_SECONDS=600
VAULT_TTL_SECONDS=600
REQUIRE_STEP_UP=true          # wajibkan step-up biometrik untuk operasi kritis
REQUIRE_STEP_UP_STRICT=false  # true = wajibkan walau belum ada perangkat terdaftar
SMTP_HOST=, SMTP_PORT=587, SMTP_USER=, SMTP_PASS=, SMTP_FROM=, SMTP_TO=
WHATSAPP_WEBHOOK_URL=, WHATSAPP_TOKEN=
SECURITY_ALERT_EMAIL_MIN_SEVERITY=high
SECURITY_ALERT_WHATSAPP_MIN_SEVERITY=critical
OTP_MAX_ATTEMPTS=3
OTP_CHALLENGE_TTL_MS=300000
FACE_HOLD_MS=2600
FACE_MIN_TOTAL_MS=5000
FACE_MAX_TOTAL_MS=25000
LOS_CSV_PATH=./560 DATA.csv
```

Tanpa `DATABASE_URL`, server memakai SQLite (`SQLITE_FILE=./data/kmh.sqlite`, butuh `npm install better-sqlite3`). Gunakan hanya untuk uji; produksi wajib PostgreSQL.

## Deploy ke server KMH (Docker, disarankan)

Kebutuhan: VPS Linux (2 vCPU, 2 GB RAM, 40 GB disk cukup untuk tahap pilot), Docker + Docker Compose, domain (mis. `p2p.kmh.coop`) yang A-record-nya mengarah ke IP server, port 80/443 terbuka.

```bash
# 1. Salin paket ke server
scp kmh-p2p.zip user@server:/opt/ && ssh user@server
cd /opt && unzip kmh-p2p.zip && cd kmh-p2p

# 2. Konfigurasi
cp .env.example .env
nano .env        # isi POSTGRES_PASSWORD, JWT_SECRET (openssl rand -base64 48), ADMIN_EMAIL,
                 # ADMIN_PASSWORD, DOMAIN, VA_PROVIDER, VA_WEBHOOK_SECRET

# 3. Jalankan (aplikasi + PostgreSQL + HTTPS otomatis)
docker compose up -d --build
docker compose logs -f app       # tunggu "KMH P2P berjalan di port 3000"

# 4. Backup harian
crontab -e   # tambahkan: 30 1 * * * /opt/kmh-p2p/deploy/backup.sh
```

Setelah berjalan:
1. Masuk dengan `ADMIN_EMAIL`, ganti kata sandi, aktifkan 2FA di **Profil & keamanan**.
2. **Pengaturan**: isi `Prefix VA` dari bank, cek nisbah, porsi Dana Proteksi, modal minimal KMH, kuorum komite.
3. **Mitra LPK/SO**: daftarkan mitra beserta rekening tujuan pencairan.
4. **Anggota**: tambahkan staf (Analis, Komite ×2, Finance, Manajer). Setiap staf wajib mengaktifkan 2FA bila `REQUIRE_2FA_BACKOFFICE=true`.
5. **Dasbor → Dompet KMH**: setor modal KMH ke VA KMH agar pembiayaan bisa ditayangkan.
6. Anggota mendaftar sendiri di halaman muka; Admin memverifikasi di menu **Anggota**.

### Tanpa Docker
Pasang Node.js 20+ dan PostgreSQL 14+, lalu `npm ci --omit=dev`, isi `.env`, pasang `deploy/kmh-p2p.service` (systemd) dan `deploy/nginx.conf.example` (reverse proxy + HTTPS certbot).

## Integrasi Virtual Account

Endpoint webhook: `POST https://DOMAIN/api/webhooks/va/<VA_PROVIDER>`

- Header `x-signature` = HMAC-SHA256 dari body mentah dengan `VA_WEBHOOK_SECRET` (hex).
- Body format umum: `{"transaction_id":"...","va_number":"...","amount":2950000,"paid_at":"ISO-8601"}`.
- ID transaksi yang sama hanya diproses sekali (aman terhadap pengiriman ulang).
- VA tak dikenal tercatat sebagai *VA tidak dikenal*; pembayaran saat pembiayaan belum dalam masa bayar dicatat sebagai *titipan*. Keduanya tampil di dasbor Finance.

Penyedia VA berbeda-beda (VA langsung bank syariah atau payment gateway). Setelah penyedia dipilih, sesuaikan dua hal di `server/index.js`:
1. Fungsi `mapProviderPayload()` agar nama field cocok dengan dokumentasi penyedia.
2. Cara verifikasi tanda tangan bila penyedia tidak memakai HMAC header `x-signature` (mis. token callback atau signature RSA).

Pembuatan nomor VA saat ini memakai pola `prefix + jenis + ID` (VA statis open amount). Bila penyedia mewajibkan pendaftaran VA lewat API, tambahkan panggilan API di fungsi `ensureVA()` (`public/shared/services.js`).

Pencairan ke mitra dan penarikan pendana dicatat setelah Manajer menyetujui; transfer banknya dilakukan manual lewat internet banking KMH (atau tambahkan API payout bila penyedia mendukung).

## Keamanan yang sudah diterapkan

- Kata sandi bcrypt; sesi JWT di cookie `httpOnly`, `SameSite=Strict`, `Secure`; sesi gugur saat kata sandi diganti.
- 2FA TOTP (wajib untuk staf bila diaktifkan); pembatasan percobaan login (10 per 15 menit).
- Hak akses berbasis peran di setiap layanan; pemisahan maker-checker untuk pencairan dan penarikan; komite tidak bisa memutus pengajuan sendiri.
- Ledger append-only di level database; setiap jurnal wajib seimbang; transaksi database atomik; penguncian baris saat pendanaan.
- Data penerima disamarkan di marketplace; dokumen KYC hanya dapat diunduh pemilik, Admin, dan Analis.
- Header keamanan (Helmet/CSP), webhook terverifikasi HMAC dengan perbandingan waktu-konstan.
- Simulator VA dan simulasi tanggal **mati secara bawaan**; hanya aktif bila diizinkan lewat variabel lingkungan.

## Sebelum go-live (Lampiran I laporan)

- Opini tertulis DPS atas akad, Dana Proteksi, buyback, dan perlakuan keterlambatan. Teks akad ada di fungsi `createContract()`; minta DPS dan penasihat hukum meninjau sebelum dipakai.
- Rekening penampung terpisah dari kas operasional, kontrak penyedia VA, uji di sandbox penyedia.
- Uji penetrasi dasar, uji pemulihan backup, dan pilot 5–10 pembiayaan.

## Pengembangan lanjutan

- Kirim notifikasi lewat WhatsApp Business API/email: tambahkan pengiriman di fungsi `notify()` (`public/shared/services.js`), sebaiknya lewat antrian (Redis) agar tidak memperlambat transaksi.
- Sinkronisasi jurnal harian ke ERPNext (akun 1100–4100 sudah mengikuti Lampiran D).
- Auto-reinvest, pengalihan porsi antar anggota, aplikasi mobile (PWA).

## Catatan teknis

- Nominal disimpan sebagai rupiah bulat (BIGINT). Pembagian memakai metode sisa terbesar sehingga total distribusi selalu tepat sama dengan uang masuk.
- Tanggal bisnis memakai WIB (`TZ_OFFSET_HOURS=7`).
- `npm run build:demo` membuat ulang `dist/kmh-pendanaan-demo.html` dari kode `public/` (membutuhkan dev-dependency esbuild).
