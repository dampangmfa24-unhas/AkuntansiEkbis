/**
 * ============================================================================
 *  GAME "KEDAI JAGUNG" — server
 *  Simulasi edukasi akuntansi: mode level, kampanye kedai bulan demi bulan,
 *  tantangan harian, toko upgrade, lencana, papan peringkat, pantauan Pemilik.
 *
 *  Data game terpisah total dari pembukuan asli (sheet "Game").
 *  Kunci jawaban tidak dikirim ke HP: klien hanya menerima hash + penjelasan
 *  yang terkunci dengan jawaban benar; skor dihitung ulang di server.
 * ============================================================================
 */

const GAME_SHEET = 'Game';
const G_RUN_TTL = 21600; // 6 jam

/* ------------------------------------------------------------------ */
/*  BAGAN AKUN GAME (tetap, tidak bergantung CoA usaha)                 */
/* ------------------------------------------------------------------ */
const G_ACC = {
  '1101': 'Kas', '1102': 'Piutang Usaha', '1104': 'Persediaan Bahan Baku', '1105': 'Persediaan Barang Jadi',
  '1106': 'Bank', '1107': 'DANA/QRIS', '1108': 'Sewa Dibayar di Muka', '1201': 'Peralatan',
  '1202': 'Akumulasi Penyusutan Peralatan', '2101': 'Utang Usaha', '2102': 'Utang Gaji',
  '2103': 'Pendapatan Diterima di Muka', '2201': 'Utang Bank', '3101': 'Modal Pemilik', '3201': 'Prive',
  '4101': 'Pendapatan Jasa', '4102': 'Penjualan', '4103': 'Retur & Potongan Penjualan',
  '5001': 'Harga Pokok Penjualan', '5101': 'Beban Sewa', '5102': 'Beban Utilitas', '5103': 'Beban Gaji',
  '5104': 'Beban Penyusutan', '5105': 'Beban Pemasaran', '5201': 'Beban Lain-lain'
};
const G_KAS = ['1101', '1106', '1107'];
const G_NOMINAL = k => k.charAt(0) === '4' || k.charAt(0) === '5';

/* Topik: [label, id panduan] */
const G_TOPIC = {
  modal: ['Setoran modal', 'b2'], aset_tunai: ['Beli aset tunai', 'b4'], beban_tunai: ['Bayar beban', 'b5'],
  utang: ['Utang usaha', 'c2'], piutang: ['Piutang', 'c5'], prive: ['Prive', 'b2'], transfer: ['Pindah dana', 'g5'],
  persamaan: ['Persamaan akuntansi', 'b3'], debit_kredit: ['Debit & kredit', 'b5'], bahan: ['Beli bahan baku', 'c2'],
  ongkir: ['Ongkos kirim pembelian', 'c2'], produksi: ['Produksi', 'c3'], hpp_unit: ['HPP per cup', 'c4'],
  jual_hpp: ['Penjualan + HPP', 'c1'], laba_kotor: ['Laba kotor', 'c1'], retur_jual: ['Retur penjualan', 'c6'],
  retur_beli: ['Retur pembelian', 'c7'], potongan_beli: ['Potongan pembelian', 'c7'], opname: ['Stok opname', 'c8'],
  prive_barang: ['Prive barang & tester', 'c9'], sewa_muka: ['Sewa dibayar di muka', 'd3'], sewa_sesuai: ['Penyesuaian sewa', 'd3'],
  uang_muka: ['Uang muka pesanan', 'd4'], gaji_utang: ['Gaji terutang', 'd5'], penyusutan: ['Penyusutan', 'd6'],
  koreksi: ['Jurnal koreksi', 'd8'], tutup_buku: ['Tutup buku', 'd7'], laba_rugi: ['Laba rugi', 'e1'],
  arus_kas: ['Arus kas', 'e4'], kas_vs_laba: ['Kas vs laba', 'd1'], rasio: ['Rasio', 'e5']
};

/* ------------------------------------------------------------------ */
/*  KONTEN LEVEL                                                       */
/* ------------------------------------------------------------------ */
function J_(teks, lines, topic, why, hint) { return { tipe: 'jurnal', teks: teks, lines: lines, topic: topic, why: why, hint: hint || '' }; }
function PG_(teks, opsi, ans, topic, why) { return { tipe: 'pg', teks: teks, opsi: opsi, ans: ans, topic: topic, why: why }; }
function N_(teks, ans, topic, why, satuan) { return { tipe: 'angka', teks: teks, ans: ans, topic: topic, why: why, satuan: satuan || 'Rp' }; }

const G_WORLDS = [
  { id: 1, nama: 'Dasar', warna: '#277DA1', emoji: '📒' },
  { id: 2, nama: 'Dagang & Produksi', warna: '#43AA8B', emoji: '🌽' },
  { id: 3, nama: 'Akhir Bulan', warna: '#F8961E', emoji: '🗓️' },
  { id: 4, nama: 'Membaca Laporan', warna: '#F94144', emoji: '📊' }
];

