KMH – P2P Lending Syariah & Brief Website 

**KOPERASI KITA MIRAINO HIKARI (KMH)** 

# **Mekanisme Peer to Peer Lending Syariah (Musyarakah) & Brief Pengembangan Website** 

_Platform pendanaan tertutup (closed loop) antar anggota KMH untuk pembiayaan calon peserta magang PMI ke Jepang_ 

**Jenis dokumen:** Laporan konsep bisnis + brief teknis pengembangan **Pembaca:** Pengurus/Pengawas/DPS KMH dan tim/vendor developer **Versi:** 1.0 – Draft untuk pembahasan **Tanggal:** 24 Oktober 2026 

_Catatan: angka dalam dokumen ini adalah ilustrasi untuk menjelaskan mekanisme, bukan penawaran imbal hasil. Seluruh struktur akad wajib divalidasi Dewan Pengawas Syariah (DPS) KMH sebelum diterapkan._ 

Halaman 1 

KMH – P2P Lending Syariah & Brief Website 

## **Daftar Isi** 

_(Jika daftar isi belum tampil, klik kanan pada area ini lalu pilih Update Field.)_ 

Halaman 2 

KMH – P2P Lending Syariah & Brief Website 

## **Ringkasan Eksekutif** 

KMH akan menjalankan platform **peer to peer (P2P) lending syariah tertutup** : anggota KMH yang memiliki dana (pendana) membiayai kebutuhan anggota KMH lain yang merupakan **calon peserta magang PMI ke Jepang** (penerima pembiayaan). KMH bertindak sebagai penyelenggara platform, pengelola syirkah, analis, dan penagih. 

Dokumen ini menetapkan lima keputusan desain dan menerjemahkannya menjadi mekanisme operasional serta spesifikasi website: 

|**Aspek**|**Keputusan**|**Implikasi utama**|
|---|---|---|
|Prinsip akad|Syariah –<br>Musyarakah|Pendana dan KMH menjadi mitra (syarik) dalam syirkah<br>pembiayaan; bagi hasil dengan nisbah, kerugian sesuai porsi<br>modal.|
|Penanggung<br>risiko|Dana Proteksi +<br>buyback KMH|Lapis perlindungan berjenjang. Buyback adalah titik kritis syariah<br>dan perlu struktur khusus (Bab 3.4).|
|Segmen|Calon magang PMI ke<br>Jepang|Ada masa tenggang sebelum bekerja, pencairan bertahap ke<br>LPK/vendor, angsuran dari gaji di Jepang.|
|Aliran dana|Virtual Account (VA)|VA top-up per pendana dan VA angsuran per pembiayaan;<br>rekonsiliasi otomatis via webhook.|
|Pembaca|Bisnis + teknis|Bab 1–8 untuk pengurus; Lampiran A–I untuk developer.|



##### **Rekomendasi kunci** 

**1. Gunakan dua lapis akad.** Musyarakah di tingkat pendana–KMH (syirkah pembiayaan). Di tingkat KMH–calon pemagang, gunakan **Ijarah Multijasa** (jasa pelatihan & pengurusan keberangkatan) karena calon pemagang tidak menjalankan usaha yang menghasilkan laba untuk dibagi; penghasilannya berupa upah. 

**2. Dana Proteksi berbentuk dana tabarru'** (hibah kolektif yang dikelola terpisah), bukan janji pengembalian modal. 