function G_LEVELS_() {
  return [
    { id: 'L0', dunia: 1, nama: 'Tutorial: jurnal pertama', tutorial: true, qs: [
      J_('Kamu memulai kedai dengan menyetor uang tabungan Rp2.000.000 ke kas usaha.', [['1101', 'D', 2000000], ['3101', 'K', 2000000]], 'modal',
        'Kas usaha bertambah (aset bertambah di Debit) dan bagian pemilik bertambah (Modal bertambah di Kredit).', 'Uang masuk ke kas. Dari mana asalnya?')] },
    { id: 'L1', dunia: 1, nama: 'Uang masuk & keluar', qs: [
      J_('Kamu membeli kompor dan panci Rp750.000, dibayar tunai.', [['1201', 'D', 750000], ['1101', 'K', 750000]], 'aset_tunai',
        'Peralatan (aset) bertambah di Debit, Kas berkurang di Kredit. Ini bukan beban karena dipakai bertahun-tahun.', 'Kompor dipakai lama: termasuk aset apa?'),
      J_('Bayar listrik dan air kedai bulan ini Rp180.000 tunai.', [['5102', 'D', 180000], ['1101', 'K', 180000]], 'beban_tunai',
        'Beban Utilitas bertambah di Debit, Kas berkurang di Kredit.', 'Listrik termasuk beban apa?'),
      J_('Bayar iklan Instagram Rp100.000 lewat DANA.', [['5105', 'D', 100000], ['1107', 'K', 100000]], 'beban_tunai',
        'Beban Pemasaran bertambah (Debit), saldo DANA/QRIS berkurang (Kredit).', 'Uangnya keluar dari akun DANA/QRIS.'),
      J_('Kamu menambah modal Rp500.000 dengan transfer ke rekening bank usaha.', [['1106', 'D', 500000], ['3101', 'K', 500000]], 'modal',
        'Bank bertambah di Debit, Modal Pemilik bertambah di Kredit.', 'Uang masuk ke rekening bank usaha.')] },
    { id: 'L2', dunia: 1, nama: 'Utang & piutang', qs: [
      J_('Beli jagung dan cup Rp400.000, dibayar minggu depan.', [['1104', 'D', 400000], ['2101', 'K', 400000]], 'utang',
        'Persediaan bahan bertambah (Debit); karena belum dibayar, Utang Usaha bertambah (Kredit).', 'Belum bayar berarti muncul kewajiban.'),
      J_('Lunasi utang ke pemasok Rp400.000 tunai.', [['2101', 'D', 400000], ['1101', 'K', 400000]], 'utang',
        'Utang berkurang di Debit, Kas berkurang di Kredit. Tidak ada beban baru.', 'Utang berkurang di sisi mana?'),
      J_('Kamu dibayar jasa memasak di acara arisan Rp300.000, dibayar minggu depan.', [['1102', 'D', 300000], ['4101', 'K', 300000]], 'piutang',
        'Piutang (hak menagih) bertambah di Debit, Pendapatan Jasa bertambah di Kredit.', 'Belum dibayar berarti punya hak menagih.'),
      J_('Pelunasan jasa arisan Rp300.000 masuk lewat transfer bank.', [['1106', 'D', 300000], ['1102', 'K', 300000]], 'piutang',
        'Bank bertambah, Piutang berkurang. Pendapatannya sudah dicatat sebelumnya.', 'Ini bukan pendapatan baru.')] },
    { id: 'L3', dunia: 1, nama: 'Uang usaha vs pribadi', qs: [
      J_('Kamu mengambil Rp250.000 dari kas usaha untuk belanja dapur rumah.', [['3201', 'D', 250000], ['1101', 'K', 250000]], 'prive',
        'Pengambilan untuk keperluan pribadi dicatat sebagai Prive (Debit), bukan beban usaha.', 'Untuk keperluan pribadi, bukan usaha.'),
      PG_('Uang kas usaha dipakai membeli pulsa pribadi. Akun apa yang didebit?', ['Beban Lain-lain', 'Prive', 'Beban Utilitas', 'Kas'], 1, 'prive',
        'Semua pemakaian uang usaha untuk keperluan pribadi adalah Prive.'),
      J_('Pindahkan Rp1.000.000 dari kas ke rekening bank usaha.', [['1106', 'D', 1000000], ['1101', 'K', 1000000]], 'transfer',
        'Hanya pindah tempat: Bank bertambah, Kas berkurang. Tidak ada pendapatan atau beban.', 'Dua-duanya akun uang usaha.'),
      PG_('Kamu membayar listrik rumah pakai DANA usaha Rp150.000. Apa pengaruhnya pada laba usaha?', ['Berkurang Rp150.000', 'Tidak berubah', 'Bertambah Rp150.000', 'Berkurang setengahnya'], 1, 'prive',
        'Itu Prive: mengurangi modal dan kas, tetapi tidak mengurangi laba usaha.')] },
    { id: 'L4', dunia: 1, nama: 'Persamaan akuntansi', qs: [
      N_('Total aset kedai Rp6.500.000 dan utangnya Rp1.500.000. Berapa modal pemilik?', 5000000, 'persamaan', 'Modal = Aset − Utang = 6.500.000 − 1.500.000.'),
      PG_('Kedai membeli cup Rp200.000 secara kredit. Apa yang terjadi?', ['Aset naik, modal naik', 'Aset naik, utang naik', 'Aset naik, aset lain turun', 'Utang naik, modal turun'], 1, 'persamaan',
        'Persediaan (aset) naik dan Utang Usaha naik dengan jumlah sama.'),
      N_('Modal awal Rp3.000.000, laba bulan ini Rp800.000, prive Rp300.000. Berapa modal akhir?', 3500000, 'persamaan', '3.000.000 + 800.000 − 300.000 = 3.500.000.'),
      PG_('Akun mana yang bertambah di sisi Kredit?', ['Utang Usaha', 'Kas', 'Beban Gaji', 'Prive'], 0, 'debit_kredit',
        'Utang, modal, dan pendapatan bertambah di Kredit. Aset, beban, dan prive bertambah di Debit.')] },
    { id: 'L5', dunia: 2, nama: 'Belanja bahan', qs: [
      J_('Beli 10 kg jagung Rp180.000 tunai.', [['1104', 'D', 180000], ['1101', 'K', 180000]], 'bahan',
        'Bahan yang akan menjadi produk dicatat ke Persediaan Bahan Baku, bukan beban.', 'Jagung akan diolah jadi produk.'),
      J_('Ongkos ojek mengambil jagung Rp15.000, dibayar pakai DANA.', [['1104', 'D', 15000], ['1107', 'K', 15000]], 'ongkir',
        'Ongkos untuk mendapatkan bahan menambah nilai persediaan bahan.', 'Ongkirnya menambah nilai bahan.'),
      J_('Beli susu, keju, dan mentega Rp350.000: Rp150.000 dibayar tunai, sisanya utang.', [['1104', 'D', 350000], ['1101', 'K', 150000], ['2101', 'K', 200000]], 'bahan',
        'Persediaan bertambah 350.000; dibayar dari Kas 150.000 dan sisanya menjadi Utang Usaha 200.000.', 'Ada tiga akun: satu Debit, dua Kredit.'),
      J_('Beli cup dan sendok Rp120.000 lewat transfer bank.', [['1104', 'D', 120000], ['1106', 'K', 120000]], 'bahan',
        'Cup dan sendok bagian dari produk, jadi masuk Persediaan Bahan Baku.', 'Cup ikut terjual bersama produk.')] },
    { id: 'L6', dunia: 2, nama: 'Produksi & HPP per cup', qs: [
      N_('Bahan satu batch bernilai Rp300.000 menghasilkan 50 cup Medium. Berapa harga pokok per cup?', 6000, 'hpp_unit', '300.000 ÷ 50 = 6.000 per cup.'),
      J_('Batch bahan Rp300.000 tadi diolah menjadi cup siap jual.', [['1105', 'D', 300000], ['1104', 'K', 300000]], 'produksi',
        'Nilai pindah dari bahan baku ke barang jadi. Tidak ada uang keluar.', 'Bahan berkurang, barang jadi bertambah.'),
      N_('Bahan Rp240.000 menghasilkan 30 cup Large. Berapa harga pokok per cup Large?', 8000, 'hpp_unit', '240.000 ÷ 30 = 8.000.'),
      PG_('Biaya mana yang masuk ke harga pokok per cup?', ['Sewa lapak', 'Jagung dan keju', 'Gaji helper', 'Iklan Instagram'], 1, 'hpp_unit',
        'Di aplikasi ini harga pokok hanya bahan yang menjadi produk; sewa, gaji, dan iklan adalah beban operasi.')] },
    { id: 'L7', dunia: 2, nama: 'Jual + HPP', qs: [
      J_('Jual 12 cup Medium tunai (harga Rp15.000, harga pokok Rp6.000/cup).', [['1101', 'D', 180000], ['4102', 'K', 180000], ['5001', 'D', 72000], ['1105', 'K', 72000]], 'jual_hpp',
        'Kas & Penjualan 12 × 15.000 = 180.000; HPP & Barang Jadi 12 × 6.000 = 72.000.', 'Ada dua pasangan: uang–penjualan dan HPP–barang jadi.'),
      J_('Jual 20 cup Small lewat QRIS (harga Rp10.000, harga pokok Rp4.000/cup).', [['1107', 'D', 200000], ['4102', 'K', 200000], ['5001', 'D', 80000], ['1105', 'K', 80000]], 'jual_hpp',
        'DANA/QRIS & Penjualan 200.000; HPP & Barang Jadi 80.000.', 'Uangnya masuk ke DANA/QRIS.'),
      J_('Kantor memesan 15 cup Large, dibayar akhir bulan (harga Rp20.000, harga pokok Rp8.000/cup).', [['1102', 'D', 300000], ['4102', 'K', 300000], ['5001', 'D', 120000], ['1105', 'K', 120000]], 'jual_hpp',
        'Belum dibayar → Piutang 300.000; HPP & Barang Jadi 120.000.', 'Belum dibayar: akun apa yang bertambah?'),
      N_('Dari tiga penjualan tadi, berapa total laba kotornya?', 408000, 'laba_kotor', 'Penjualan 680.000 − HPP 272.000 = 408.000.')] },
    { id: 'L8', dunia: 2, nama: 'Retur & potongan', qs: [
      J_('Pembeli komplain cup kurang hangat; uang Rp15.000 dikembalikan lewat QRIS.', [['4103', 'D', 15000], ['1107', 'K', 15000]], 'retur_jual',
        'Retur & Potongan Penjualan (pengurang pendapatan) di Debit, DANA/QRIS berkurang di Kredit.', 'Jangan kurangi akun Penjualan langsung.'),
      J_('Kamu mengembalikan jagung busuk Rp60.000 ke pemasok (belum dibayar).', [['2101', 'D', 60000], ['1104', 'K', 60000]], 'retur_beli',
        'Utang berkurang dan persediaan bahan berkurang.', 'Belum dibayar → utangnya yang berkurang.'),
      J_('Utang Rp500.000 dilunasi tunai Rp490.000 karena dapat potongan Rp10.000.', [['2101', 'D', 500000], ['1101', 'K', 490000], ['1104', 'K', 10000]], 'potongan_beli',
        'Utang lunas 500.000: Kas keluar 490.000, potongan 10.000 mengurangi nilai persediaan.', 'Utang yang hilang 500.000, uang keluar 490.000.'),
      PG_('Kenapa retur penjualan dicatat di akun tersendiri, bukan langsung mengurangi Penjualan?', ['Supaya pajak lebih kecil', 'Supaya penjualan kotor dan returnya sama-sama terlihat', 'Karena retur adalah beban operasi', 'Karena retur menambah kas'], 1, 'retur_jual',
        'Dengan akun terpisah, kamu bisa memantau seberapa banyak retur terjadi.')] },
    { id: 'L9', dunia: 2, nama: 'Stok opname', qs: [
      J_('Catatan bahan baku Rp420.000, tetapi hitungan fisik hanya Rp385.000.', [['5001', 'D', 35000], ['1104', 'K', 35000]], 'opname',
        'Selisih 35.000 menyesuaikan catatan dengan fisik dan menjadi bagian HPP.', 'Catatan − fisik = selisih.'),
      N_('Catatan barang jadi Rp180.000. Hitungan fisik: 24 cup Medium × Rp6.000. Berapa selisih yang harus dicatat?', 36000, 'opname', '180.000 − 144.000 = 36.000.'),
      J_('Kamu mengambil 3 cup Medium (harga pokok Rp6.000) untuk keluarga.', [['3201', 'D', 18000], ['1105', 'K', 18000]], 'prive_barang',
        'Produk untuk pribadi dicatat sebagai Prive sebesar harga pokok.', 'Untuk keluarga = pribadi.'),
      J_('2 cup Small (harga pokok Rp4.000) dibagikan gratis sebagai tester.', [['5105', 'D', 8000], ['1105', 'K', 8000]], 'prive_barang',
        'Tester untuk promosi adalah Beban Pemasaran sebesar harga pokok.', 'Tujuannya promosi.')] },
    { id: 'L10', dunia: 3, nama: 'Sewa di muka', qs: [
      J_('Bayar sewa lapak 6 bulan Rp1.800.000 lewat transfer bank.', [['1108', 'D', 1800000], ['1106', 'K', 1800000]], 'sewa_muka',
        'Belum terpakai, jadi dicatat sebagai aset Sewa Dibayar di Muka.', 'Manfaatnya untuk 6 bulan ke depan.'),
      J_('Akhir bulan pertama: catat sewa yang sudah terpakai.', [['5101', 'D', 300000], ['1108', 'K', 300000]], 'sewa_sesuai',
        '1.800.000 ÷ 6 = 300.000 pindah dari aset ke Beban Sewa.', 'Berapa sewa per bulan?'),
      N_('Setelah 4 bulan, berapa saldo Sewa Dibayar di Muka?', 600000, 'sewa_sesuai', '1.800.000 − 4 × 300.000 = 600.000.'),
      PG_('Sewa Dibayar di Muka termasuk kelompok apa?', ['Beban', 'Aset lancar', 'Utang', 'Modal'], 1, 'sewa_muka', 'Manfaatnya masih akan diterima dalam setahun, jadi aset lancar.')] },
    { id: 'L11', dunia: 3, nama: 'Uang muka & gaji', qs: [
      J_('Panitia membayar penuh 80 cup Medium Rp1.200.000 lewat QRIS. Acaranya minggu depan.', [['1107', 'D', 1200000], ['2103', 'K', 1200000]], 'uang_muka',
        'Produk belum diserahkan, jadi uang itu kewajiban: Pendapatan Diterima di Muka.', 'Sudah dibayar tapi barang belum diserahkan.'),
      J_('Hari acara: 80 cup diserahkan (harga pokok Rp6.000/cup).', [['2103', 'D', 1200000], ['4102', 'K', 1200000], ['5001', 'D', 480000], ['1105', 'K', 480000]], 'uang_muka',
        'Kewajiban berubah menjadi penjualan; HPP 80 × 6.000 = 480.000.', 'Kewajiban hilang, penjualan muncul.'),
      J_('31 Oktober: gaji helper Oktober Rp1.200.000 baru dibayar 5 November.', [['5103', 'D', 1200000], ['2102', 'K', 1200000]], 'gaji_utang',
        'Bebannya milik Oktober, jadi dicatat sekarang sebagai Utang Gaji.', 'Belum dibayar tapi sudah menjadi beban.'),
      J_('5 November: gaji tadi dibayar tunai.', [['2102', 'D', 1200000], ['1101', 'K', 1200000]], 'gaji_utang',
        'Utang Gaji lunas. Beban tidak dicatat dua kali.', 'Bebannya sudah dicatat bulan lalu.')] },
    { id: 'L12', dunia: 3, nama: 'Penyusutan & koreksi', qs: [
      N_('Freezer Rp3.600.000 dipakai 3 tahun tanpa nilai sisa. Berapa penyusutan per bulan?', 100000, 'penyusutan', '3.600.000 ÷ 36 bulan = 100.000.'),
      J_('Catat penyusutan freezer bulan ini.', [['5104', 'D', 100000], ['1202', 'K', 100000]], 'penyusutan',
        'Beban Penyusutan di Debit, Akumulasi Penyusutan di Kredit. Tidak ada uang keluar.', 'Akumulasi penyusutan adalah akun kontra.'),
      J_('Koreksi: listrik Rp150.000 bulan lalu tercatat sebagai Beban Sewa.', [['5102', 'D', 150000], ['5101', 'K', 150000]], 'koreksi',
        'Pindahkan dari Beban Sewa ke Beban Utilitas.', 'Akun yang salah dikurangi, akun yang benar ditambah.'),
      PG_('Saldo normal Akumulasi Penyusutan Peralatan adalah…', ['Debit', 'Kredit', 'Tidak punya saldo', 'Mengikuti kas'], 1, 'penyusutan', 'Akun kontra aset bersaldo normal Kredit.')] },
    { id: 'L13', dunia: 4, nama: 'Laba rugi', intro: 'Data bulan ini: Penjualan Rp6.000.000 · Retur Rp100.000 · HPP Rp2.400.000 · Beban sewa Rp600.000 · utilitas Rp200.000 · gaji Rp1.200.000 · pemasaran Rp150.000 · penyusutan Rp100.000.', qs: [
      N_('Berapa pendapatan bersih?', 5900000, 'laba_rugi', '6.000.000 − 100.000 = 5.900.000.'),
      N_('Berapa laba kotor?', 3500000, 'laba_rugi', '5.900.000 − 2.400.000 = 3.500.000.'),
      N_('Berapa laba bersih?', 1250000, 'laba_rugi', 'Beban operasi 2.250.000; 3.500.000 − 2.250.000 = 1.250.000.'),
      N_('Berapa margin laba kotor (persen, dibulatkan)?', 59, 'rasio', '3.500.000 ÷ 5.900.000 = 59,3% → 59.', '%')] },
    { id: 'L14', dunia: 4, nama: 'Arus kas', qs: [
      PG_('Membeli freezer tunai masuk kelompok arus kas…', ['Operasi', 'Investasi', 'Pendanaan', 'Tidak masuk arus kas'], 1, 'arus_kas', 'Membeli aset jangka panjang adalah investasi.'),
      PG_('Prive masuk kelompok arus kas…', ['Operasi', 'Investasi', 'Pendanaan', 'Tidak masuk arus kas'], 2, 'arus_kas', 'Transaksi dengan pemilik (setoran & prive) adalah pendanaan.'),
      PG_('Membayar pemasok jagung masuk kelompok…', ['Operasi', 'Investasi', 'Pendanaan', 'Tidak masuk arus kas'], 0, 'arus_kas', 'Kegiatan harian usaha adalah operasi.'),
      PG_('Laba bulan ini Rp2 juta, tapi kas hanya naik Rp300 ribu. Penyebab yang mungkin?', ['Banyak penjualan kredit', 'Membeli stok besar', 'Ada prive', 'Semua di atas'], 3, 'kas_vs_laba', 'Ketiganya membuat perubahan kas berbeda dari laba.')] },
    { id: 'L15', dunia: 4, nama: 'Rasio & keputusan', qs: [
      N_('Aset lancar Rp4.500.000, utang jangka pendek Rp1.500.000. Berapa rasio lancarnya?', 3, 'rasio', '4.500.000 ÷ 1.500.000 = 3 (aset lancar 3× utang).', '×'),
      N_('Laba bersih Rp1.250.000 dari pendapatan Rp5.000.000. Berapa margin laba bersih (persen)?', 25, 'rasio', '1.250.000 ÷ 5.000.000 = 25%.', '%'),
      N_('HPP sebulan Rp2.400.000, rata-rata persediaan Rp300.000. Berapa kali perputaran persediaan?', 8, 'rasio', '2.400.000 ÷ 300.000 = 8 kali.', '×'),
      PG_('Margin laba kotor turun dari 60% ke 45%, padahal harga jual tetap. Penyebab paling mungkin?', ['Harga bahan naik atau porsi kebesaran', 'Sewa naik', 'Prive bertambah', 'Gaji naik'], 0, 'rasio',
        'Laba kotor hanya dipengaruhi penjualan dan HPP; sewa, gaji, dan prive tidak memengaruhinya.')] }
  ];
}

/* ------------------------------------------------------------------ */
/*  TOKO, AVATAR, LENCANA                                              */
/* ------------------------------------------------------------------ */
/* Toko bertingkat (Tahap 2). lv = level kedai minimum; gratis = hadiah level tonggak. */
const G_ITEMS = [
  { id: 'bendera', nama: 'Bendera hias', lv: 1, harga: 60, emoji: '🎏' },
  { id: 'tanaman', nama: 'Pot tanaman', lv: 1, harga: 80, emoji: '🪴' },
  { id: 'payung', nama: 'Payung warna-warni', lv: 3, harga: 150, emoji: '⛱️' },
  { id: 'lampu', nama: 'Lampu gantung', lv: 5, harga: 220, emoji: '💡' },
  { id: 'kursi', nama: 'Kursi pelanggan', lv: 8, harga: 300, emoji: '🪑' },
  { id: 'spanduk', nama: 'Spanduk promo', lv: 10, harga: 400, emoji: '🎉' },
  { id: 'musik', nama: 'Speaker musik', lv: 12, harga: 500, emoji: '🎵' },
  { id: 'kucing', nama: 'Kucing penjaga', lv: 15, harga: 650, emoji: '🐈' },
  { id: 'neon', nama: 'Papan neon OPEN', lv: 18, harga: 800, emoji: '🌟' },
  { id: 'kulkas', nama: 'Kulkas minuman', lv: 22, harga: 1000, emoji: '🧊' },
  { id: 'menu', nama: 'Papan menu kapur', lv: 5, harga: 0, gratis: true, emoji: '📋' },
  { id: 'jam', nama: 'Jam dinding retro', lv: 10, harga: 0, gratis: true, emoji: '🕰️' },
  { id: 'lonceng', nama: 'Lonceng gerobak', lv: 20, harga: 0, gratis: true, emoji: '🔔' },
  { id: 'skuter', nama: 'Skuter matik retro', lv: 30, harga: 0, gratis: true, emoji: '🛵' }
];
const G_HADIAH_LV = { 5: 'menu', 10: 'jam', 20: 'lonceng', 30: 'skuter' };
const G_KEDAI = [{ lv: 1, nama: 'Meja Sewaan' }, { lv: 5, nama: 'Meja Kayu' }, { lv: 10, nama: 'Stan Beratap' }, { lv: 20, nama: 'Gerobak Keliling' }, { lv: 30, nama: 'Kios Cornafa' }];
const G_AVATARS = ['raka', 'nisa', 'dimas', 'sari', 'bima', 'ayu', 'eko', 'tari', 'andi', 'lina'];
const G_AVATARS_LAMA = ['🧑‍🍳', '👩‍🍳', '👨‍🍳', '🦊', '🐱', '🐻', '🐼', '🐯', '🐸', '🌽'];
const G_LV_MAX = 30;
function gXpNext_(L) { return Math.round((20 + 10 * Math.pow(L, 1.45)) / 5) * 5; }
function gLevel_(xp) {
  let L = 1, need = 0; xp = Math.max(0, Number(xp) || 0);
  while (L < G_LV_MAX) { const n = gXpNext_(L); if (xp < need + n) return { lv: L, xp: xp - need, next: n, total: xp }; need += n; L++; }
  return { lv: G_LV_MAX, xp: 0, next: 0, total: xp };
}
function gTier_(L) { return L >= 30 ? 5 : L >= 20 ? 4 : L >= 10 ? 3 : L >= 5 ? 2 : 1; }
function gAvatarId_(a) {
  if (G_AVATARS.indexOf(a) !== -1) return a;
  const i = G_AVATARS_LAMA.indexOf(a);
  return i !== -1 ? G_AVATARS[i] : (a ? G_AVATARS[0] : '');
}
/** Migrasi profil lama ke Tahap 2 (aman dijalankan berulang). */
function gMigrasi_(p) {
  p.items = p.items || []; p.hidden = p.hidden || [];
  p.avatar = gAvatarId_(p.avatar);
  if (p.items.indexOf('gerobak') !== -1) {
    p.items = p.items.filter(x => x !== 'gerobak'); p.hidden = p.hidden.filter(x => x !== 'gerobak');
    p.koin = (p.koin || 0) + 800; p.refund = (p.refund || 0) + 800;
  }
  p.items = p.items.filter(x => G_ITEMS.some(it => it.id === x));
  const L = gLevel_(p.poin).lv;
  if (!p.lvl) {
    p.lvl = L;
    Object.keys(G_HADIAH_LV).forEach(k => { if (L >= Number(k) && p.items.indexOf(G_HADIAH_LV[k]) === -1) p.items.push(G_HADIAH_LV[k]); });
  }
  p.v = 2;
  return p;
}
/** Dipanggil setelah poin bertambah: bonus koin, hiasan gratis, barang toko yang baru terbuka. */
function gNaikLevel_(p) {
  const dari = p.lvl || 1, info = gLevel_(p.poin), ke = info.lv;
  if (ke <= dari) { p.lvl = Math.max(dari, ke); return null; }
  let koin = 0; const hadiah = [], toko = [];
  for (let L = dari + 1; L <= ke; L++) {
    koin += L * 5;
    const h = G_HADIAH_LV[L]; if (h && p.items.indexOf(h) === -1) { p.items.push(h); hadiah.push(h); }
    G_ITEMS.forEach(it => { if (!it.gratis && it.lv === L) toko.push(it.id); });
  }
  p.koin += koin; p.lvl = ke;
  return { dari: dari, ke: ke, koin: koin, hadiah: hadiah, toko: toko, tierDari: gTier_(dari), tierKe: gTier_(ke) };
}
const G_BADGES = [
  { id: 'pemula', nama: 'Langkah Pertama', ket: 'Menyelesaikan tutorial', emoji: '👣' },
  { id: 'dasar', nama: 'Lulus Dasar Akuntansi', ket: 'Level 1–9 minimal 2 bintang', emoji: '🎓' },
  { id: 'dagang', nama: 'Ahli Dagang', ket: 'Level 5–9 semuanya 3 bintang', emoji: '🌽' },
  { id: 'akhirbulan', nama: 'Tutup Buku Rapi', ket: 'Level 10–12 minimal 2 bintang', emoji: '🗓️' },
  { id: 'analis', nama: 'Pembaca Laporan', ket: 'Level 13–15 minimal 2 bintang', emoji: '📊' },
  { id: 'jitu', nama: 'Tanpa Petunjuk', ket: 'Satu level 3 bintang, semua benar pertama kali tanpa petunjuk', emoji: '🎯' },
  { id: 'bulan1', nama: 'Bulan Pertama', ket: 'Menyelesaikan bulan 1 kampanye', emoji: '🏪' },
  { id: 'bulan3', nama: 'Pengusaha Tangguh', ket: 'Menyelesaikan 3 bulan kampanye', emoji: '🏆' },
  { id: 'streak3', nama: 'Rajin 3 Hari', ket: 'Tantangan harian 3 hari berturut-turut', emoji: '🔥' },
  { id: 'streak7', nama: 'Rajin Seminggu', ket: 'Tantangan harian 7 hari berturut-turut', emoji: '⚡' },
  { id: 'kolektor', nama: 'Kolektor', ket: 'Membeli 5 barang di toko', emoji: '🛍️' }
];