**3. Buyback KMH** dijalankan sebagai pengalihan piutang pada nilai pokok tersisa melalui janji sepihak (wa'd) KMH, terpisah dari peran KMH sebagai pengelola, dan hanya setelah disetujui DPS. 

**4. Website dibangun dengan inti ledger double-entry** , integrasi VA bank/payment gateway syariah, dan alur persetujuan maker-checker. MVP realistis 10–14 minggu. 

Halaman 3 

KMH – P2P Lending Syariah & Brief Website 

## **1. Latar Belakang dan Ruang Lingkup** 

### **1.1 Konteks** 

Biaya persiapan keberangkatan magang ke Jepang (pelatihan bahasa, pemeriksaan kesehatan, dokumen, visa, tiket, dan biaya LPK/SO) umumnya harus dibayar sebelum peserta memiliki penghasilan. Di sisi lain, sebagian anggota KMH memiliki dana yang ingin diproduktifkan secara syariah. Platform P2P tertutup mempertemukan kedua kebutuhan tersebut di dalam lingkungan keanggotaan KMH. 

### **1.2 Batasan** 

- Kegiatan hanya untuk anggota KMH (closed loop). Sesuai arahan, regulasi regulator (Kementerian Koperasi, OJK, dan sejenisnya) mengenai P2P **tidak dibahas** dalam dokumen ini. 

- Kesesuaian syariah tetap menjadi syarat, karena merupakan keputusan prinsip akad KMH sendiri. Rujukan yang digunakan adalah fatwa DSN-MUI dan validasi akhir oleh DPS KMH. 

- Angka simulasi adalah ilustrasi; parameter final (nisbah, ujrah, porsi modal KMH, persentase Dana Proteksi) ditetapkan Pengurus bersama DPS. 

### **1.3 Struktur dokumen** 

Bab 2–7 menjelaskan konsep, akad, mekanisme, simulasi, risiko, dan tata kelola. Bab 8 adalah brief website untuk pengambil keputusan. Lampiran A–I berisi spesifikasi teknis untuk developer. 

Halaman 4 

KMH – P2P Lending Syariah & Brief Website 

## **2. Konsep Dasar Peer to Peer Lending** 

### **2.1 Definisi dan para pihak** 

P2P lending adalah model pembiayaan di mana dana dari banyak pemilik dana disalurkan langsung kepada pihak yang membutuhkan melalui sebuah platform. Platform tidak menyalurkan dana miliknya sendiri (kecuali sebagai sesama pemodal); fungsinya menyeleksi, mencatat, mengalirkan dana, dan menagih. 

|**Pihak**|**Siapa di KMH**|**Peran**|
|---|---|---|
|Pendana (Syarik<br>Pemodal)|Anggota KMH yang<br>menempatkan dana|Menyetor modal ke syirkah pembiayaan, menerima<br>bagi hasil, menanggung kerugian sesuai porsi modal.|
|Penerima<br>Pembiayaan|Anggota KMH calon peserta<br>magang ke Jepang|Menerima jasa pelatihan & pengurusan<br>keberangkatan, membayar angsuran (pokok + ujrah).|
|Penyelenggara &<br>Pengelola (Syarik<br>Pengelola)|KMH|Menjalankan platform, analisa, akad, pencairan,<br>penagihan; ikut menyetor modal minimal; menerima<br>nisbah pengelola.|
|Mitra Penyalur Jasa|LPK / Sending Organization<br>(SO)|Penerima pencairan biaya pelatihan &<br>keberangkatan; sumber data kemajuan peserta; pihak<br>dalam perjanjian tripartit.|
|Penjamin|Keluarga peserta / SO<br>(sesuai kebijakan)|Menjamin kewajiban peserta jika terjadi wanprestasi.|
|Bank / Payment<br>Gateway|Penyedia VA (diutamakan<br>syariah)|Menyediakan rekening penampung, nomor VA,<br>notifikasi pembayaran, dan transfer keluar.|
|DPS|Dewan Pengawas Syariah<br>KMH|Menetapkan dan mengawasi kesesuaian akad serta<br>pengelolaan Dana Proteksi.|



### **2.2 Perbedaan dengan simpan pinjam koperasi biasa** 

|**Aspek**|**Unit simpan pinjam/pembiayaan**<br>**konvensional koperasi**|**P2P syariah KMH**|
|---|---|---|
|Sumber dana|Kas koperasi (simpanan, modal)|Dana pendana yang dipilih per<br>pembiayaan|
|Pemilik risiko|Koperasi|Para syarik sesuai porsi modal, dengan<br>lapis Dana Proteksi dan buyback|
|Imbal hasil<br>penyimpan|Bagi hasil/jasa simpanan umum|Bagi hasil spesifik per pembiayaan yang<br>didanai|
|Transparansi|Laporan agregat|Pendana melihat status tiap pembiayaan<br>dan arus kasnya|
|Pendapatan KMH|Selisih pendapatan–beban|Nisbah pengelola + bagi hasil atas modal<br>KMH sendiri|



### **2.3 Pelajaran dari referensi Mekar** 

Mekar (PT Mekar Investama Teknologi) adalah platform P2P yang menjangkau usaha mikro melalui kerja sama dengan koperasi, sementara sisi pendananya terdiri atas pendana ritel dan institusi. Pelajaran yang relevan bagi KMH: (1) peran koperasi sebagai pihak yang paling mengenal penerima pembiayaan adalah kekuatan utama dalam seleksi dan penagihan; (2) satu pembiayaan dapat dibiayai banyak pendana sehingga risiko tersebar; (3) transparansi portofolio 

Halaman 5 

KMH – P2P Lending Syariah & Brief Website 

di sisi pendana menjadi kunci kepercayaan. Perbedaannya, KMH menjalankan peran koperasi sekaligus platform, sehingga pemisahan fungsi dan jejak audit harus lebih ketat. 

Halaman 6 

KMH – P2P Lending Syariah & Brief Website 

## **3. Struktur Akad Syariah** 

### **3.1 Mengapa dua lapis akad** 

Musyarakah adalah akad kerja sama di mana para pihak menyetor modal untuk suatu usaha; keuntungan dibagi sesuai nisbah yang disepakati dan kerugian ditanggung sesuai porsi modal. Syaratnya ada **usaha yang menghasilkan keuntungan** . Calon peserta magang tidak menjalankan usaha; penghasilannya berupa upah dari perusahaan di Jepang. Karena itu, menerapkan musyarakah langsung kepada calon pemagang berisiko tidak memenuhi rukun dan menimbulkan gharar dalam perhitungan bagi hasil. 

Struktur yang disarankan: 

|**Lapis**|**Para pihak**|**Akad**|**Objek / sumber hasil**|
|---|---|---|---|
|Lapis 1 –<br>Pendanaan|Pendana + KMH|Musyarakah (syirkah<br>pembiayaan per penerima<br>atau per kelompok/batch)|Modal gabungan disalurkan<br>untuk membiayai jasa<br>keberangkatan; hasil syirkah =<br>ujrah yang diterima dari<br>peserta|
|Lapis 2 –<br>Penyaluran|KMH (atas nama<br>syirkah) + Calon<br>pemagang (+ LPK/SO)|Ijarah Multijasa (jasa<br>pelatihan, pengurusan<br>dokumen dan<br>keberangkatan)|Peserta membayar biaya jasa<br>+ ujrah tetap secara angsuran<br>setelah bekerja|



Dengan struktur ini, pendana tetap berakad Musyarakah sesuai keputusan KMH, sementara hubungan dengan peserta memakai akad yang sesuai dengan sifat kebutuhannya (jasa). Ujrah ditetapkan dalam nominal rupiah di awal akad, bukan persentase berjalan atas sisa pokok. 

**Alternatif bila DPS memilih akad lain di Lapis 2** 

**Qardh + Ujrah atas jasa pengurusan** : pinjaman pokok tanpa tambahan, KMH memungut ujrah atas jasa administrasi/pengurusan yang nyata. Hasil syirkah lebih kecil dan ujrah tidak boleh dikaitkan dengan besar pinjaman. **Murabahah** : hanya cocok untuk komponen berupa barang (mis. tiket pesawat, perlengkapan), bukan jasa pelatihan. 

### **3.2 Ketentuan Musyarakah yang diterapkan di platform** 

|**Ketentuan**|**Penerapan di platform KMH**|
|---|---|
|Modal syirkah|Disetor tunai (via VA) oleh setiap pendana dan KMH. KMH wajib ikut menyetor modal<br>minimal (usulan 10%) sebagai bukti keterlibatan (skin in the game).|
|Nisbah keuntungan|Disepakati di awal dan tercantum di akad digital. Usulan ilustrasi: 70% untuk pendana<br>(dibagi pro-rata modal), 30% untuk KMH sebagai syarik pengelola (termasuk bagian<br>atas modalnya).|
|Kerugian|Ditanggung para syarik sesuai porsi modal, termasuk KMH. KMH menanggung<br>penuh kerugian akibat kelalaian/pelanggaran (ta'addi/taqshir), misalnya tidak<br>menjalankan SOP analisa.|
|Jaminan modal|Pengelola tidak boleh menjamin modal mitranya. Karena itu buyback KMH<br>distrukturkan secara terpisah (Bab 3.4).|
|Pengelolaan|KMH mengelola atas kuasa pendana (wakalah dalam musyarakah); pendana tidak<br>terlibat operasional, tetapi berhak atas laporan.|



Halaman 7 

KMH – P2P Lending Syariah & Brief Website 

|**Ketentuan**|**Penerapan di platform KMH**|
|---|---|
|Pembagian hasil|Hanya dari pendapatan yang benar-benar diterima (cash basis). Jika peserta<br>terlambat, bagi hasil ikut tertunda.|
|Berakhirnya syirkah|Saat seluruh kewajiban peserta lunas, atau saat piutang dialihkan (buyback) /<br>dihapus setelah proses penanganan selesai.|



### **3.3 Rujukan fatwa DSN-MUI** 

- Fatwa No. 08/DSN-MUI/IV/2000 tentang Pembiayaan Musyarakah. 

- Fatwa No. 44/DSN-MUI/VIII/2004 tentang Pembiayaan Multijasa. 

- Fatwa No. 117/DSN-MUI/II/2018 tentang Layanan Pembiayaan Berbasis Teknologi Informasi Berdasarkan Prinsip Syariah. 

DPS KMH perlu menelaah teks fatwa tersebut dan menuangkannya dalam opini syariah tertulis sebelum platform beroperasi. 

### **3.4 Titik kritis: Dana Proteksi dan buyback KMH** 

Keputusan KMH menyediakan **Dana Proteksi dan buyback** sangat baik untuk kepercayaan pendana, tetapi harus dirancang agar tidak berubah menjadi jaminan pengembalian modal oleh pengelola, yang tidak sesuai prinsip musyarakah. 

|**Komponen**|**Struktur yang disarankan**|**Yang harus dihindari**|
|---|---|---|
|Dana Proteksi|Dana tabarru' (hibah kolektif) yang dihimpun dari porsi<br>tertentu hasil syirkah (usulan 10% dari ujrah) dan dapat<br>ditambah kontribusi KMH.<br>Disimpan di rekening terpisah, dicatat di ledger tersendiri,<br>penggunaannya diputus komite dan diawasi DPS.<br>Manfaatnya sebatas saldo yang tersedia; tidak dijanjikan<br>menutup 100%.|Menyebut Dana Proteksi<br>sebagai “garansi” atau<br>menjanjikan imbal hasil<br>pasti.|
|Buyback KMH|Janji sepihak (wa'd) KMH untuk mengambil alih porsi<br>pendana atas pembiayaan bermasalah pada nilai pokok<br>tersisa (tanpa bagi hasil yang belum terealisasi).<br>Dieksekusi sebagai pengalihan piutang; setelah itu hak tagih<br>menjadi milik KMH.<br>Dibiayai dari dana KMH di luar syirkah, dicatat sebagai<br>transaksi terpisah dari peran pengelola.|Buyback yang menjamin<br>pokok plus imbal hasil, atau<br>buyback yang dibebankan<br>ke modal syirkah.|
|Kelalaian KMH|Bila terbukti lalai (mis. pencairan tanpa verifikasi kontrak),<br>KMH wajib mengganti tanpa menunggu lapis lain.|Mencampur kasus kelalaian<br>dengan kasus risiko usaha<br>biasa.|



##### **Urutan penanganan kerugian (waterfall)** 

**1.** Penagihan kepada peserta (termasuk lewat SO/kumiai) dan restrukturisasi bila masih mampu bayar. 

**2.** Klaim kepada penjamin dan pencairan agunan (bila ada). 

**3.** Dana Proteksi, sesuai batas kebijakan (usulan: maks. 50% sisa pokok per kasus, dan sebatas saldo). 

**4.** Buyback KMH atas porsi pendana dari sisa pokok yang belum tertutup. 

**5.** Jika buyback tidak dapat dilaksanakan, sisa kerugian ditanggung para syarik sesuai porsi modal. 

Halaman 8 

KMH – P2P Lending Syariah & Brief Website 

## **4. Mekanisme Operasional Tahap demi Tahap** 

Tabel berikut adalah alur lengkap dari pendaftaran sampai pelunasan. Kolom terakhir menunjukkan apa yang harus dilakukan sistem, sebagai jembatan ke brief website. 

|**#**|**Tahap**|**Aktor**|**Aktivitas**|**Output sistem**|
|---|---|---|---|---|
|1|Registrasi &<br>verifikasi<br>anggota|Anggota,<br>Admin|Daftar dengan nomor anggota; unggah<br>KTP, KK, swafoto; dicocokkan dengan<br>buku induk anggota.|Akun aktif dengan peran<br>Pendana dan/atau Penerima;<br>status verifikasi.|
|2|Aktivasi<br>pendana|Pendana|Membaca dan menyetujui akad induk<br>Musyarakah, profil risiko, rekening<br>tujuan penarikan.|Nomor VA top-up pribadi;<br>dompet virtual saldo 0.|
|3|Top-up dana|Pendana,<br>Bank|Transfer ke VA pribadi.|Webhook VA → saldo dompet<br>bertambah; jurnal tercatat.|
|4|Pengajuan<br>pembiayaan|Calon<br>pemagang<br>(didampingi<br>LPK/SO)|Mengisi data, rincian biaya per<br>komponen (pelatihan, MCU, dokumen,<br>visa, tiket), jadwal keberangkatan,<br>penjamin.|Berkas pengajuan status<br>SUBMITTED.|
|5|Verifikasi &<br>analisa|Analis KMH|Verifikasi dokumen, status<br>keanggotaan, kemajuan pelatihan,<br>kontrak/penerimaan dari perusahaan<br>Jepang, kapasitas bayar dari gaji,<br>penilaian 5C.|Skor & grade risiko; usulan<br>plafon, ujrah, tenor, masa<br>tenggang.|
|6|Persetujuan<br>komite|Komite<br>Pembiayaan|Memutus setuju/tolak/ubah struktur.|Status APPROVED;<br>parameter terkunci.|
|7|Listing|Sistem|Pembiayaan tampil di marketplace<br>dengan data peserta disamarkan.|Halaman listing; batas waktu<br>penggalangan (mis. 7 hari).|
|8|Pendanaan|Pendana,<br>KMH|Pendana memilih dan menyetor porsi<br>dari saldo; KMH menyetor porsi modal<br>minimal.|Dana terkunci (hold) per<br>porsi; progres pendanaan.|
|9|Penuh atau<br>batal|Sistem|Jika 100% terpenuhi → lanjut. Jika<br>tidak tercapai sampai batas waktu →<br>dana dibuka kembali ke saldo.|Status FUNDED atau<br>EXPIRED + pembukaan hold<br>otomatis.|
|10|Akad|Peserta,<br>Penjamin,<br>LPK/SO,<br>KMH|Tanda tangan elektronik akad Ijarah<br>Multijasa dan perjanjian tripartit; akad<br>syirkah antar pendana terbentuk.|Dokumen akad PDF + hash;<br>status AKAD_SIGNED.|
|11|Pencairan<br>bertahap|Finance<br>(maker),<br>Manajer<br>(checker)|Dana dibayarkan langsung ke<br>LPK/vendor sesuai tahapan, bukan<br>tunai ke peserta.|Jadwal pencairan; bukti<br>transfer; status DISBURSED.|
|12|Masa<br>tenggang|Sistem,<br>Analis|Pemantauan kelulusan, visa,<br>keberangkatan, kedatangan di Jepang.|Status GRACE; tanggal mulai<br>angsuran ditetapkan.|
|13|Angsuran|Peserta (dari<br>Jepang/kelu<br>arga)|Membayar ke VA pembiayaan setiap<br>bulan.|Webhook → alokasi<br>pokok/ujrah → distribusi<br>otomatis ke dompet pendana,<br>KMH, Dana Proteksi.|
|14|Pemantauan<br>& penagihan|Collection,<br>SO/kumiai|Pengingat H-3, H, H+1; eskalasi<br>berdasarkan DPD; restrukturisasi bila<br>perlu.|Bucket DPD; tugas<br>penagihan; notifikasi<br>WA/email.|
|15|Penanganan<br>kerugian|Komite, DPS|Menjalankan waterfall (Bab 3.4).|Klaim Dana Proteksi /<br>buyback / pembebanan<br>kerugian tercatat.|



Halaman 9 

KMH – P2P Lending Syariah & Brief Website 

|**#**|**Tahap**|**Aktor**|**Aktivitas**|**Output sistem**|
|---|---|---|---|---|
|16|Pelunasan &<br>penarikan|Sistem,<br>Pendana|Syirkah berakhir; pendana dapat<br>menarik saldo ke rekening atau|Status LUNAS; laporan akhir<br>per pendana; permintaan|
||||menempatkan ulang.|penarikan.|



### **4.1 Kekhususan segmen calon pemagang Jepang** 

- **Risiko sebelum berangkat** adalah risiko terbesar (tidak lulus, visa ditolak, mengundurkan diri). Mitigasi: pencairan bertahap mengikuti tahapan, perjanjian pengembalian biaya dari LPK/SO atas komponen yang belum terpakai, dan penjamin. 

- **Masa tenggang** disesuaikan dengan jadwal keberangkatan; angsuran dimulai setelah peserta menerima gaji di Jepang. 

- **Saluran bayar** dari Jepang: transfer remitansi ke VA, atau keluarga di Indonesia membayar ke VA. Website menampilkan nomor VA dan nominal angsuran yang jelas. 

- **Kerja sama SO/kumiai** untuk informasi status kerja dan kontak peserta bila terjadi tunggakan. 

- Perhatikan transisi program magang Jepang ke skema baru (Ikusei Shuro) yang dijadwalkan berlaku mulai 2027; parameter tenor dan kebijakan pindah kerja perlu ditinjau ulang saat aturan teknisnya terbit. 

Halaman 10 

KMH – P2P Lending Syariah & Brief Website 

## **5. Simulasi Angka** 

### **5.1 Asumsi** 

|**Parameter**|**Nilai ilustrasi**|
|---|---|
|Biaya jasa keberangkatan yang dibiayai (pokok)|Rp30.000.000|
|Ujrah (ditetapkan nominal di akad)|Rp5.400.000|
|Total kewajiban peserta|Rp35.400.000|
|Masa tenggang|4 bulan (pelatihan sampai menerima gaji<br>pertama)|
|Jumlah angsuran|12 kali × Rp2.950.000 (pokok Rp2.500.000 +<br>ujrah Rp450.000)|
|Porsi ke Dana Proteksi|10% dari ujrah yang diterima|
|Nisbah syirkah (atas ujrah bersih)|Pendana 70% : KMH 30%|
|Modal KMH|10% dari pokok|



### **5.2 Struktur modal syirkah** 

|**Syarik**|**Modal (Rp)**|**Porsi total**<br>**Porsi d**|**i antara pendana**|
|---|---|---|---|
|Pendana A|13.500.000|45%|50,00%|
|Pendana B|7.500.000|25%|27,78%|
|Pendana C|6.000.000|20%|22,22%|
|KMH|3.000.000|10%|–|
|**Total**|**30.000.000**|**100%**|**100%**|



### **5.3 Alokasi setiap angsuran Rp2.950.000** 

|**Komponen**|**Dasar perhitungan**|**Nominal (Rp)**|
|---|---|---|
|Pengembalian pokok|30.000.000 ÷ 12|2.500.000|
|Ujrah diterima|5.400.000 ÷ 12|450.000|
|→ Dana Proteksi|10% × 450.000|45.000|
|→ Hasil bersih syirkah|450.000 − 45.000|405.000|
|→ Bagian pendana (70%)|70% × 405.000|283.500|
|→ Bagian KMH (30%)|30% × 405.000|121.500|



### **5.4 Distribusi bulanan ke setiap syarik** 

|**Penerima**|**Pokok (porsi modal)**|**Bagi hasil**<br>**Tota**|**l per bulan**|
|---|---|---|---|
|Pendana A|1.125.000|141.750|1.266.750|
|Pendana B|625.000|78.750|703.750|
|Pendana C|500.000|63.000|563.000|
|KMH|250.000|121.500|371.500|



Halaman 11 

KMH – P2P Lending Syariah & Brief Website 

|**Penerima**|**Pokok (porsi modal)**|**Bagi hasil**||**Total per bulan**|
|---|---|---|---|---|
|Dana Proteksi|–||45.000|45.000|
|**Total**|**2.500.000**||**450.000**|**2.950.000**|



### **5.5 Rekap hasil bila lancar sampai lunas** 

|**Syarik**|**Modal**|**Total di**<br>**bln)**|**terima (12**|**Bagi hasil**|**Hasil atas modal**|
|---|---|---|---|---|---|
|Pendana A|13.500.000||15.201.000|1.701.000|12,6%|
|Pendana B|7.500.000||8.445.000|945.000|12,6%|
|Pendana C|6.000.000||6.756.000|756.000|12,6%|
|KMH|3.000.000||4.458.000|1.458.000|48,6% (termasuk hak<br>pengelola)|
|Dana Proteksi|–||540.000|540.000|–|



Hasil 12,6% bagi pendana diperoleh selama 16 bulan (4 bulan tenggang + 12 bulan angsuran), atau setara sekitar 9,5% per tahun secara sederhana (12,6% ÷ 16 × 12). Angka ini **tidak dijamin** ; yang diterima pendana bergantung pada pembayaran nyata peserta. 

### **5.6 Skenario gagal bayar** 

Peserta membayar 4 angsuran lalu berhenti membayar. Sisa pokok Rp20.000.000. Bagi hasil yang telah diterima tetap menjadi hak syarik; ujrah yang belum dibayar tidak dibagikan. 

|**Lapis**|**Keterangan**|**Dana pulih (Rp)**|**Sisa pokok (Rp)**|
|---|---|---|---|
|Awal|Sisa pokok saat macet|–|20.000.000|
|1–2. Penagihan &<br>penjamin|Asumsi berhasil ditagih dari penjamin|5.000.000|15.000.000|
|3. Dana Proteksi|Maks. 50% sisa pokok|7.500.000|7.500.000|
|4a. Bagian KMH sendiri|10% × 7.500.000 ditanggung KMH<br>sebagai syarik|–|6.750.000|
|4b. Buyback KMH|Mengambil alih porsi pendana 90% ×<br>7.500.000|6.750.000|0|



|**Pendana**|**Porsi sisa pokok**|**Dengan buyback**|**Tanpa buyback (rugi)**|
|---|---|---|---|
|A (50% dari pendana)|9.000.000|Kembali penuh 9.000.000|Rugi 3.375.000|
|B (27,78%)|5.000.000|Kembali penuh 5.000.000|Rugi 1.875.000|
|C (22,22%)|4.000.000|Kembali penuh 4.000.000|Rugi 1.500.000|



Setelah buyback, hak tagih atas Rp6.750.000 menjadi milik KMH; hasil penagihan berikutnya menjadi hak KMH. Skenario ini menunjukkan bahwa kapasitas buyback harus dibatasi dan dicadangkan: website perlu menampilkan rasio kecukupan Dana Proteksi dan cadangan buyback terhadap total pembiayaan berjalan. 

Halaman 12 

KMH – P2P Lending Syariah & Brief Website 

## **6. Manajemen Risiko** 

|**Risiko**|**Dampak**|**Mitigasi**|**Fitur website pendukung**|
|---|---|---|---|
|Gagal berangkat<br>(tidak lulus, visa<br>ditolak, mundur)|Biaya terpakai<br>tanpa sumber<br>bayar|Pencairan bertahap; klausul<br>pengembalian dari LPK/SO;<br>penjamin|Jadwal pencairan per tahap;<br>checklist milestone|
|Pulang dini / pindah<br>kerja di Jepang|Arus angsuran<br>terhenti|Kerja sama SO/kumiai; data<br>kontak darurat; restrukturisasi|Modul collection &<br>restrukturisasi|
|Gaji lebih rendah /<br>pergerakan kurs JPY|Angsuran terasa<br>berat|Analisa kapasitas bayar<br>konservatif (mis. angsuran ≤ 30%<br>gaji bersih dalam rupiah)|Kalkulator kapasitas bayar di<br>modul analisa|
|Konsentrasi pada<br>satu LPK/SO|Kerugian berantai|Batas eksposur per LPK/SO|Dashboard eksposur & alert<br>batas|
|Dokumen palsu|Pembiayaan fiktif|Verifikasi ke sumber kontrak;<br>kunjungan; foto & geotag|Unggah dokumen, status<br>verifikasi, audit log|
|Konflik kepentingan<br>KMH|Hilangnya<br>kepercayaan<br>pendana|Maker-checker; komite; laporan<br>terbuka|Hak akses berbasis peran;<br>audit trail tak dapat diubah|
|Likuiditas pendana|Dana terkunci<br>sampai lunas|Penjelasan di awal; fase lanjut:<br>pengalihan porsi antar anggota|Halaman edukasi; modul<br>pengalihan porsi (fase 3)|
|Ketidaksesuaian<br>syariah|Pendapatan tidak<br>halal, reputasi|Opini DPS; audit syariah berkala|Template akad terkunci;<br>laporan DPS|
|Gangguan sistem/VA|Pembayaran<br>tidak tercatat|Rekonsiliasi harian; idempotensi<br>webhook|Modul rekonsiliasi & laporan<br>selisih|



Halaman 13 

KMH – P2P Lending Syariah & Brief Website 

## **7. Tata Kelola dan Kebijakan Pokok** 

|**Kebijakan**|**Usulan awal**|
|---|---|
|Minimum pendanaan per porsi|Rp1.000.000, kelipatan Rp500.000|
|Maksimum porsi satu pendana per<br>pembiayaan|50% dari plafon (agar risiko tersebar)|
|Modal KMH per pembiayaan|Minimal 10%|
|Plafon per peserta|Sebesar rincian biaya resmi LPK/SO yang terverifikasi|
|Batas waktu penggalangan|7 hari; diperpanjang sekali oleh admin|
|Persetujuan pembiayaan|Analis mengusulkan, komite memutus (minimal 2 orang)|
|Pencairan|Maker (finance) + checker (manajer); tujuan hanya rekening<br>LPK/vendor terdaftar|
|Rekening|Rekening penampung dana pendana terpisah dari rekening<br>operasional KMH; diutamakan bank syariah|
|Laporan|Pendana: laporan bulanan otomatis; Pengurus: dashboard<br>harian; DPS: laporan semesteran|
|Klasifikasi tunggakan (DPD)|Lancar 0; Perhatian 1–30; Kurang lancar 31–60; Diragukan 61–<br>90; Macet > 90 hari|



Halaman 14 

KMH – P2P Lending Syariah & Brief Website 

## **8. Brief Pengembangan Website** 

### **8.1 Tujuan** 

- Menyediakan portal bagi anggota untuk mendanai dan mengajukan pembiayaan secara transparan. 

- Mengotomasi pencatatan, distribusi bagi hasil, dan rekonsiliasi VA sehingga tidak ada perhitungan manual. 

- Menjadi sumber data tunggal untuk analisa kualitas portofolio (NPL/DPD) dan laporan kepada Pengurus, Pengawas, dan DPS. 

### **8.2 Peran pengguna** 

|**Peran**|**Hak akses utama**|
|---|---|
|Pendana|Top-up, melihat listing, mendanai, melihat portofolio & mutasi, menarik saldo, unduh<br>akad & laporan|
|Penerima|Mengajukan pembiayaan, unggah dokumen, tanda tangan akad, melihat jadwal & VA<br>angsuran, riwayat bayar|
|Mitra LPK/SO|Mengusulkan peserta, memperbarui milestone (lulus, visa, berangkat), melihat status<br>pencairan|
|Analis|Verifikasi, scoring, usulan struktur|
|Komite|Memutus pengajuan, memutus klaim Dana Proteksi/buyback|
|Finance|Pencairan (maker), rekonsiliasi, penarikan dana pendana|
|Manajer|Checker pencairan & penarikan; persetujuan restrukturisasi|
|Collection|Daftar tunggakan, catatan penagihan, janji bayar|
|DPS / Pengawas|Akses baca laporan, akad, dan penggunaan Dana Proteksi|
|Super Admin|Pengaturan parameter, pengguna, dan template akad|



### **8.3 Modul dan prioritas** 

|**Modul**|**Fitur utama**|**Prioritas**|
|---|---|---|
|Onboarding & verifikasi|Registrasi nomor anggota, unggah KTP/KK/swafoto, OTP,<br>verifikasi admin|MVP|
|Dompet & ledger|Saldo tersedia/terkunci, mutasi, ledger double-entry|MVP|
|Integrasi VA|VA top-up per pendana, VA angsuran per pembiayaan,<br>webhook, rekonsiliasi|MVP|
|Pengajuan & analisa|Formulir per komponen biaya, scoring 5C, kalkulator kapasitas<br>bayar, catatan analis|MVP|
|Komite|Antrian keputusan, voting/persetujuan, berita acara|MVP|
|Marketplace|Listing tersamarkan, filter grade/tenor, progres pendanaan,<br>timer|MVP|
|Akad digital|Template akad terkunci, tanda tangan elektronik, PDF + hash|MVP|
|Pencairan|Jadwal bertahap ke LPK/vendor, maker-checker, bukti transfer|MVP|
|Angsuran & distribusi|Jadwal, alokasi, distribusi otomatis, Dana Proteksi|MVP|
|Notifikasi|Email & WhatsApp: tagihan, pembayaran diterima, distribusi,|MVP|



Halaman 15 

KMH – P2P Lending Syariah & Brief Website 

|**Modul**|**Fitur utama**|**Prioritas**|
|---|---|---|
||listing baru||
|Collection &<br>restrukturisasi|Bucket DPD, tugas penagihan, janji bayar, perubahan jadwal|Fase 2|
|Dana Proteksi &<br>buyback|Klaim, persetujuan, pencatatan pengalihan piutang|Fase 2|
|Portal mitra LPK/SO|Usulan peserta, update milestone|Fase 2|
|Dashboard & laporan|Portofolio, NPL/DPD, arus kas, kecukupan Dana Proteksi,<br>laporan pendana PDF|MVP (dasar) /<br>Fase 2 (lengkap)|
|Auto-reinvest &<br>pengalihan porsi|Penempatan ulang otomatis; jual-beli porsi antar anggota|Fase 3|
|Aplikasi mobile|PWA atau aplikasi native|Fase 3|



### **8.4 Halaman utama per portal** 

#### **Portal Pendana** 

- Beranda: total dana ditempatkan, saldo tersedia, bagi hasil diterima bulan ini, jumlah pembiayaan aktif per status DPD. 

- Marketplace: kartu pembiayaan (kode, grade, plafon, tenor, masa tenggang, nisbah, estimasi hasil, progres %, sisa waktu). 

- Detail pembiayaan: profil tersamarkan (inisial, usia, asal daerah, bidang kerja di Jepang, LPK/SO), rincian biaya, jadwal, risiko. 

- Portofolio, mutasi dompet, top-up (menampilkan nomor VA), penarikan, dokumen & laporan. 

#### **Portal Penerima** 

- Pengajuan bertahap (wizard), status pengajuan, tanda tangan akad, jadwal angsuran, VA dan nominal tagihan, riwayat pembayaran. 

#### **Back-office** 

- Antrian verifikasi, analisa, komite, pencairan, rekonsiliasi VA, collection, Dana Proteksi, parameter, pengguna, audit log, laporan. 

### **8.5 Alur dana via Virtual Account** 

1. Pendana transfer ke **VA top-up** pribadi → bank/payment gateway mengirim notifikasi (webhook) → sistem memverifikasi tanda tangan dan mencatat saldo. 

2. Saat mendanai, saldo pendana dipindah dari **tersedia** ke **terkunci** (tidak ada uang keluar dari rekening penampung). 

3. Saat pembiayaan penuh dan akad ditandatangani, sistem membuat **instruksi pencairan** ke rekening LPK/vendor; setelah checker menyetujui, transfer keluar via API payout atau manual dengan bukti. 

4. Peserta membayar ke **VA angsuran** milik pembiayaan → webhook → sistem mengalokasikan pokok dan ujrah lalu mendistribusikan ke dompet setiap syarik dan Dana Proteksi. 

Halaman 16 

KMH – P2P Lending Syariah & Brief Website 

5. Pendana menarik saldo tersedia ke rekening terdaftar atas namanya sendiri (makerchecker). 

6. Setiap hari sistem mencocokkan transaksi internal dengan laporan mutasi/settlement dari penyedia VA. 

Pilihan penyedia VA: (a) VA langsung dari bank syariah tempat rekening penampung KMH, atau (b) payment gateway yang menyediakan VA multi-bank dan API transfer. Ketersediaan fitur (VA statis/dinamis, payout API, dukungan rekening syariah) dan biayanya perlu dikonfirmasi langsung ke calon penyedia sebelum memilih. 

### **8.6 Kebutuhan non-fungsional** 

|**Aspek**|**Kebutuhan**|
|---|---|
|Keamanan|HTTPS, 2FA untuk transaksi & back-office, enkripsi data pribadi saat disimpan, hak<br>akses berbasis peran, batas percobaan login, verifikasi tanda tangan webhook|
|Integritas data|Ledger append-only (tidak ada edit/hapus; koreksi lewat jurnal balik), transaksi<br>database atomik, idempotency key|
|Audit|Setiap aksi tercatat: siapa, kapan, sebelum/sesudah, alamat IP|
|Ketersediaan|Target uptime 99,5%; backup database harian + uji restore bulanan|
|Kinerja|Halaman utama < 2 detik; webhook diproses < 5 detik|
|Privasi|Data peserta disamarkan di marketplace; dokumen hanya untuk peran berwenang|
|Usability|Responsif untuk ponsel; bahasa Indonesia; istilah syariah dijelaskan|



### **8.7 Roadmap** 

|**Fase**|**Durasi**<br>**indikatif**|**Lingkup**|**Kriteria selesai**|
|---|---|---|---|
|0. Persiapan|2–3 minggu|Opini DPS, template akad, SOP,<br>pemilihan penyedia VA, desain UI|Akad & SOP disetujui; akun<br>sandbox VA tersedia|
|1. MVP|10–14 minggu|Modul berlabel MVP|Uji end-to-end di sandbox<br>lulus; uji coba internal|
|2. Pilot|2–3 bulan|5–10 pembiayaan dengan pendana<br>terbatas; tambah collection, Dana<br>Proteksi, portal LPK|Rekonsiliasi tanpa selisih 30<br>hari berturut-turut|
|3.<br>Pengembanga<br>n|Berkelanjutan|Auto-reinvest, pengalihan porsi, aplikasi<br>mobile, analitik lanjutan|Sesuai KPI|



### **8.8 Tim pengembang yang dibutuhkan** 

- Product owner dari KMH (memutus prioritas dan aturan bisnis). 

- 1 backend developer senior (ledger, VA, keamanan), 1 frontend developer, 1 UI/UX designer paruh waktu, 1 QA/tester. 

- DevOps paruh waktu untuk server, backup, dan monitoring. 

Halaman 17 

KMH – P2P Lending Syariah & Brief Website 

### **8.9 KPI platform** 

- Waktu proses pengajuan sampai listing; tingkat pendanaan penuh (fully funded rate); waktu rata-rata pendanaan. 

- Rasio DPD > 30 dan NPL; tingkat pemulihan; kecukupan Dana Proteksi terhadap outstanding. 

- Selisih rekonsiliasi (target 0); jumlah pendana aktif dan tingkat penempatan ulang. 

Halaman 18 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran A – Arsitektur Teknis** 

|**Lapisan**|**Rekomendasi**|**Catatan**|
|---|---|---|
|Frontend|Next.js (React) + Tailwind; PWA|Satu basis kode untuk portal pendana, penerima,<br>mitra, dan back-office (dipisah per rute & peran)|
|Backend API|Laravel 11 (PHP) atau NestJS<br>(Node.js)|Pilih yang paling dikuasai tim; keduanya matang<br>untuk REST API, antrian, dan otorisasi|
|Database|PostgreSQL 15+|Transaksi ACID, constraint kuat, cocok untuk<br>ledger|
|Antrian & cache|Redis|Pemrosesan webhook, distribusi, notifikasi, job<br>terjadwal|
|Penyimpanan<br>dokumen|Object storage kompatibel S3<br>(terenkripsi)|KTP, kontrak, akad; akses via signed URL<br>berumur pendek|
|Integrasi|API VA/payout, WhatsApp Business<br>API, email (SMTP/API), e-signature|Dibungkus dalam adapter agar penyedia dapat<br>diganti|
|Akuntansi|Sinkronisasi jurnal harian ke ERPNext<br>(bila dipakai KMH)|Platform tetap memegang sub-ledger; ERPNext<br>menerima jurnal ringkasan per akun|
|Infrastruktur|Cloud (mis. region Jakarta) + Docker;<br>staging & production terpisah|Monitoring, log terpusat, alert|



### **A.1 Komponen layanan** 

- **Auth & User Service** : registrasi, OTP, 2FA, peran. 

- **Member Service** : data anggota, KYC, rekening tujuan. 

- **Financing Service** : pengajuan, scoring, komite, listing, akad, jadwal. 

- **Ledger Service** : satu-satunya komponen yang boleh mengubah saldo; menulis jurnal double-entry. 

- **Payment Service** : pembuatan VA, penerimaan webhook, payout, rekonsiliasi. 

- **Distribution Engine** : alokasi angsuran dan pembagian hasil. 

- **Collection Service** , **Notification Service** , **Reporting Service** , **Audit Service** . 

Halaman 19 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran B – Model Data Inti** 

|**Tabel**<br>members|**Kolom kunci**<br>id, member_no, name, nik_enc, phone, email, roles[],<br>kyc_status, bank_account_enc|**Keterangan**<br>Data sensitif terenkripsi|
|---|---|---|
|partners|id, type (LPK/SO/vendor), name, bank_account_enc,<br>exposure_limit|Tujuan pencairan|
|wallets|id, owner_type (member/KMH/protection/escrow),<br>owner_id|Saldo dihitung dari ledger,<br>bukan kolom yang diedit|
|accounts|id, wallet_id, kind (available/locked), currency|Sub-akun per dompet|
|journal_entries|id, ref_type, ref_id, description, created_at, created_by|Header jurnal|
|ledger_lines|id, journal_id, account_id, debit, credit|Total debit = total kredit per<br>jurnal (constraint)|
|financings|id, code, member_id, partner_id, principal, ujrah, tenor,<br>grace_months, grade, nisbah_investor, nisbah_kmh,<br>protection_pct, status, listing_deadline|Inti pembiayaan|
|financing_costs|id, financing_id, component, amount, partner_id|Rincian biaya per komponen|
|fundings|id, financing_id, investor_id (member/KMH), amount,<br>share_pct, status|Porsi modal syirkah|
|schedules|id, financing_id, seq, due_date, principal_due,<br>ujrah_due, paid_principal, paid_ujrah, status|Jadwal angsuran|
|disbursements|id, financing_id, partner_id, stage, amount, status,<br>maker_id, checker_id, proof_url|Pencairan bertahap|
|virtual_accounts|id, owner_type, owner_id, va_number, bank,<br>provider_ref, active|VA top-up / angsuran|
|payment_events|id, provider, external_id (unique), va_number, amount,<br>paid_at, raw_payload, signature_ok, processed_at|Idempotensi webhook|
|distributions|id, payment_event_id, schedule_id, recipient_wallet_id,<br>principal, profit|Rincian pembagian|
|protection_claims|id, financing_id, amount, approved_by, status|Klaim Dana Proteksi|
|buybacks|id, financing_id, investor_id, principal_amount,<br>executed_at, approved_by|Pengalihan porsi ke KMH|
|collections|id, financing_id, dpd, action, note, promise_date,<br>officer_id|Riwayat penagihan|
|contracts|id, financing_id, type, file_url, sha256, signed_at,<br>signers[]|Akad digital|
|audit_logs|id, actor_id, action, entity, entity_id, before, after, ip,<br>created_at|Append-only|



Halaman 20 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran C – Status Pembiayaan (State Machine)** 

|**Status**|**Arti**|**Transisi berikutnya**|
|---|---|---|
|DRAFT|Diisi peserta, belum dikirim|SUBMITTED|
|SUBMITTED|Menunggu verifikasi|VERIFIED, REJECTED|
|VERIFIED|Dokumen valid, siap dianalisa|ANALYZED|
|ANALYZED|Skor & struktur diusulkan|APPROVED, REJECTED,<br>(kembali) VERIFIED|
|APPROVED|Disetujui komite|LISTED|
|LISTED|Tampil di marketplace|FUNDED, EXPIRED|
|EXPIRED|Tidak terdanai penuh; hold dibuka|LISTED (relisting) / CLOSED|
|FUNDED|Terdanai 100%|AKAD_SIGNED, CANCELLED|
|AKAD_SIGNED|Akad lengkap ditandatangani|DISBURSING|
|DISBURSING|Pencairan bertahap berjalan|GRACE,<br>FAILED_DEPARTURE|
|FAILED_DEPARTUR<br>E|Gagal berangkat; proses refund LPK & penjamin|REPAYING (restruktur),<br>LOSS_HANDLING|
|GRACE|Menunggu angsuran pertama|REPAYING|
|REPAYING|Angsuran berjalan (bucket DPD dihitung harian)|PAID_OFF,<br>RESTRUCTURED,<br>LOSS_HANDLING|
|RESTRUCTURED|Jadwal diubah dengan persetujuan|REPAYING|
|LOSS_HANDLING|Waterfall: penjamin → Dana Proteksi → buyback|CLOSED_BUYBACK,<br>CLOSED_LOSS|
|PAID_OFF|Lunas; syirkah berakhir|–|



Halaman 21 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran D – Ledger dan Contoh Jurnal** 

Prinsip: setiap perpindahan nilai adalah satu jurnal yang seimbang. Saldo dompet = jumlah baris ledger pada akunnya. Akun utama: 

|**Kode**|**Akun**|**Sifat**|
|---|---|---|
|1100|Kas Rekening Penampung (cermin saldo bank)|Aset|
|1200|Piutang Pembiayaan – Pokok (per pembiayaan)|Aset syirkah|
|2100|Dompet Pendana – Tersedia (per anggota)|Kewajiban kepada anggota|
|2110|Dompet Pendana – Terkunci (per anggota)|Kewajiban kepada anggota|
|2200|Dana Proteksi (tabarru')|Dana titipan terpisah|
|2300|Dompet KMH (modal & bagi hasil)|Hak KMH|
|2400|Utang Pencairan ke LPK/Vendor|Kewajiban|
|4100|Pendapatan Ujrah Syirkah (per pembiayaan)|Pendapatan syirkah|



|**Peristiwa**|**Debit**|**Kredit**|**Nominal**<br>**(contoh)**|
|---|---|---|---|
|Top-up Pendana A via VA|1100 Kas Penampung|2100 Dompet A – Tersedia|13.500.000|
|A mendanai pembiayaan|2100 Dompet A –<br>Tersedia|2110 Dompet A – Terkunci|13.500.000|
|Pembiayaan disalurkan<br>(setelah akad)|2110 Terkunci (semua<br>syarik)|2400 Utang Pencairan|30.000.000|
||1200 Piutang Pokok|(pengakuan aset syirkah)|30.000.000*|
|Transfer ke LPK|2400 Utang Pencairan|1100 Kas Penampung|30.000.000|
|Angsuran diterima|1100 Kas Penampung|1200 Piutang Pokok + 4100<br>Ujrah|2.500.000 +<br>450.000|
|Distribusi|4100 Ujrah +<br>(pengembalian pokok)|2100 Dompet A/B/C, 2300<br>KMH, 2200 Dana Proteksi|sesuai tabel<br>5.4|
|Penarikan A|2100 Dompet A –<br>Tersedia|1100 Kas Penampung|sesuai<br>permintaan|



_*Developer dan akuntan KMH perlu menyepakati perlakuan akuntansi syirkah (apakah piutang dicatat sebagai aset para syarik secara off-balance KMH atau on-balance). Platform cukup menyediakan sub-ledger yang konsisten; laporan keuangan KMH mengikuti kebijakan akuntansi koperasi syariah yang dipakai._ 

Halaman 22 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran E – Integrasi Virtual Account** 

### **E.1 Skema penomoran VA** 

- VA top-up pendana: statis, satu per anggota, berlaku selamanya (open amount). 

- VA angsuran: statis per pembiayaan (open amount) agar peserta dari Jepang/keluarga cukup menyimpan satu nomor; alokasi dilakukan sistem. 

- Format mengikuti aturan penyedia (prefix perusahaan + kode jenis + ID internal). 

### **E.2 Penanganan webhook** 

1. Terima POST dari penyedia; **verifikasi tanda tangan/token** dan whitelist IP sesuai dokumentasi penyedia. 

2. Simpan payload mentah ke payment_events dengan **external_id unik** ; jika sudah ada, balas sukses tanpa memproses ulang (idempotensi). 

3. Balas HTTP 200 secepatnya; proses alokasi di job antrian. 

4. Job: cari pemilik VA → jika VA top-up, tambah saldo; jika VA angsuran, jalankan Distribution Engine. 

5. Kirim notifikasi ke pembayar dan penerima distribusi. 

6. Kegagalan job dicoba ulang otomatis; setelah batas, masuk antrian investigasi finance. 

### **E.3 Rekonsiliasi harian** 

- Tarik laporan transaksi/settlement penyedia untuk tanggal T-1, cocokkan dengan payment_events dan jurnal 1100. 

- Hasil: cocok, ada di bank tapi tidak di sistem (webhook hilang), ada di sistem tapi tidak di bank (anomali). Dua kategori terakhir memunculkan tiket ke finance. 

- Saldo akun 1100 harus sama dengan saldo rekening penampung pada akhir hari. 

Halaman 23 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran F – Daftar Endpoint API (ringkas)** 

|**Method**|**Endpoint**|**Peran**|**Fungsi**|
|---|---|---|---|
|POST|/auth/register, /auth/login, /auth/otp/verify|Publik|Registrasi & masuk|
|GET|/me/wallet, /me/wallet/mutations|Pendana|Saldo & mutasi|
|GET|/me/va/topup|Pendana|Nomor VA top-up|
|POST|/withdrawals|Pendana|Permintaan penarikan|
|GET|/marketplace, /marketplace/{code}|Pendana|Listing & detail|
|POST|/financings/{id}/fundings|Pendana, KMH|Menempatkan porsi<br>(idempotency key wajib)|
|GET|/me/portfolio|Pendana|Portofolio & proyeksi|
|POST|/applications, PUT /applications/{id}|Penerima, LPK|Pengajuan|
|POST|/applications/{id}/documents|Penerima, LPK|Unggah dokumen|
|POST|/backoffice/applications/{id}/verify | analyze|Analis|Verifikasi & analisa|
|POST|/backoffice/financings/{id}/decision|Komite|Setuju/tolak|
|POST|/financings/{id}/contracts/sign|Penerima,<br>Penjamin, KMH|Tanda tangan akad|
|POST|/backoffice/disbursements, /{id}/approve|Finance, Manajer|Maker-checker pencairan|
|GET|/me/financings/{id}/schedule|Penerima|Jadwal & VA angsuran|
|POST|/webhooks/va/{provider}|Penyedia VA|Notifikasi pembayaran|
|GET|/backoffice/reconciliation?date=|Finance|Hasil rekonsiliasi|
|POST|/backoffice/financings/{id}/protection-claims |<br>buybacks|Komite|Penanganan kerugian|
|GET|/reports/portfolio, /reports/dpd,<br>/reports/protection|Manajemen, DPS|Laporan|



Halaman 24 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran G – Logika Perhitungan** 

### **G.1 Pembuatan jadwal** 

- start = tanggal pencairan terakhir + grace_months; angsuran ke-i jatuh tempo start + (i − 1) bulan. 

- principal_due = floor(principal ÷ tenor); ujrah_due = floor(ujrah ÷ tenor); selisih pembulatan ditambahkan pada angsuran terakhir. 

### **G.2 Alokasi pembayaran** 

- Pembayaran dialokasikan ke jadwal tertua yang belum lunas. Dalam satu jadwal, pembayaran parsial dibagi **proporsional** antara pokok dan ujrah (rasio jadwal), agar pendana menerima pokok dan bagi hasil secara seimbang. 

- Kelebihan bayar menjadi titipan pada pembiayaan dan dipakai untuk jadwal berikutnya (bukan pelunasan dipercepat kecuali diminta). 

- Tidak ada denda yang menjadi pendapatan. Jika DPS menetapkan ta'widh/ta'zir atas keterlambatan disengaja, dana ta'zir disalurkan sebagai dana sosial, tidak masuk hasil syirkah. 

### **G.3 Distribusi** 

- protection = round_down(ujrah_paid × protection_pct); net = ujrah_paid − protection. 

- investor_pool = round_down(net × nisbah_investor); kmh_profit = net − investor_pool. 

- Bagian pendana i = round_down(investor_pool × modal_i ÷ total_modal_pendana); pengembalian pokok syarik j = round_down(principal_paid × modal_j ÷ total_modal). 

- Sisa pembulatan (rupiah) dicatat ke akun pembulatan dan diselesaikan pada angsuran terakhir, sehingga total ke setiap syarik tepat sama dengan haknya. 

### **G.4 DPD** 

- DPD = hari sejak jatuh tempo jadwal tertua yang belum lunas; dihitung oleh job harian pukul 00:30 WIB dan disimpan sebagai snapshot untuk laporan bulanan. 

Halaman 25 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran H – Kriteria Penerimaan dan Skenario Uji** 

|**#**|**Skenario**|**Hasil yang diharapkan**|
|---|---|---|
|1|Webhook VA yang sama dikirim 3 kali|Saldo bertambah satu kali; dua lainnya tercatat<br>duplikat|
|2|Webhook dengan tanda tangan salah|Ditolak, tidak ada perubahan saldo, tercatat di log<br>keamanan|
|3|Dua pendana mendanai sisa kuota yang sama<br>bersamaan|Hanya satu berhasil sebesar sisa kuota; tidak ada<br>kelebihan pendanaan (row lock)|
|4|Listing berakhir 80% terdanai|Status EXPIRED; seluruh dana terkunci kembali ke<br>saldo tersedia|
|5|Angsuran penuh Rp2.950.000 (data Bab 5)|Distribusi persis sesuai tabel 5.4|
|6|Bayar parsial Rp1.475.000|Pokok 1.250.000 dan ujrah 225.000 teralokasi<br>proporsional; jadwal status PARTIAL|
|7|Pencairan dibuat dan disetujui oleh orang yang<br>sama|Ditolak sistem (maker ≠ checker)|
|8|Pendana menarik melebihi saldo tersedia|Ditolak|
|9|Total debit ≠ kredit dalam satu jurnal|Transaksi gagal (constraint database)|
|10|Rekonsiliasi dengan satu transaksi bank tanpa<br>webhook|Muncul sebagai selisih dan tiket ke finance|
|11|Buyback dieksekusi|Porsi pendana menjadi saldo tersedia sebesar pokok<br>tersisa; hak tagih berpindah ke KMH|
|12|Peran Pendana membuka dokumen KTP<br>peserta|Akses ditolak|



Halaman 26 

KMH – P2P Lending Syariah & Brief Website 

## **Lampiran I – Checklist Sebelum Go-Live** 

- ☐ Opini tertulis DPS atas struktur akad Lapis 1 dan 2, Dana Proteksi, buyback, dan perlakuan keterlambatan. 

- ☐ Template akad: Musyarakah (pendana–KMH), Ijarah Multijasa (KMH–peserta), perjanjian tripartit dengan LPK/SO, perjanjian penjamin, syarat & ketentuan platform. 

- ☐ SOP: verifikasi, analisa & scoring, komite, pencairan, collection, restrukturisasi, klaim Dana Proteksi, buyback, rekonsiliasi, penanganan pengaduan. 

- ☐ Parameter final: nisbah, ujrah per program, porsi Dana Proteksi, modal minimal KMH, batas eksposur, batas waktu listing. 

- ☐ Rekening penampung terpisah (diutamakan bank syariah) dan kontrak penyedia VA; uji di sandbox selesai. 

- ☐ Uji penetrasi dasar, backup & restore teruji, akun back-office dengan 2FA. 

- ☐ Edukasi anggota: risiko pendanaan, sifat bagi hasil yang tidak pasti, sifat Dana Proteksi dan buyback. 

- ☐ Rencana pilot: daftar peserta pertama, pendana pilot, dan target evaluasi setelah 3 bulan. 

Halaman 27 