/* ------------------------------------------------------------------ */
/*  UTIL: acak, hash, segel                                            */
/* ------------------------------------------------------------------ */
function gRng_(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gInt_(rng, a, b, step) { step = step || 1; const n = Math.floor((b - a) / step); return a + step * Math.floor(rng() * (n + 1)); }
function gPick_(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function gShuffle_(rng, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function gDigest_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(b => b & 255); }
function gHash_(s) { return gDigest_(s).map(b => ('0' + b.toString(16)).slice(-2)).join(''); }
function gRp_(n) { return 'Rp' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

/** Bentuk kanonik jawaban (harus sama persis dengan klien). */
function gCanon_(q, answer) {
  if (q.tipe === 'pg') return 'pg:' + Number(answer);
  if (q.tipe === 'angka') return 'n:' + Math.round(Number(answer));
  const m = {};
  (answer || []).forEach(l => {
    const kode = String(l[0]), side = l[1] === 'K' ? 'K' : 'D', amt = Math.round(Number(l[2]) || 0);
    if (!kode || !amt) return;
    m[kode + ':' + side] = (m[kode + ':' + side] || 0) + amt;
  });
  return Object.keys(m).sort().map(k => k + ':' + m[k]).join(';');
}
function gKeyCanon_(q) { return gCanon_(q, q.tipe === 'jurnal' ? q.lines : q.ans); }

/** Enkripsi XOR dengan aliran kunci SHA-256 (untuk penjelasan yang terbuka setelah jawaban benar). */
function gSeal_(text, keyHex) {
  const bytes = Utilities.newBlob(String(text)).getBytes();
  const out = [];
  let ks = [];
  for (let i = 0; i < bytes.length; i++) {
    if (i % 32 === 0) ks = gDigest_(keyHex + ':' + (i / 32));
    const v = (bytes[i] & 255) ^ ks[i % 32];
    out.push(v > 127 ? v - 256 : v);
  }
  return Utilities.base64Encode(out);
}

/** Versi aman untuk klien: tanpa kunci jawaban. */
function gPublic_(q, salt) {
  const canon = gKeyCanon_(q);
  const topic = G_TOPIC[q.topic] || ['', ''];
  const p = { id: q.id, tipe: q.tipe, teks: q.teks, topic: q.topic, topikNama: topic[0], guide: topic[1], hint: q.hint || '', ulang: !!q.ulang,
    hf: gHash_(salt + '|' + canon), why: gSeal_(q.why || '', gHash_('why|' + salt + '|' + canon)) };
  if (q.tipe === 'pg') p.opsi = q.opsi;
  if (q.tipe === 'angka') p.satuan = q.satuan;
  if (q.tipe === 'jurnal') {
    const m = {};
    q.lines.forEach(l => { m[l[0] + ':' + l[1]] = (m[l[0] + ':' + l[1]] || 0) + l[2]; });
    const keys = Object.keys(m);
    p.n = keys.length;
    p.hs = keys.map(k => gHash_(salt + '|' + k)).sort();
    p.ha = keys.map(k => gHash_(salt + '|' + k + ':' + m[k])).sort();
  }
  return p;
}

/* ------------------------------------------------------------------ */
/*  KAMPANYE: generator kejadian                                       */
/* ------------------------------------------------------------------ */
const G_SIZE = { S: { nama: 'Small', harga: 10000, hpp: 4000 }, M: { nama: 'Medium', harga: 15000, hpp: 6000 }, L: { nama: 'Large', harga: 20000, hpp: 8000 } };

function gApply_(saldo, lines) {
  lines.forEach(l => { saldo[l[0]] = (saldo[l[0]] || 0) + (l[1] === 'D' ? l[2] : -l[2]); });
}
function gKasTotal_(s) { return G_KAS.reduce((t, k) => t + (s[k] || 0), 0); }
function gKasDengan_(s, min, rng) {
  const ok = G_KAS.filter(k => (s[k] || 0) >= min);
  return ok.length ? gPick_(rng, ok) : null;
}
const G_KAS_NAMA = { '1101': 'tunai', '1106': 'lewat transfer bank', '1107': 'lewat DANA' };

const G_EVENTS = {
  modalAwal: (s, r) => ({ teks: 'Hari pertama! Kamu menyetor tabungan Rp3.000.000 ke kas kedai sebagai modal awal.', lines: [['1101', 'D', 3000000], ['3101', 'K', 3000000]], topic: 'modal',
    why: 'Kas bertambah (Debit), Modal Pemilik bertambah (Kredit).', hint: 'Uang masuk ke kas; asalnya dari pemilik.' }),
  peralatan: (s, r) => {
    const amt = 900000; if ((s['1101'] || 0) < amt + 300000) return null;
    return { teks: 'Beli kompor, dandang, dan termos Rp900.000 tunai untuk kedai.', lines: [['1201', 'D', amt], ['1101', 'K', amt]], topic: 'aset_tunai',
      why: 'Peralatan dipakai lama: aset bertambah di Debit, Kas berkurang di Kredit.', hint: 'Dipakai bertahun-tahun, bukan beban.' };
  },
  beliTunai: (s, r) => {
    const amt = gInt_(r, 200000, 500000, 10000); const k = gKasDengan_(s, amt + 100000, r); if (!k) return null;
    return { teks: 'Belanja jagung, susu, dan keju Rp' + gRp_(amt).slice(2) + ' ' + G_KAS_NAMA[k] + '.', lines: [['1104', 'D', amt], [k, 'K', amt]], topic: 'bahan',
      why: 'Bahan masuk Persediaan Bahan Baku; uang keluar dari ' + G_ACC[k] + '.', hint: 'Bahan akan diolah menjadi produk.' };
  },
  beliKredit: (s, r) => {
    if ((s['2101'] || 0) < -800000) return null;
    const amt = gInt_(r, 200000, 450000, 5000);
    return { teks: 'Pemasok mengantar jagung dan cup Rp' + gRp_(amt).slice(2) + ', dibayar minggu depan.', lines: [['1104', 'D', amt], ['2101', 'K', amt]], topic: 'utang',
      why: 'Persediaan bertambah dan Utang Usaha bertambah karena belum dibayar.', hint: 'Belum dibayar → kewajiban.' };
  },
  produksi: (s, r) => {
    const bahan = s['1104'] || 0; if (bahan < 120000) return null;
    const maxCup = Math.floor(Math.min(bahan, 540000) / 6000); if (maxCup < 20) return null;
    const cup = gInt_(r, Math.min(40, maxCup), Math.min(90, maxCup)); const amt = cup * 6000;
    return { teks: 'Masak satu batch: bahan senilai Rp' + gRp_(amt).slice(2) + ' diolah menjadi ' + cup + ' cup Medium (Rp6.000/cup).', lines: [['1105', 'D', amt], ['1104', 'K', amt]], topic: 'produksi',
      why: 'Nilai pindah dari bahan baku ke barang jadi; tidak ada uang keluar.', hint: 'Bahan berkurang, barang jadi bertambah.' };
  },
  jual: (s, r) => {
    const bj = s['1105'] || 0; const size = gPick_(r, ['S', 'M', 'M', 'L']); const z = G_SIZE[size];
    const maxQ = Math.floor(bj / z.hpp); if (maxQ < 8) return null;
    const q = gInt_(r, Math.min(15, maxQ), Math.min(50, maxQ)); const tempat = gPick_(r, ['di event kampus', 'di car free day', 'di depan sekolah', 'di bazar UMKM']);
    const k = gPick_(r, ['1101', '1107', '1107']); const jual = q * z.harga, hpp = q * z.hpp;
    return { teks: 'Jualan ' + tempat + ': ' + q + ' cup ' + z.nama + ' terjual, dibayar ' + (k === '1107' ? 'lewat QRIS' : 'tunai') + '. Harga Rp' + gRp_(z.harga).slice(2) + ', harga pokok Rp' + gRp_(z.hpp).slice(2) + '/cup.',
      lines: [[k, 'D', jual], ['4102', 'K', jual], ['5001', 'D', hpp], ['1105', 'K', hpp]], topic: 'jual_hpp',
      why: G_ACC[k] + ' & Penjualan ' + q + ' × ' + z.harga + ' = ' + jual + '; HPP & Barang Jadi ' + q + ' × ' + z.hpp + ' = ' + hpp + '.', hint: 'Dua pasangan: uang–penjualan dan HPP–barang jadi.' };
  },
  jualKredit: (s, r) => {
    const bj = s['1105'] || 0; const z = G_SIZE.L; const maxQ = Math.floor(bj / z.hpp); if (maxQ < 10) return null;
    const q = gInt_(r, 10, Math.min(30, maxQ)); const jual = q * z.harga, hpp = q * z.hpp;
    return { teks: 'Kantor kelurahan memesan ' + q + ' cup Large untuk rapat, dibayar akhir bulan. Harga Rp20.000, harga pokok Rp8.000/cup.',
      lines: [['1102', 'D', jual], ['4102', 'K', jual], ['5001', 'D', hpp], ['1105', 'K', hpp]], topic: 'piutang',
      why: 'Belum dibayar → Piutang ' + jual + '; HPP & Barang Jadi ' + hpp + '.', hint: 'Belum dibayar: hak menagih bertambah.' };
  },
  terimaPiutang: (s, r) => {
    const p = s['1102'] || 0; if (p <= 0) return null; const k = gPick_(r, ['1106', '1107']);
    return { teks: 'Pelanggan melunasi tagihan Rp' + gRp_(p).slice(2) + ' ' + G_KAS_NAMA[k] + '.', lines: [[k, 'D', p], ['1102', 'K', p]], topic: 'piutang',
      why: 'Uang bertambah, Piutang berkurang. Penjualannya sudah dicatat sebelumnya.', hint: 'Bukan penjualan baru.' };
  },
  bayarUtang: (s, r) => {
    const u = -(s['2101'] || 0); if (u <= 0) return null; const k = gKasDengan_(s, u + 50000, r); if (!k) return null;
    return { teks: 'Lunasi utang ke pemasok Rp' + gRp_(u).slice(2) + ' ' + G_KAS_NAMA[k] + '.', lines: [['2101', 'D', u], [k, 'K', u]], topic: 'utang',
      why: 'Utang berkurang di Debit, uang berkurang di Kredit.', hint: 'Utang berkurang di sisi mana?' };
  },
  listrik: (s, r) => {
    const amt = gInt_(r, 100000, 220000, 5000); const k = gKasDengan_(s, amt + 50000, r); if (!k) return null;
    return { teks: 'Bayar listrik dan air kedai Rp' + gRp_(amt).slice(2) + ' ' + G_KAS_NAMA[k] + '.', lines: [['5102', 'D', amt], [k, 'K', amt]], topic: 'beban_tunai',
      why: 'Beban Utilitas bertambah, uang berkurang.', hint: 'Listrik termasuk beban apa?' };
  },
  promosi: (s, r) => {
    const amt = gInt_(r, 50000, 150000, 5000); if ((s['1107'] || 0) < amt + 20000) return null;
    return { teks: 'Pasang iklan Instagram Rp' + gRp_(amt).slice(2) + ' lewat DANA.', lines: [['5105', 'D', amt], ['1107', 'K', amt]], topic: 'beban_tunai',
      why: 'Beban Pemasaran bertambah, DANA/QRIS berkurang.', hint: 'Iklan = pemasaran.' };
  },
  prive: (s, r) => {
    if ((s['1101'] || 0) < 600000) return null; const amt = gInt_(r, 100000, 300000, 10000);
    return { teks: 'Kamu mengambil Rp' + gRp_(amt).slice(2) + ' dari kas kedai untuk keperluan rumah.', lines: [['3201', 'D', amt], ['1101', 'K', amt]], topic: 'prive',
      why: 'Keperluan pribadi = Prive, bukan beban usaha.', hint: 'Untuk pribadi.' };
  },
  setorBank: (s, r) => {
    const kas = s['1101'] || 0; if (kas < 900000) return null; const amt = gInt_(r, 300000, Math.min(1000000, kas - 300000), 50000);
    return { teks: 'Setor Rp' + gRp_(amt).slice(2) + ' dari kas ke rekening bank kedai.', lines: [['1106', 'D', amt], ['1101', 'K', amt]], topic: 'transfer',
      why: 'Hanya pindah tempat: Bank bertambah, Kas berkurang.', hint: 'Dua-duanya akun uang.' };
  },
  ongkir: (s, r) => {
    const amt = gInt_(r, 10000, 25000, 1000); if ((s['1107'] || 0) < amt + 10000) return null;
    return { teks: 'Ongkos ojek mengambil bahan dari pasar Rp' + gRp_(amt).slice(2) + ' lewat DANA.', lines: [['1104', 'D', amt], ['1107', 'K', amt]], topic: 'ongkir',
      why: 'Ongkos mendapatkan bahan menambah nilai Persediaan Bahan Baku.', hint: 'Ongkir menambah nilai bahan.' };
  },
  returJual: (s, r) => {
    if (-(s['4102'] || 0) < 100000) return null; const amt = gPick_(r, [10000, 15000, 20000, 30000]); if ((s['1107'] || 0) < amt) return null;
    return { teks: 'Pembeli komplain pesanannya salah; uang Rp' + gRp_(amt).slice(2) + ' dikembalikan lewat QRIS.', lines: [['4103', 'D', amt], ['1107', 'K', amt]], topic: 'retur_jual',
      why: 'Retur & Potongan Penjualan (pengurang pendapatan) bertambah, DANA berkurang.', hint: 'Jangan kurangi Penjualan langsung.' };
  },
  sewaMuka: (s, r) => {
    let bulan = 6; if (gKasTotal_(s) < 1800000 + 300000) bulan = 3; const amt = bulan * 300000;
    const k = gKasDengan_(s, amt, r); if (!k) return null;
    return { teks: 'Bayar sewa lapak ' + bulan + ' bulan sekaligus Rp' + gRp_(amt).slice(2) + ' ' + G_KAS_NAMA[k] + ' (Rp300.000/bulan).', lines: [['1108', 'D', amt], [k, 'K', amt]], topic: 'sewa_muka',
      why: 'Belum terpakai, jadi aset Sewa Dibayar di Muka.', hint: 'Manfaatnya untuk beberapa bulan ke depan.' };
  },
  uangMuka: (s, r, st) => {
    if (st.pesanan) return null; const q = gInt_(r, 40, 80, 5); const amt = q * 15000;
    st.pesanan = { q: q, nilai: amt };
    return { teks: 'Panitia acara memesan ' + q + ' cup Medium (Rp15.000) dan membayar penuh Rp' + gRp_(amt).slice(2) + ' lewat QRIS. Acaranya beberapa hari lagi.', lines: [['1107', 'D', amt], ['2103', 'K', amt]], topic: 'uang_muka',
      why: 'Produk belum diserahkan → kewajiban: Pendapatan Diterima di Muka.', hint: 'Sudah dibayar, barang belum diserahkan.' };
  },
  serahPesanan: (s, r, st) => {
    if (!st.pesanan) return null; const p = st.pesanan; const hpp = p.q * 6000; if ((s['1105'] || 0) < hpp) return null;
    st.pesanan = null;
    return { teks: 'Hari acara: ' + p.q + ' cup Medium pesanan panitia diserahkan (harga pokok Rp6.000/cup).', lines: [['2103', 'D', p.nilai], ['4102', 'K', p.nilai], ['5001', 'D', hpp], ['1105', 'K', hpp]], topic: 'uang_muka',
      why: 'Kewajiban berubah menjadi Penjualan ' + p.nilai + '; HPP ' + hpp + '.', hint: 'Kewajibannya hilang, penjualan muncul.' };
  },
  bayarGaji: (s, r) => {
    const g = -(s['2102'] || 0); if (g <= 0) return null; const k = gKasDengan_(s, g, r); if (!k) return null;
    return { teks: 'Bayar gaji helper bulan lalu Rp' + gRp_(g).slice(2) + ' ' + G_KAS_NAMA[k] + '.', lines: [['2102', 'D', g], [k, 'K', g]], topic: 'gaji_utang',
      why: 'Utang Gaji lunas; bebannya sudah dicatat bulan lalu.', hint: 'Bebannya sudah dicatat.' };
  },
  // penyesuaian akhir bulan
  sewaTerpakai: (s) => (s['1108'] || 0) >= 300000 ? { teks: 'Akhir bulan: catat sewa lapak yang terpakai bulan ini (Rp300.000/bulan).', lines: [['5101', 'D', 300000], ['1108', 'K', 300000]], topic: 'sewa_sesuai',
    why: 'Bagian sewa bulan ini pindah dari aset ke Beban Sewa.', hint: 'Tidak ada uang keluar hari ini.' } : null,
  gajiTerutang: (s, r) => { const amt = gInt_(r, 400000, 700000, 50000); return { teks: 'Akhir bulan: gaji helper bulan ini Rp' + gRp_(amt).slice(2) + ' baru dibayar awal bulan depan.', lines: [['5103', 'D', amt], ['2102', 'K', amt]], topic: 'gaji_utang',
    why: 'Beban milik bulan ini dicatat sekarang sebagai Utang Gaji.', hint: 'Belum dibayar tapi sudah menjadi beban.' }; },
  penyusutan: (s) => (s['1201'] || 0) > 0 ? { teks: 'Akhir bulan: catat penyusutan peralatan Rp900.000 yang dipakai 3 tahun (tanpa nilai sisa).', lines: [['5104', 'D', 25000], ['1202', 'K', 25000]], topic: 'penyusutan',
    why: '900.000 ÷ 36 bulan = 25.000 per bulan.', hint: 'Harga ÷ jumlah bulan.' } : null,
  opname: (s, r) => { if ((s['1104'] || 0) < 60000) return null; const amt = gInt_(r, 10000, 40000, 5000); return { teks: 'Stok opname: bahan baku di catatan lebih besar Rp' + gRp_(amt).slice(2) + ' daripada hitungan fisik (ada jagung basi).', lines: [['5001', 'D', amt], ['1104', 'K', amt]], topic: 'opname',
    why: 'Catatan disesuaikan dengan fisik; selisih menjadi HPP.', hint: 'Persediaan berkurang.' }; }
};

/** Pemetaan topik lemah → kejadian kampanye untuk pengulangan. */
const G_ULANG = { prive: 'prive', utang: 'beliKredit', piutang: 'jualKredit', jual_hpp: 'jual', bahan: 'beliTunai', ongkir: 'ongkir', produksi: 'produksi',
  beban_tunai: 'promosi', transfer: 'setorBank', retur_jual: 'returJual', aset_tunai: 'promosi', laba_kotor: 'jual', opname: 'opname' };

function gPool_(bulan) {
  const dasar = { beliTunai: 2, beliKredit: 2, jual: 4, jualKredit: 1, terimaPiutang: 3, bayarUtang: 3, promosi: 1, prive: 1, setorBank: 1 };
  if (bulan >= 2) Object.assign(dasar, { ongkir: 1, returJual: 1 });
  if (bulan >= 3) Object.assign(dasar, { uangMuka: 1, serahPesanan: 3 });
  return dasar;
}

/** Bangun kejadian satu hari (deterministik dari seed). Mengubah salinan state. */
function gBuatHari_(k, weak) {
  const bulan = k.bulan, hari = k.hari;
  const r = gRng_(k.seed * 31 + bulan * 1009 + hari * 97);
  const s = JSON.parse(JSON.stringify(k.saldo));
  const st = { pesanan: k.pesanan || null };
  const evs = [];
  const add = (name, extra) => {
    const f = G_EVENTS[name]; if (!f) return false;
    const e = f(s, r, st); if (!e) return false;
    gApply_(s, e.lines); evs.push(Object.assign({ tipe: 'jurnal', src: name }, e, extra || {})); return true;
  };
  const acak = (n) => {
    const pool = gPool_(bulan); let tries = 0, got = 0;
    while (got < n && tries < 40) {
      tries++;
      const names = Object.keys(pool); const total = names.reduce((t, x) => t + pool[x], 0);
      let x = r() * total, pick = names[0];
      for (const nm of names) { x -= pool[nm]; if (x <= 0) { pick = nm; break; } }
      if (evs.some(e => e.src === pick) && pick !== 'jual') continue;
      if (add(pick)) got++;
    }
  };
  if (hari === 1 && bulan === 1) { add('modalAwal'); add('peralatan'); add('beliTunai'); }
  else if (hari === 2 && bulan === 1) { add('produksi') || add('beliTunai'); add('jual'); }
  else if (hari === 10) {
    acak(1);
    if (bulan >= 2) { add('sewaTerpakai'); add('gajiTerutang'); add('penyusutan'); add('opname'); }
  } else {
    if (bulan >= 2 && hari === 1) { add('bayarGaji'); }
    if (bulan === 2 && hari === 2) add('sewaMuka');
    if (bulan >= 3 && hari === 2 && (s['1108'] || 0) < 300000) add('sewaMuka');
    if (bulan === 2 && hari === 4) add('uangMuka');
    if (bulan === 2 && hari === 7) { if (!add('serahPesanan')) { add('produksi'); add('serahPesanan'); } }
    if (hari === 6) add('listrik');
    if ((s['1104'] || 0) < 300000) { add('beliTunai') || add('beliKredit'); }
    if ((s['1105'] || 0) < 300000) add('produksi');
    add('jual');
    acak(1);
    // pengulangan topik lemah (selang sehari)
    if (weak && weak.length && hari % 2 === 0) {
      for (const t of weak) { const nm = G_ULANG[t]; if (nm && add(nm, { ulang: true })) break; }
    }
  }
  // pesanan tertunda yang belum diserahkan sampai akhir bulan → serahkan di hari 10
  if (hari === 10 && st.pesanan) { if (!add('serahPesanan')) { add('produksi'); add('serahPesanan'); } }
  // pertanyaan rapor di hari ke-10
  if (hari === 10) {
    const laba = -Object.keys(s).filter(G_NOMINAL).reduce((t, x) => t + s[x], 0);
    const kas = gKasTotal_(s);
    evs.push({ tipe: 'angka', teks: 'Rapor akhir bulan ' + bulan + ': berapa laba (rugi) bersih kedai bulan ini? (rugi ditulis dengan tanda minus)', ans: laba, topic: 'laba_rugi',
      why: 'Laba bersih = pendapatan − HPP − beban bulan ini = ' + gRp_(laba) + '.' });
    evs.push({ tipe: 'angka', teks: 'Berapa total uang kedai (Kas + Bank + DANA/QRIS) di akhir bulan?', ans: kas, topic: 'kas_vs_laba',
      why: 'Jumlah saldo ketiga akun uang = ' + gRp_(kas) + '. Bandingkan dengan laba: keduanya jarang sama.' });
    evs.push(gPick_(r, [
      { tipe: 'pg', teks: 'Saat tutup buku, laba bulan ini dipindahkan ke…', opsi: ['Kas', 'Modal pemilik', 'Piutang', 'Penjualan'], ans: 1, topic: 'tutup_buku', why: 'Akun pendapatan, beban, dan prive ditutup ke Modal Pemilik.' },
      { tipe: 'pg', teks: 'Akun mana yang kembali ke nol setelah tutup buku?', opsi: ['Kas', 'Utang Usaha', 'Penjualan', 'Peralatan'], ans: 2, topic: 'tutup_buku', why: 'Akun nominal (pendapatan & beban) mulai dari nol tiap periode.' },
      { tipe: 'pg', teks: 'Laba bulan ini lebih besar dari kenaikan kas. Mana yang BUKAN penyebabnya?', opsi: ['Penjualan kredit', 'Membeli stok', 'Prive', 'Membayar listrik'], ans: 3, topic: 'kas_vs_laba', why: 'Listrik mengurangi laba dan kas sama besar, jadi tidak membuat keduanya berbeda.' }]));
  }
  return { evs: evs, saldoAkhir: s, pesanan: st.pesanan };
}

/* ------------------------------------------------------------------ */
/*  PROFIL PEMAIN (sheet Game)                                         */
/* ------------------------------------------------------------------ */
function gSheet_() {
  let sh = ss_().getSheetByName(GAME_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(GAME_SHEET);
    sh.getRange(1, 1, 1, 7).setValues([['Username', 'Nama', 'Poin total', 'Poin minggu', 'Minggu', 'Data (JSON)', 'Diperbarui']])
      .setBackground(COLOR.header).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(6, 300);
    try { sh.setTabColor('#F8961E'); protectWarning_(sh); } catch (e) { }
  }
  return sh;
}
function gWeekKey_() {
  const t = parseDateKey_(todayKey_());
  const dow = (Number(Utilities.formatDate(t, tz_(), 'u')) || 1); // 1=Senin
  return Utilities.formatDate(new Date(t.getTime() - (dow - 1) * 86400000), tz_(), 'yyyy-MM-dd');
}
function gNewProfile_(u) {
  return { v: 2, lvl: 1, nama: u.nama, avatar: '', kedai: '', koin: 0, poin: 0, poinMinggu: 0, minggu: gWeekKey_(), level: {}, badges: [], items: [], hidden: [],
    harian: { last: '', streak: 0, best: 0 }, stats: {}, total: { soal: 0, pertama: 0 }, kampanye: null, riwayat: [] };
}
function gLoad_(u) {
  const sh = gSheet_();
  const last = sh.getLastRow();
  if (last >= 2) {
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (str_(ids[i][0]).toLowerCase() === u.username) {
        const raw = sh.getRange(i + 2, 6).getValue();
        try { const p = JSON.parse(raw); p._row = i + 2; gRollWeek_(p); gMigrasi_(p); return p; } catch (e) { const p = gNewProfile_(u); p._row = i + 2; return p; }
      }
    }
  }
  const p = gNewProfile_(u); p._row = 0; return p;
}
function gRollWeek_(p) { const w = gWeekKey_(); if (p.minggu !== w) { p.minggu = w; p.poinMinggu = 0; } }
function gSave_(u, p) {
  const sh = gSheet_();
  const row = p._row || Math.max(1, sh.getLastRow()) + 1;
  const data = Object.assign({}, p); delete data._row;
  sh.getRange(row, 1, 1, 7).setValues([[u.username, safeText_(p.kedai || u.nama), p.poin, p.poinMinggu, p.minggu, JSON.stringify(data), new Date()]]);
  p._row = row;
}

/* ------------------------------------------------------------------ */
/*  API GAME                                                           */
/* ------------------------------------------------------------------ */
function gameAction_(action, d, u) {
  switch (action) {
    case 'hub': return gHub_(u);
    case 'profil': return gSetProfil_(u, d);
    case 'mulai': return gMulai_(u, d);
    case 'buka': return gBuka_(u, d);
    case 'kirim': return gKirim_(u, d);
    case 'beli': return gBeli_(u, d);
    case 'peringkat': return gPeringkat_(u);
    case 'pantau': if (u.peran !== PERAN.PEMILIK) throw new Error('Hanya Pemilik.'); return gPantau_();
    case 'kampanyeBaru': return gKampanyeBaru_(u);
    case 'setelan': return gSetelan_(u, d);
    case 'musik': return mList_().map(mPublic_);
    case 'musikAmbil': return mAmbil_(d);
    case 'musikTambah': mPemilik_(u); return mTambah_(u, d);
    case 'musikUbah': mPemilik_(u); return mUbah_(d);
    case 'musikHapus': mPemilik_(u); return mHapus_(d);
    default: throw new Error('Aksi game tidak dikenal.');
  }
}

function gSummary_(u, p) {
  const levels = G_LEVELS_();
  const lv = levels.map((L, i) => {
    const prev = i === 0 ? null : levels[i - 1].id;
    const unlocked = i === 0 || !!(p.level[prev] && p.level[prev].bintang > 0);
    return { id: L.id, dunia: L.dunia, nama: L.nama, n: L.qs.length, bintang: (p.level[L.id] || {}).bintang || 0, terbuka: unlocked, tutorial: !!L.tutorial };
  });
  const k = p.kampanye;
  return {
    user: { nama: u.nama, username: u.username, peran: u.peran },
    level: Object.assign(gLevel_(p.poin), { tier: gTier_(gLevel_(p.poin).lv), kedaiNama: G_KEDAI[gTier_(gLevel_(p.poin).lv) - 1].nama, max: G_LV_MAX }),
    kedaiTingkat: G_KEDAI,
    profil: { nama: p.nama, avatar: p.avatar, kedai: p.kedai, refund: p.refund || 0, koin: p.koin, poin: p.poin, poinMinggu: p.poinMinggu, items: p.items, hidden: p.hidden || [], badges: p.badges,
      harian: p.harian, akurasi: p.total.soal ? Math.round(p.total.pertama / p.total.soal * 100) : 0, siap: !!(p.kedai && p.avatar) },
    levels: lv, worlds: G_WORLDS,
    kampanye: k ? { bulan: k.bulan, hari: k.hari, kas: gKasTotal_(k.saldo), riwayat: (p.riwayat || []).slice(-6), aktif: true } : null,
    harianSudah: p.harian.last === todayKey_(),
    lemah: gWeak_(p).slice(0, 3).map(t => (G_TOPIC[t] || [t])[0]),
    toko: G_ITEMS, avatars: G_AVATARS, badgeDefs: G_BADGES, akun: G_ACC, today: todayKey_(),
    setelan: p.setelan || null, musik: mListAman_().map(mPublic_)
  };
}
function gHub_(u) { return gSummary_(u, gLoad_(u)); }

function gSetProfil_(u, d) {
  const p = gLoad_(u);
  const kedai = str_(d.kedai).slice(0, 30);
  if (!kedai) throw new Error('Beri nama kedaimu dulu.');
  if (G_AVATARS.indexOf(d.avatar) === -1) throw new Error('Pilih avatar.');
  p.kedai = kedai; p.avatar = d.avatar;
  if (d.hidden && Array.isArray(d.hidden)) p.hidden = d.hidden.filter(x => p.items.indexOf(x) !== -1);
  gSave_(u, p);
  return gSummary_(u, p);
}

function gWeak_(p) {
  return Object.keys(p.stats || {}).filter(t => { const s = p.stats[t]; return s.s > 0 && s.st < 2; })
    .sort((a, b) => (p.stats[b].s - p.stats[b].b) - (p.stats[a].s - p.stats[a].b));
}

function gKampanyeBaru_(u) {
  const p = gLoad_(u);
  p.kampanye = { seed: Math.floor(Math.random() * 1e9), bulan: 1, hari: 1, saldo: {}, pesanan: null, skorBulan: 0 };
  gSave_(u, p);
  return gSummary_(u, p);
}

/** Mulai sesi: level / hari kampanye / tantangan harian. */
function gMulai_(u, d) {
  const p = gLoad_(u);
  let qs = [], judul = '', intro = '', timer = 0, ref = '';
  if (d.mode === 'level') {
    const levels = G_LEVELS_();
    const idx = levels.findIndex(L => L.id === d.level);
    if (idx === -1) throw new Error('Level tidak ditemukan.');
    if (idx > 0 && !(p.level[levels[idx - 1].id] && p.level[levels[idx - 1].id].bintang > 0)) throw new Error('Selesaikan level sebelumnya dulu.');
    const L = levels[idx];
    qs = L.qs.map((q, i) => Object.assign({ id: L.id + '-' + i }, q));
    judul = L.nama; intro = L.intro || ''; ref = L.id;
  } else if (d.mode === 'hari') {
    if (!p.kampanye) { p.kampanye = { seed: Math.floor(Math.random() * 1e9), bulan: 1, hari: 1, saldo: {}, pesanan: null, skorBulan: 0 }; gSave_(u, p); }
    const k = p.kampanye;
    const day = gBuatHari_(k, gWeak_(p));
    qs = day.evs.map((q, i) => Object.assign({ id: 'B' + k.bulan + 'H' + k.hari + '-' + i }, q));
    judul = 'Bulan ' + k.bulan + ' · Hari ' + k.hari + (k.hari === 10 ? ' (akhir bulan)' : '');
    intro = k.hari === 10 ? 'Hari terakhir bulan ini: penyesuaian, lalu rapor.' : '';
    ref = k.bulan + '-' + k.hari;
    var pesanan = day.pesanan;
  } else if (d.mode === 'harian') {
    const r = gRng_(Number(todayKey_().replace(/-/g, '')) + u.username.length * 7919);
    const levels = G_LEVELS_();
    const done = levels.filter(L => p.level[L.id] && p.level[L.id].bintang > 0 && !L.tutorial);
    const pool = [];
    (done.length ? done : levels.slice(1, 3)).forEach(L => L.qs.forEach((q, i) => pool.push(Object.assign({ id: 'H-' + L.id + '-' + i }, q))));
    const weak = gWeak_(p);
    const pilih = [];
    weak.forEach(t => { const c = pool.filter(q => q.topic === t && pilih.indexOf(q) === -1); if (c.length && pilih.length < 2) pilih.push(gPick_(r, c)); });
    gShuffle_(r, pool).forEach(q => { if (pilih.length < 3 && pilih.indexOf(q) === -1) pilih.push(q); });
    qs = pilih.map(q => Object.assign({}, q, { ulang: weak.indexOf(q.topic) !== -1 }));
    judul = 'Tantangan harian'; timer = 60; ref = todayKey_();
  } else throw new Error('Mode tidak dikenal.');

  const salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const runId = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('grun:' + runId, JSON.stringify({ u: u.username, mode: d.mode, ref: ref, salt: salt, qs: qs, buka: {}, pesanan: d.mode === 'hari' ? (pesanan || null) : null }), G_RUN_TTL);
  return { runId: runId, mode: d.mode, judul: judul, intro: intro, timer: timer, salt: salt, qs: qs.map(q => gPublic_(q, salt)),
    kedai: d.mode === 'hari' ? { kas: gKasTotal_(p.kampanye.saldo) } : null };
}

function gRun_(u, runId) {
  const raw = CacheService.getScriptCache().get('grun:' + runId);
  if (!raw) throw new Error('Sesi permainan kedaluwarsa. Mulai lagi.');
  const run = JSON.parse(raw);
  if (run.u !== u.username) throw new Error('Sesi bukan milik Anda.');
  return run;
}

/** Lihat jawaban (tercatat, poin soal itu menjadi 0). */
function gBuka_(u, d) {
  const run = gRun_(u, d.runId);
  const q = run.qs.filter(x => x.id === d.qid)[0];
  if (!q) throw new Error('Soal tidak ditemukan.');
  run.buka[q.id] = true;
  CacheService.getScriptCache().put('grun:' + d.runId, JSON.stringify(run), G_RUN_TTL);
  return { lines: q.lines || null, ans: q.tipe === 'jurnal' ? null : q.ans, why: q.why || '' };
}

/** Kirim hasil satu sesi: dinilai ulang di server, lalu disimpan. */
function gKirim_(u, d) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const run = gRun_(u, d.runId);
    const p = gLoad_(u);
    const res = {}; (d.hasil || []).forEach(h => res[h.qid] = h);
    let poin = 0, max = 0, pertamaSemua = true, tanpaPetunjuk = true;
    const detail = run.qs.map(q => {
      const h = res[q.id] || {};
      const benar = gCanon_(q, h.jawab) === gKeyCanon_(q);
      const dibuka = !!run.buka[q.id];
      const coba = Math.max(1, Math.min(9, parseInt(h.coba, 10) || 1));
      const petunjuk = Math.max(0, Math.min(3, parseInt(h.petunjuk, 10) || 0));
      let pts = 0;
      if (benar && !dibuka) pts = Math.max(2, 10 - 3 * (coba - 1) - 2 * petunjuk);
      if (run.mode === 'harian' && pts && Number(h.ms) > 0 && Number(h.ms) < 20000) pts += 3;
      max += run.mode === 'harian' ? 13 : 10; poin += pts;
      const pertama = benar && !dibuka && coba === 1;
      if (!pertama) pertamaSemua = false;
      if (petunjuk) tanpaPetunjuk = false;
      // statistik topik (pengulangan berjarak)
      const st = p.stats[q.topic] || (p.stats[q.topic] = { b: 0, s: 0, st: 0 });
      if (pertama && !petunjuk) { st.b++; st.st++; } else { st.s++; st.st = 0; }
      p.total.soal++; if (pertama) p.total.pertama++;
      return { qid: q.id, benar: benar, poin: pts };
    });

    let koin = poin, bintang = 0, rapor = null, bonus = [];
    if (run.mode === 'level') {
      const pct = max ? poin / max : 0;
      bintang = pct >= 0.9 ? 3 : pct >= 0.7 ? 2 : 1;
      const lama = p.level[run.ref] || { bintang: 0, best: 0 };
      if (bintang > lama.bintang) { koin += (bintang - lama.bintang) * 10; bonus.push('Bonus bintang baru +' + (bintang - lama.bintang) * 10); }
      if (lama.bintang > 0) { koin = Math.round(koin / 2); }
      p.level[run.ref] = { bintang: Math.max(bintang, lama.bintang), best: Math.max(poin, lama.best || 0) };
      if (bintang === 3 && pertamaSemua && tanpaPetunjuk && run.qs.length >= 3) gBadge_(p, 'jitu', bonus);
    } else if (run.mode === 'hari') {
      const k = p.kampanye;
      if (!k || run.ref !== k.bulan + '-' + k.hari) throw new Error('Hari ini sudah disimpan sebelumnya.');
      // terapkan jawaban kunci ke kedai (bukan jawaban pemain)
      const s = k.saldo;
      run.qs.filter(q => q.tipe === 'jurnal').forEach(q => gApply_(s, q.lines));
      k.pesanan = run.pesanan || null;
      k.skorBulan = (k.skorBulan || 0) + poin;
      if (k.hari >= 10) {
        // rapor & tutup buku
        const pend = -((s['4102'] || 0) + (s['4101'] || 0) + (s['4103'] || 0));
        const hpp = s['5001'] || 0;
        const beban = Object.keys(s).filter(x => x.charAt(0) === '5' && x !== '5001').reduce((t, x) => t + s[x], 0);
        const laba = -Object.keys(s).filter(G_NOMINAL).reduce((t, x) => t + s[x], 0);
        const prive = s['3201'] || 0;
        rapor = { bulan: k.bulan, pendapatan: pend, hpp: hpp, beban: beban, laba: laba, prive: prive, kas: gKasTotal_(s), skor: k.skorBulan,
          aset: Object.keys(s).filter(x => x.charAt(0) === '1').reduce((t, x) => t + s[x], 0), utang: -Object.keys(s).filter(x => x.charAt(0) === '2').reduce((t, x) => t + s[x], 0) };
        s['3101'] = (s['3101'] || 0) + Object.keys(s).filter(G_NOMINAL).reduce((t, x) => t + s[x], 0) + prive;
        Object.keys(s).forEach(x => { if (G_NOMINAL(x) || x === '3201') delete s[x]; });
        rapor.modal = -(s['3101'] || 0);
        p.riwayat = (p.riwayat || []).concat([{ bulan: k.bulan, laba: laba, kas: rapor.kas, skor: k.skorBulan }]).slice(-24);
        koin += 50; bonus.push('Bonus tutup buku bulan ' + k.bulan + ' +50');
        if (k.bulan === 1) gBadge_(p, 'bulan1', bonus);
        if (k.bulan === 3) gBadge_(p, 'bulan3', bonus);
        k.bulan++; k.hari = 1; k.skorBulan = 0;
      } else k.hari++;
      Object.keys(s).forEach(x => { if (s[x] === 0) delete s[x]; });
    } else if (run.mode === 'harian') {
      if (p.harian.last === todayKey_()) { koin = 0; poin = 0; bonus.push('Tantangan hari ini sudah dimainkan; poin tidak dihitung lagi.'); }
      else {
        const kemarin = Utilities.formatDate(new Date(parseDateKey_(todayKey_()).getTime() - 86400000), tz_(), 'yyyy-MM-dd');
        p.harian.streak = p.harian.last === kemarin ? p.harian.streak + 1 : 1;
        p.harian.last = todayKey_();
        p.harian.best = Math.max(p.harian.best || 0, p.harian.streak);
        const b = Math.min(30, p.harian.streak * 5); koin += b; bonus.push('Bonus streak ' + p.harian.streak + ' hari +' + b);
        if (p.harian.streak >= 3) gBadge_(p, 'streak3', bonus);
        if (p.harian.streak >= 7) gBadge_(p, 'streak7', bonus);
      }
    }
    gCekLencana_(p, bonus);
    p.koin += koin; p.poin += poin; gRollWeek_(p); p.poinMinggu += poin;
    const levelUp = gNaikLevel_(p);
    if (levelUp) gCekLencana_(p, bonus);
    gSave_(u, p);
    CacheService.getScriptCache().remove('grun:' + d.runId);
    return { poin: poin, max: max, koin: koin, bintang: bintang, bonus: bonus, detail: detail, rapor: rapor, levelUp: levelUp, ringkas: gSummary_(u, p) };
  } finally { lock.releaseLock(); }
}

function gBadge_(p, id, bonus) {
  if (p.badges.indexOf(id) !== -1) return;
  p.badges.push(id);
  const b = G_BADGES.filter(x => x.id === id)[0];
  p.koin += 25;
  bonus.push('Lencana baru: ' + b.emoji + ' ' + b.nama + ' (+25 koin)');
}
function gCekLencana_(p, bonus) {
  const s = id => (p.level[id] || {}).bintang || 0;
  const rng = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push('L' + i); return r; };
  if (s('L0') > 0) gBadge_(p, 'pemula', bonus);
  if (rng(1, 9).every(x => s(x) >= 2)) gBadge_(p, 'dasar', bonus);
  if (rng(5, 9).every(x => s(x) >= 3)) gBadge_(p, 'dagang', bonus);
  if (rng(10, 12).every(x => s(x) >= 2)) gBadge_(p, 'akhirbulan', bonus);
  if (rng(13, 15).every(x => s(x) >= 2)) gBadge_(p, 'analis', bonus);
  if ((p.items || []).filter(x => G_ITEMS.some(it => it.id === x && !it.gratis)).length >= 5) gBadge_(p, 'kolektor', bonus);
}

function gBeli_(u, d) {
  const p = gLoad_(u);
  const it = G_ITEMS.filter(x => x.id === d.item)[0];
  if (!it) throw new Error('Barang tidak ada.');
  if (p.items.indexOf(it.id) !== -1) throw new Error('Sudah dimiliki.');
  if (it.gratis) throw new Error(it.nama + ' adalah hadiah naik ke Lv ' + it.lv + ', tidak dijual.');
  if (gLevel_(p.poin).lv < it.lv) throw new Error(it.nama + ' terbuka di Lv ' + it.lv + '.');
  if (p.koin < it.harga) throw new Error('Koin belum cukup.');
  p.koin -= it.harga; p.items.push(it.id);
  const bonus = []; gCekLencana_(p, bonus);
  gSave_(u, p);
  return Object.assign(gSummary_(u, p), { bonus: bonus });
}

function gPeringkat_(u) {
  const sh = gSheet_();
  const last = sh.getLastRow();
  const w = gWeekKey_();
  const aktif = {};
  readUsers_().forEach(x => { if (x.aktif) aktif[x.username] = x.nama; });
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 6).getValues() : [];
  const list = rows.filter(r => aktif[str_(r[0]).toLowerCase()] !== undefined).map(r => {
    let av = 'raka', kedai = '';
    try { const p = JSON.parse(r[5]); av = gAvatarId_(p.avatar) || 'raka'; kedai = p.kedai || ''; } catch (e) { }
    return { username: str_(r[0]).toLowerCase(), nama: aktif[str_(r[0]).toLowerCase()], kedai: kedai, avatar: av, lv: gLevel_(Number(r[2]) || 0).lv, total: Number(r[2]) || 0, minggu: str_(r[4]) === w ? Number(r[3]) || 0 : 0 };
  });
  return {
    minggu: list.slice().sort((a, b) => b.minggu - a.minggu), total: list.slice().sort((a, b) => b.total - a.total),
    saya: u.username, mingguMulai: w
  };
}

function gPantau_() {
  const sh = gSheet_();
  const last = sh.getLastRow();
  const users = {};
  readUsers_().forEach(x => users[x.username] = x);
  const rows = last >= 2 ? sh.getRange(2, 1, last - 1, 7).getValues() : [];
  return rows.map(r => {
    let p = {}; try { p = JSON.parse(r[5]); } catch (e) { }
    const levels = Object.keys(p.level || {});
    const lemah = Object.keys(p.stats || {}).filter(t => p.stats[t].s > 0 && p.stats[t].st < 2)
      .sort((a, b) => (p.stats[b].s - p.stats[b].b) - (p.stats[a].s - p.stats[a].b)).slice(0, 3).map(t => (G_TOPIC[t] || [t])[0]);
    const u = users[str_(r[0]).toLowerCase()] || {};
    return {
      nama: u.nama || str_(r[0]), username: str_(r[0]), kedai: p.kedai || '', avatar: gAvatarId_(p.avatar) || 'raka', lv: gLevel_(Number(r[2]) || 0).lv,
      level: levels.length, bintang: levels.reduce((t, k) => t + (p.level[k].bintang || 0), 0), poin: Number(r[2]) || 0,
      akurasi: p.total && p.total.soal ? Math.round(p.total.pertama / p.total.soal * 100) : 0, soal: p.total ? p.total.soal : 0,
      lemah: lemah, kampanye: p.kampanye ? 'Bulan ' + p.kampanye.bulan + ' · Hari ' + p.kampanye.hari : '–',
      streak: p.harian ? p.harian.streak : 0, badges: (p.badges || []).length,
      terakhir: r[6] instanceof Date ? Utilities.formatDate(r[6], tz_(), 'yyyy-MM-dd HH:mm') : str_(r[6])
    };
  }).sort((a, b) => b.poin - a.poin);
}


/* ------------------------------------------------------------------ */
/*  SETELAN GAME PER AKUN (musik, playlist, nama mentor)               */
/* ------------------------------------------------------------------ */
const G_MODE_MUSIK = ['auto', 'acak', 'satu'];
const G_EKSPRESI = ['netral', 'senang', 'pikir', 'kernyit', 'tepuk', 'jojo1', 'jojo2'];
function gSetelan_(u, d) {
  const s = d.setelan || {};
  const angka = (v, def) => { const n = Math.round(Number(v)); return isNaN(n) ? def : Math.max(0, Math.min(100, n)); };
  const ids = a => (Array.isArray(a) ? a : []).map(x => str_(x).slice(0, 20)).filter(x => /^[A-Za-z0-9_-]+$/.test(x)).slice(0, 80);
  const bersih = {
    vMus: angka(s.vMus, 70), vSfx: angka(s.vSfx, 80), getar: s.getar !== false,
    mode: G_MODE_MUSIK.indexOf(s.mode) !== -1 ? s.mode : 'auto', satu: ids([s.satu])[0] || '',
    off: ids(s.off), urut: ids(s.urut), mentor: str_(s.mentor).replace(/[<>]/g, '').slice(0, 20),
    emot: s.emot !== false, cerita: s.cerita ? 1 : 0, koleksi: ids(s.koleksi).filter(x => G_EKSPRESI.indexOf(x) !== -1)
  };
  const p = gLoad_(u);
  p.setelan = bersih;
  gSave_(u, p);
  return bersih;
}

/* ------------------------------------------------------------------ */
/*  MUSIK BERSAMA: file di Drive Pemilik, daftar di sheet "Musik"      */
/* ------------------------------------------------------------------ */
const MUSIK_SHEET = 'Musik';
const MUSIK_FOLDER = 'Kedai Jagung – Musik';
const MUSIK_MAX = 10 * 1024 * 1024;   // 10 MB per lagu
const MUSIK_PART = 1024 * 1024;       // dikirim ke HP per 1 MB
const MUSIK_LAYAR = ['menu', 'level', 'kampanye', 'tantangan', 'rapor'];

function mPemilik_(u) { if (u.peran !== PERAN.PEMILIK) throw new Error('Hanya Pemilik yang dapat mengelola lagu.'); }
function mSheet_(buat) {
  let sh = ss_().getSheetByName(MUSIK_SHEET);
  if (!sh && buat) {
    sh = ss_().insertSheet(MUSIK_SHEET);
    sh.getRange(1, 1, 1, 10).setValues([['ID', 'Judul', 'Artis', 'Layar', 'ID file Drive', 'Ukuran (byte)', 'Versi', 'Kredit', 'Ditambah oleh', 'Tanggal']])
      .setBackground(COLOR.header).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(8, 320);
    try { sh.setTabColor('#43AA8B'); protectWarning_(sh); } catch (e) { }
  }
  return sh;
}
function mFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MUSIK_FOLDER_ID');
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { } }
  const f = DriveApp.createFolder(MUSIK_FOLDER);
  props.setProperty('MUSIK_FOLDER_ID', f.getId());
  return f;
}
function mList_() {
  const sh = mSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues().map((r, i) => ({
    id: str_(r[0]), judul: str_(r[1]), artis: str_(r[2]), layar: MUSIK_LAYAR.indexOf(str_(r[3])) !== -1 ? str_(r[3]) : 'menu',
    fileId: str_(r[4]), ukuran: Number(r[5]) || 0, versi: Number(r[6]) || 1, kredit: str_(r[7]), oleh: str_(r[8]),
    tanggal: r[9] instanceof Date ? Utilities.formatDate(r[9], tz_(), 'yyyy-MM-dd') : str_(r[9]), row: i + 2
  })).filter(m => m.id && m.fileId);
}
function mListAman_() { try { return mList_(); } catch (e) { console.warn('musik: ' + e); return []; } }
function mPublic_(m) { return { id: m.id, judul: m.judul, artis: m.artis, layar: m.layar, ukuran: m.ukuran, versi: m.versi, kredit: m.kredit }; }
function mCari_(id) {
  const m = mList_().filter(x => x.id === str_(id))[0];
  if (!m) throw new Error('Lagu tidak ditemukan. Mungkin sudah dihapus Pemilik.');
  return m;
}
function mMeta_(d) {
  const judul = str_(d.judul).slice(0, 60), artis = str_(d.artis).slice(0, 60);
  if (!judul) throw new Error('Isi judul lagu.');
  const layar = MUSIK_LAYAR.indexOf(d.layar) !== -1 ? d.layar : 'menu';
  return { judul: judul, artis: artis, layar: layar, kredit: str_(d.kredit).slice(0, 300) };
}
function mDriveId_(link) {
  const s = str_(link);
  const m = s.match(/\/d\/([A-Za-z0-9_-]{20,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || s.match(/^([A-Za-z0-9_-]{20,})$/);
  if (!m) throw new Error('Link Google Drive tidak dikenali. Salin link dari tombol Bagikan di Drive.');
  return m[1];
}
function mTambah_(u, d) {
  const meta = mMeta_(d);
  const lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    const folder = mFolder_();
    let file;
    if (d.data) {
      const bytes = Utilities.base64Decode(String(d.data));
      if (bytes.length > MUSIK_MAX) throw new Error('Lagu lebih dari 10 MB. Kompres dulu (misalnya 128 kbps).');
      if (bytes.length < 1000) throw new Error('File lagu kosong atau rusak.');
      const nama = (str_(d.nama).replace(/[^\w.\- ]+/g, '').slice(0, 80) || meta.judul) .replace(/\.mp3$/i, '') + '.mp3';
      file = folder.createFile(Utilities.newBlob(bytes, 'audio/mpeg', nama));
    } else if (d.link) {
      let src;
      try { src = DriveApp.getFileById(mDriveId_(d.link)); }
      catch (e) { if (/tidak dikenali/.test(e.message)) throw e; throw new Error('Lagu tidak bisa dibuka. Atur aksesnya di Drive ke "Siapa saja yang memiliki link", lalu coba lagi.'); }
      const mime = String(src.getMimeType() || '');
      if (!/^audio\//.test(mime) && !/\.mp3$/i.test(src.getName())) throw new Error('File di link itu bukan lagu (MP3).');
      if (src.getSize() > MUSIK_MAX) throw new Error('Lagu lebih dari 10 MB. Kompres dulu (misalnya 128 kbps).');
      file = src.makeCopy(meta.judul + '.mp3', folder);
    } else throw new Error('Pilih file lagu atau tempel link Drive.');
    const id = 'M' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const sh = mSheet_(true);
    sh.getRange(Math.max(1, sh.getLastRow()) + 1, 1, 1, 10).setValues([[id, safeText_(meta.judul), safeText_(meta.artis), meta.layar, file.getId(), file.getSize(), 1, safeText_(meta.kredit), safeText_(u.nama), new Date()]]);
    return mList_().map(mPublic_);
  } finally { lock.releaseLock(); }
}
function mUbah_(d) {
  const m = mCari_(d.id), meta = mMeta_(d);
  mSheet_(false).getRange(m.row, 2, 1, 3).setValues([[safeText_(meta.judul), safeText_(meta.artis), meta.layar]]);
  mSheet_(false).getRange(m.row, 8).setValue(safeText_(meta.kredit));
  return mList_().map(mPublic_);
}
function mHapus_(d) {
  const lock = LockService.getDocumentLock(); lock.waitLock(20000);
  try {
    const m = mCari_(d.id);
    try { DriveApp.getFileById(m.fileId).setTrashed(true); } catch (e) { console.warn('hapus file musik: ' + e); }
    mSheet_(false).deleteRow(m.row);
    return mList_().map(mPublic_);
  } finally { lock.releaseLock(); }
}
/** Mengirim satu potongan (≤1 MB) file lagu ke HP pengguna. */
function mAmbil_(d) {
  const m = mCari_(d.id);
  const bytes = DriveApp.getFileById(m.fileId).getBlob().getBytes();
  const parts = Math.max(1, Math.ceil(bytes.length / MUSIK_PART));
  const i = Math.max(0, Math.min(parts - 1, Math.floor(Number(d.part) || 0)));
  return { id: m.id, versi: m.versi, part: i, parts: parts, ukuran: bytes.length, data: Utilities.base64Encode(bytes.slice(i * MUSIK_PART, (i + 1) * MUSIK_PART)) };
}

/** Jalankan sekali dari editor Apps Script untuk memberi izin Google Drive
 *  dan membuat folder musik. Hasilnya tampil di Log eksekusi. */
function izinkanDrive() {
  const f = mFolder_();
  Logger.log('Izin Google Drive aktif. Folder musik: ' + f.getName() + ' → ' + f.getUrl());
}