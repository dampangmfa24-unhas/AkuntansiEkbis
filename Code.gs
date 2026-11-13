/**
 * ============================================================================
 *  SISTEM AKUNTANSI LENGKAP — Google Apps Script
 *  Siklus: Chart of Accounts → Jurnal Umum → Buku Besar → Akun T → Neraca Saldo
 *          → Laba Rugi → Perubahan Modal → Posisi Keuangan → Arus Kas → Ringkasan
 *
 *  Fitur:
 *   • Aplikasi web (Index.html + Api.gs): login PIN, peran Pemilik/Pencatat,
 *     input Cepat & Jurnal, edit transaksi, laporan, kelola akun & pengaturan
 *   • Laporan disusun otomatis dari Chart of Accounts (akun baru langsung ikut)
 *   • Periode bulanan / setahun penuh, saldo awal dihitung otomatis
 *   • Validasi data (dropdown, tanggal, angka) + kontrol balance per transaksi
 *   • Ringkasan dengan grafik tren, komposisi beban, saldo kas
 *   • Email rekap bulanan (opsional lampiran PDF) & pengingat pencatatan
 *
 *  File proyek: Code.gs, Api.gs, Index.html
 *  Cara pasang: jalankan setupPertama() sekali, lalu lihat sheet "Petunjuk".
 * ============================================================================
 */

/* ------------------------------------------------------------------ */
/*  KONSTANTA                                                          */
/* ------------------------------------------------------------------ */

const SH = {
  PETUNJUK: 'Petunjuk',
  RINGKASAN: 'Ringkasan',
  JURNAL: 'Jurnal Umum',
  TEMPLATE: 'Template Transaksi',
  COA: 'Chart of Accounts',
  GL: 'General Ledger',
  TA: 'T Account',
  NS: 'Neraca Saldo',
  LR: 'Laba Rugi',
  PM: 'Perubahan Modal',
  PK: 'Posisi Keuangan',
  AK: 'Arus Kas',
  SET: 'Pengaturan',
  PENGGUNA: 'Pengguna',
  LOG: 'Log Aktivitas'
};
const SHEET_ORDER = [SH.PETUNJUK, SH.RINGKASAN, SH.JURNAL, SH.TEMPLATE, SH.COA, SH.GL, SH.TA,
  SH.NS, SH.LR, SH.PM, SH.PK, SH.AK, SH.SET, SH.PENGGUNA, SH.LOG];
const REPORT_SHEETS = [SH.GL, SH.TA, SH.NS, SH.LR, SH.PM, SH.PK, SH.AK];
const PDF_SHEETS = [SH.LR, SH.PM, SH.PK, SH.AK];

const COLOR = {
  title: '#17365D', section: '#1F4E78', header: '#D9EAF7', total: '#F2F2F2',
  final: '#E2F0D9', note: '#EAF2F8', sub: '#F5F9FC', input: '#0000FF', link: '#008000',
  sample: '#FFF8E1', bad: '#F8D7DA', badText: '#9C0006', good: '#D4EDDA', goodText: '#1E6B34',
  muted: '#666666', border: '#B7C9D9'
};
const FONT = 'Calibri';
const FMT_RP = '"Rp "#,##0;[Red]("Rp "#,##0);"-"';
const FMT_DATE = 'dd mmm yyyy';
const FMT_PCT = '0.0%;[Red]-0.0%;"-"';
const FMT_INT = '0';

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'];
const SETAHUN = 'Setahun penuh';
const BULAN_ARRAY = '{"' + BULAN.join('","') + '"}';

const JENIS = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense'];
const KLASIFIKASI = ['Aset Lancar', 'Aset Tidak Lancar', 'Liabilitas Jangka Pendek',
  'Liabilitas Jangka Panjang', 'Ekuitas', 'Pendapatan', 'Pendapatan Lain-lain',
  'Harga Pokok Penjualan', 'Beban Operasi', 'Beban Lain-lain'];
const KAT_AK = ['Operating', 'Investing', 'Financing'];
const KAT_AK_LABEL = {
  Operating: 'ARUS KAS DARI AKTIVITAS OPERASI',
  Investing: 'ARUS KAS DARI AKTIVITAS INVESTASI',
  Financing: 'ARUS KAS DARI AKTIVITAS PENDANAAN'
};
const KELOMPOK_KAS = 'Kas';
const SUMBER_CONTOH = 'CONTOH';

/* Jurnal Umum: baris pertama data & kolom */
const JU_HEADER_ROW = 7;
const JU_FIRST = 8;
const JU_COLS = 15; // A..O
/* Chart of Accounts: baris pertama data */
const COA_FIRST = 4;
/* Template Transaksi: baris pertama data */
const TPL_FIRST = 4;
/* Pengaturan */
const SET_ROWS = {
  nama: 4, email: 5, rekap: 6, tglRekap: 7, pdf: 8, pengingat: 9, hariPengingat: 10, jamPengingat: 11
};
const SET_PERIOD_ROW = 14; // B14 awal, B15 akhir, B16 label
const SET_AK_HEADER = 19;
const SET_AK_FIRST = 20;

/* Referensi rumus ke Jurnal Umum (rentang terbuka sampai bawah) */
const J = (col) => "'" + SH.JURNAL + "'!$" + col + '$' + JU_FIRST + ':$' + col;
const JR = {
  tgl: J('A'), id: J('B'), kode: J('D'), deb: J('F'), kre: J('G'),
  kat: J('H'), det: J('I'), kas: J('J'), jenis: J('M'), kel: J('N')
};
const IN_P = JR.tgl + ',">="&PERIODE_AWAL,' + JR.tgl + ',"<="&PERIODE_AKHIR';
const BEFORE_P = JR.tgl + ',"<"&PERIODE_AWAL';
const COA_TABLE = "'" + SH.COA + "'!$A$" + COA_FIRST + ':$F';
const GLC = (col, r) => "'" + SH.GL + "'!$" + col + '$' + r;

/* ------------------------------------------------------------------ */
/*  DATA DEFAULT (dagang / produksi) & CONTOH TRANSAKSI                */
/* ------------------------------------------------------------------ */

// [Kode, Nama, Jenis, Saldo Normal, Klasifikasi, Kelompok]
const DEFAULT_COA = [
  ['1101', 'Kas', 'Asset', 'Debit', 'Aset Lancar', 'Kas'],
  ['1102', 'Piutang Usaha', 'Asset', 'Debit', 'Aset Lancar', 'Piutang'],
  ['1103', 'Perlengkapan', 'Asset', 'Debit', 'Aset Lancar', 'Persediaan/Perlengkapan'],
  ['1104', 'Persediaan Bahan Baku', 'Asset', 'Debit', 'Aset Lancar', 'Persediaan'],
  ['1105', 'Persediaan Barang Jadi', 'Asset', 'Debit', 'Aset Lancar', 'Persediaan'],
  ['1106', 'Bank', 'Asset', 'Debit', 'Aset Lancar', 'Kas'],
  ['1107', 'DANA/QRIS', 'Asset', 'Debit', 'Aset Lancar', 'Kas'],
  ['1108', 'Sewa Dibayar di Muka', 'Asset', 'Debit', 'Aset Lancar', 'Dibayar di Muka'],
  ['1201', 'Peralatan', 'Asset', 'Debit', 'Aset Tidak Lancar', 'Aset Tetap'],
  ['1202', 'Akumulasi Penyusutan Peralatan', 'Asset', 'Credit', 'Aset Tidak Lancar', 'Aset Tetap'],
  ['2101', 'Utang Usaha', 'Liability', 'Credit', 'Liabilitas Jangka Pendek', 'Utang'],
  ['2102', 'Utang Gaji', 'Liability', 'Credit', 'Liabilitas Jangka Pendek', 'Utang'],
  ['2103', 'Pendapatan Diterima di Muka', 'Liability', 'Credit', 'Liabilitas Jangka Pendek', 'Diterima di Muka'],
  ['2201', 'Utang Bank', 'Liability', 'Credit', 'Liabilitas Jangka Panjang', 'Utang'],
  ['3101', 'Modal Pemilik', 'Equity', 'Credit', 'Ekuitas', 'Modal'],
  ['3201', 'Prive', 'Equity', 'Debit', 'Ekuitas', 'Prive'],
  ['4101', 'Pendapatan Jasa', 'Revenue', 'Credit', 'Pendapatan', 'Pendapatan Operasi'],
  ['4102', 'Penjualan', 'Revenue', 'Credit', 'Pendapatan', 'Pendapatan Operasi'],
  ['4103', 'Retur & Potongan Penjualan', 'Revenue', 'Debit', 'Pendapatan', 'Pengurang Pendapatan'],
  ['4201', 'Pendapatan Lain-lain', 'Revenue', 'Credit', 'Pendapatan Lain-lain', 'Pendapatan Lain'],
  ['5001', 'Harga Pokok Penjualan', 'Expense', 'Debit', 'Harga Pokok Penjualan', 'HPP'],
  ['5101', 'Beban Sewa', 'Expense', 'Debit', 'Beban Operasi', 'Beban'],
  ['5102', 'Beban Utilitas', 'Expense', 'Debit', 'Beban Operasi', 'Beban'],
  ['5103', 'Beban Gaji', 'Expense', 'Debit', 'Beban Operasi', 'Beban'],
  ['5104', 'Beban Penyusutan', 'Expense', 'Debit', 'Beban Operasi', 'Beban'],
  ['5105', 'Beban Pemasaran', 'Expense', 'Debit', 'Beban Operasi', 'Beban'],
  ['5201', 'Beban Lain-lain', 'Expense', 'Debit', 'Beban Lain-lain', 'Beban Lain']
];

// [Tanggal, ID, Deskripsi, Kode, Debit, Kredit, Kategori AK, Detail AK]
const SAMPLE_JURNAL = [
  ['2026-10-01', 'TRX001', 'Setoran modal awal pemilik', '1101', 100000000, 0, 'Financing', 'Setoran modal'],
  ['2026-10-01', 'TRX001', 'Setoran modal awal pemilik', '3101', 0, 100000000, '', ''],
  ['2026-10-02', 'TRX002', 'Pembayaran sewa', '5101', 12000000, 0, '', ''],
  ['2026-10-02', 'TRX002', 'Pembayaran sewa', '1101', 0, 12000000, 'Operating', 'Pembayaran sewa'],
  ['2026-10-03', 'TRX003', 'Pembelian peralatan tunai', '1201', 30000000, 0, '', ''],
  ['2026-10-03', 'TRX003', 'Pembelian peralatan tunai', '1101', 0, 30000000, 'Investing', 'Pembelian peralatan'],
  ['2026-10-04', 'TRX004', 'Pembelian perlengkapan tunai', '1103', 5000000, 0, '', ''],
  ['2026-10-04', 'TRX004', 'Pembelian perlengkapan tunai', '1101', 0, 5000000, 'Operating', 'Pembelian perlengkapan'],
  ['2026-10-05', 'TRX005', 'Pendapatan jasa tunai', '1101', 20000000, 0, 'Operating', 'Penerimaan pelanggan'],
  ['2026-10-05', 'TRX005', 'Pendapatan jasa tunai', '4101', 0, 20000000, '', ''],
  ['2026-10-06', 'TRX006', 'Pendapatan jasa secara kredit', '1102', 15000000, 0, '', ''],
  ['2026-10-06', 'TRX006', 'Pendapatan jasa secara kredit', '4101', 0, 15000000, '', ''],
  ['2026-10-07', 'TRX007', 'Penerimaan piutang pelanggan', '1101', 10000000, 0, 'Operating', 'Penerimaan pelanggan'],
  ['2026-10-07', 'TRX007', 'Penerimaan piutang pelanggan', '1102', 0, 10000000, '', ''],
  ['2026-10-08', 'TRX008', 'Pembayaran utilitas', '5102', 2000000, 0, '', ''],
  ['2026-10-08', 'TRX008', 'Pembayaran utilitas', '1101', 0, 2000000, 'Operating', 'Pembayaran utilitas'],
  ['2026-10-09', 'TRX009', 'Pembayaran gaji', '5103', 6000000, 0, '', ''],
  ['2026-10-09', 'TRX009', 'Pembayaran gaji', '1101', 0, 6000000, 'Operating', 'Pembayaran gaji'],
  ['2026-10-10', 'TRX010', 'Prive pemilik', '3201', 4000000, 0, '', ''],
  ['2026-10-10', 'TRX010', 'Prive pemilik', '1101', 0, 4000000, 'Financing', 'Prive'],
  ['2026-10-11', 'TRX011', 'Pembelian perlengkapan secara kredit', '1103', 3000000, 0, '', ''],
  ['2026-10-11', 'TRX011', 'Pembelian perlengkapan secara kredit', '2101', 0, 3000000, '', ''],
  ['2026-10-12', 'TRX012', 'Pembayaran utang usaha', '2101', 2000000, 0, '', ''],
  ['2026-10-12', 'TRX012', 'Pembayaran utang usaha', '1101', 0, 2000000, 'Operating', 'Pembayaran pemasok'],
  ['2026-10-13', 'TRX013', 'Pembelian bahan baku tunai', '1104', 4000000, 0, '', ''],
  ['2026-10-13', 'TRX013', 'Pembelian bahan baku tunai', '1101', 0, 4000000, 'Operating', 'Pembelian persediaan'],
  ['2026-10-14', 'TRX014', 'Pembelian bahan baku secara kredit', '1104', 2500000, 0, '', ''],
  ['2026-10-14', 'TRX014', 'Pembelian bahan baku secara kredit', '2101', 0, 2500000, '', ''],
  ['2026-10-15', 'TRX015', 'Pemakaian bahan baku untuk produksi', '1105', 5000000, 0, '', ''],
  ['2026-10-15', 'TRX015', 'Pemakaian bahan baku untuk produksi', '1104', 0, 5000000, '', ''],
  ['2026-10-18', 'TRX016', 'Penjualan produk tunai', '1101', 9000000, 0, 'Operating', 'Penerimaan pelanggan'],
  ['2026-10-18', 'TRX016', 'Penjualan produk tunai', '4102', 0, 9000000, '', ''],
  ['2026-10-18', 'TRX016', 'Penjualan produk tunai', '5001', 3000000, 0, '', ''],
  ['2026-10-18', 'TRX016', 'Penjualan produk tunai', '1105', 0, 3000000, '', ''],
  ['2026-10-20', 'TRX017', 'Penjualan produk secara kredit', '1102', 4000000, 0, '', ''],
  ['2026-10-20', 'TRX017', 'Penjualan produk secara kredit', '4102', 0, 4000000, '', ''],
  ['2026-10-20', 'TRX017', 'Penjualan produk secara kredit', '5001', 1400000, 0, '', ''],
  ['2026-10-20', 'TRX017', 'Penjualan produk secara kredit', '1105', 0, 1400000, '', ''],
  ['2026-10-22', 'TRX018', 'Setor kas ke bank', '1106', 10000000, 0, '', ''],
  ['2026-10-22', 'TRX018', 'Setor kas ke bank', '1101', 0, 10000000, '', ''],
  ['2026-10-25', 'TRX019', 'Biaya promosi media sosial (via bank)', '5105', 750000, 0, '', ''],
  ['2026-10-25', 'TRX019', 'Biaya promosi media sosial (via bank)', '1106', 0, 750000, 'Operating', 'Pembayaran beban operasional'],
  ['2026-10-31', 'TRX020', 'Penyusutan peralatan Oktober', '5104', 500000, 0, '', ''],
  ['2026-10-31', 'TRX020', 'Penyusutan peralatan Oktober', '1202', 0, 500000, '', '']
];

// [Nama, Debit 1, Kredit 1, Label Nominal 1, Debit 2, Kredit 2, Label Nominal 2, Kategori AK, Detail AK, Petunjuk]
const DEFAULT_TEMPLATES = [
  ['Penjualan tunai', 'PILIH:Kas', '4102', 'Nilai penjualan', '5001', '1105', 'Harga pokok barang terjual (opsional)', 'Operating', 'Penerimaan pelanggan', 'Uang masuk dari penjualan produk. Isi harga pokok agar stok barang jadi berkurang dan laba kotor terhitung.'],
  ['Penjualan kredit (belum dibayar)', '1102', '4102', 'Nilai penjualan', '5001', '1105', 'Harga pokok barang terjual (opsional)', '', '', 'Penjualan yang dibayar belakangan. Piutang bertambah.'],
  ['Pendapatan jasa tunai', 'PILIH:Kas', '4101', 'Nilai pendapatan', '', '', '', 'Operating', 'Penerimaan pelanggan', 'Pendapatan dari jasa yang dibayar tunai/transfer.'],
  ['Penerimaan piutang', 'PILIH:Kas', '1102', 'Jumlah diterima', '', '', '', 'Operating', 'Penerimaan pelanggan', 'Pelanggan melunasi penjualan kredit.'],
  ['Pembelian bahan baku tunai', '1104', 'PILIH:Kas', 'Jumlah pembelian', '', '', '', 'Operating', 'Pembelian persediaan', 'Beli bahan baku dan langsung dibayar.'],
  ['Pembelian bahan baku kredit', '1104', '2101', 'Jumlah pembelian', '', '', '', '', '', 'Beli bahan baku, dibayar belakangan. Utang usaha bertambah.'],
  ['Pemakaian bahan untuk produksi', '1105', '1104', 'Nilai bahan yang dipakai', '', '', '', '', '', 'Bahan baku diolah menjadi barang jadi (stok bahan berkurang, stok barang jadi bertambah).'],
  ['Pembelian perlengkapan tunai', '1103', 'PILIH:Kas', 'Jumlah pembelian', '', '', '', 'Operating', 'Pembelian perlengkapan', 'Beli perlengkapan habis pakai (kemasan, ATK, dll.).'],
  ['Bayar beban operasional', 'PILIH:Beban Operasi', 'PILIH:Kas', 'Jumlah dibayar', '', '', '', 'Operating', 'Pembayaran beban operasional', 'Pilih jenis bebannya (sewa, listrik, gaji, promosi, dll.).'],
  ['Bayar utang usaha', '2101', 'PILIH:Kas', 'Jumlah dibayar', '', '', '', 'Operating', 'Pembayaran pemasok', 'Melunasi utang ke pemasok.'],
  ['Beli peralatan tunai', '1201', 'PILIH:Kas', 'Harga peralatan', '', '', '', 'Investing', 'Pembelian peralatan', 'Beli aset tetap (mesin, kompor, freezer, dll.).'],
  ['Penyusutan peralatan', '5104', '1202', 'Nilai penyusutan', '', '', '', '', '', 'Dicatat tiap akhir bulan. Tidak ada uang keluar.'],
  ['Setoran modal pemilik', 'PILIH:Kas', '3101', 'Jumlah setoran', '', '', '', 'Financing', 'Setoran modal', 'Pemilik menambah modal usaha.'],
  ['Prive (ambil uang pribadi)', '3201', 'PILIH:Kas', 'Jumlah diambil', '', '', '', 'Financing', 'Prive', 'Pemilik mengambil uang usaha untuk keperluan pribadi.'],
  ['Terima pinjaman bank', 'PILIH:Kas', '2201', 'Jumlah pinjaman', '', '', '', 'Financing', 'Penerimaan pinjaman', 'Dana pinjaman masuk.'],
  ['Bayar cicilan pokok pinjaman', '2201', 'PILIH:Kas', 'Jumlah pokok', '', '', '', 'Financing', 'Pembayaran pinjaman', 'Untuk bunga, pakai "Bayar beban operasional" atau akun Beban Lain-lain.'],
  ['Pindah dana kas ↔ bank', 'PILIH:Kas', 'PILIH:Kas', 'Jumlah dipindahkan', '', '', '', '', '', 'Debit = akun tujuan, Kredit = akun asal. Tidak memengaruhi arus kas.']
].concat(TEMPLATES_V2_());

/** Template tambahan versi 2 (penyesuaian, pembelian, stok opname). Juga dipasang otomatis ke spreadsheet lama. */
function TEMPLATES_V2_() {
  return [
    ['Ongkos kirim pembelian bahan', '1104', 'PILIH:Kas', 'Ongkos kirim', '', '', '', 'Operating', 'Pembelian persediaan', 'Ongkos kirim/ojek untuk mengambil bahan menambah nilai persediaan bahan baku.'],
    ['Retur pembelian ke pemasok', '2101', '1104', 'Nilai barang dikembalikan', '', '', '', '', '', 'Bahan yang belum dibayar dikembalikan ke pemasok: utang dan persediaan berkurang.'],
    ['Bayar utang dengan potongan', '2101', 'PILIH:Kas', 'Jumlah dibayar', '2101', '1104', 'Potongan dari pemasok', 'Operating', 'Pembayaran pemasok', 'Isi uang yang benar-benar dibayar dan potongannya. Potongan mengurangi nilai persediaan.'],
    ['Potongan/retur penjualan tunai', '4103', 'PILIH:Kas', 'Uang dikembalikan', '', '', '', 'Operating', 'Penerimaan pelanggan', 'Uang dikembalikan ke pembeli (produk diretur atau diberi potongan setelah transaksi).'],
    ['Stok opname: stok kurang', '5001', 'PILIH:Persediaan', 'Nilai selisih (catatan − fisik)', '', '', '', '', '', 'Stok fisik lebih kecil dari catatan (basi, rusak, salah hitung). Selisih menjadi HPP.'],
    ['Prive barang (ambil produk)', '3201', '1105', 'Harga pokok produk diambil', '', '', '', '', '', 'Produk diambil untuk dimakan/dipakai pemilik. Dicatat sebesar harga pokok.'],
    ['Bayar sewa di muka', '1108', 'PILIH:Kas', 'Jumlah dibayar', '', '', '', 'Operating', 'Pembayaran sewa', 'Sewa untuk beberapa bulan sekaligus. Bebankan per bulan dengan "Penyesuaian: sewa terpakai".'],
    ['Penyesuaian: sewa terpakai', '5101', '1108', 'Sewa untuk bulan ini', '', '', '', '', '', 'Akhir bulan: pindahkan bagian sewa bulan ini dari aset ke beban. Tidak ada uang keluar.'],
    ['Terima uang muka pesanan', 'PILIH:Kas', '2103', 'Uang muka diterima', '', '', '', 'Operating', 'Penerimaan pelanggan', 'Pesanan dibayar sebelum produk diserahkan. Masih berupa kewajiban, belum pendapatan.'],
    ['Pesanan uang muka diserahkan', '2103', '4102', 'Nilai yang sudah dibayar di muka', '5001', '1105', 'Harga pokok barang (opsional)', '', '', 'Saat pesanan diserahkan: uang muka menjadi penjualan. Sisa pembayaran dicatat dengan template penjualan.'],
    ['Penyesuaian: gaji terutang', '5103', '2102', 'Gaji yang belum dibayar', '', '', '', '', '', 'Akhir bulan: gaji bulan ini yang baru dibayar bulan depan.'],
    ['Bayar utang gaji', '2102', 'PILIH:Kas', 'Jumlah dibayar', '', '', '', 'Operating', 'Pembayaran gaji', 'Melunasi gaji yang sudah dicatat dengan "Penyesuaian: gaji terutang".']
  ];
}

const UPGRADE_VERSION = 2;
const ACCOUNTS_V2 = ['1107', '1108', '2102', '2103'];

/**
 * Pembaruan otomatis untuk spreadsheet yang dipasang dengan versi sebelumnya:
 * menambah akun & template baru bila belum ada. Aman dijalankan berulang.
 */
function ensureUpgrades_() {
  const props = PropertiesService.getDocumentProperties();
  if (Number(props.getProperty('UPGRADE_V') || 0) >= UPGRADE_VERSION) return false;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) return false;
  try {
    if (Number(props.getProperty('UPGRADE_V') || 0) >= UPGRADE_VERSION) return false;
    let changed = false;
    const coaSh = sheet_(SH.COA);
    if (coaSh) {
      const have = {};
      readCoa_().forEach(a => have[a.kode] = true);
      const add = DEFAULT_COA.filter(a => ACCOUNTS_V2.indexOf(a[0]) !== -1 && !have[a[0]]);
      if (add.length) {
        const row = Math.max(COA_FIRST - 1, coaSh.getLastRow()) + 1;
        ensureSize_(coaSh, row + add.length + 10, 6);
        coaSh.getRange(row, 1, add.length, 1).setNumberFormat('@');
        coaSh.getRange(row, 1, add.length, 6).setValues(add.map(a => a.slice()));
        changed = true;
      }
    }
    const tplSh = sheet_(SH.TEMPLATE);
    if (tplSh) {
      const names = {};
      readTemplatesRaw_().forEach(t => names[str_(t[0]).toLowerCase()] = true);
      const add = TEMPLATES_V2_().filter(t => !names[t[0].toLowerCase()]);
      if (add.length) {
        const row = Math.max(TPL_FIRST - 1, tplSh.getLastRow()) + 1;
        ensureSize_(tplSh, row + add.length + 10, 10);
        tplSh.getRange(row, 2, add.length, 2).setNumberFormat('@');
        tplSh.getRange(row, 5, add.length, 2).setNumberFormat('@');
        tplSh.getRange(row, 1, add.length, 10).setValues(add);
        changed = true;
      }
    }
    if (changed) { SpreadsheetApp.flush(); rebuildReports_(); }
    props.setProperty('UPGRADE_V', String(UPGRADE_VERSION));
    return changed;
  } finally { lock.releaseLock(); }
}

// [Kategori, Detail]
const DEFAULT_AK_DETAILS = [
  ['Operating', 'Penerimaan pelanggan'],
  ['Operating', 'Pembayaran pemasok'],
  ['Operating', 'Pembelian persediaan'],
  ['Operating', 'Pembelian perlengkapan'],
  ['Operating', 'Pembayaran sewa'],
  ['Operating', 'Pembayaran utilitas'],
  ['Operating', 'Pembayaran gaji'],
  ['Operating', 'Pembayaran beban operasional'],
  ['Investing', 'Pembelian peralatan'],
  ['Investing', 'Penjualan aset tetap'],
  ['Financing', 'Setoran modal'],
  ['Financing', 'Prive'],
  ['Financing', 'Penerimaan pinjaman'],
  ['Financing', 'Pembayaran pinjaman']
];

const DEFAULT_SETTINGS = {
  nama: 'Usaha Saya', email: '', rekap: 'Ya', tglRekap: 1, pdf: 'Ya',
  pengingat: 'Ya', hariPengingat: 3, jamPengingat: 19
};

/* ------------------------------------------------------------------ */
/*  MENU & TRIGGER SEDERHANA                                           */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('💰 Keuangan')
    .addItem('🌐 Link Aplikasi', 'linkAplikasi')
    .addItem('👤 Atur PIN Pemilik', 'aturPinPemilik')
    .addSeparator()
    .addItem('🔄 Perbarui Struktur Laporan', 'perbaruiLaporan')
    .addItem('✅ Cek Jurnal & Integritas', 'cekIntegritas')
    .addItem('↕️ Urutkan Jurnal per Tanggal', 'urutkanJurnal')
    .addSeparator()
    .addItem('📧 Kirim Rekap Periode Terpilih Sekarang', 'kirimRekapSekarang')
    .addItem('⏰ Aktifkan Otomatisasi (email & pengingat)', 'aktifkanOtomatisasi')
    .addItem('⛔ Matikan Otomatisasi', 'matikanOtomatisasi')
    .addSeparator()
    .addItem('🧹 Hapus Data Contoh', 'hapusDataContoh')
    .addItem('⚙️ Setup / Perbaiki Template', 'setupTemplate')
    .addToUi();

  try {
    if (ss_().getSheetByName(SH.GL) && strukturBerubah_()) {
      ss_().toast('Chart of Accounts berubah sejak laporan terakhir disusun. Jalankan menu Keuangan → Perbarui Struktur Laporan.', 'Perlu diperbarui', 8);
    }
  } catch (err) { console.warn(err); }
}

/** Saat akun / daftar arus kas diubah, susun ulang laporan bila strukturnya berubah. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const name = e.range.getSheet().getName();
    if (name === SH.COA && e.range.getLastRow() >= COA_FIRST) {
      if (coaLengkap_()) maybeRebuild_();
    } else if (name === SH.SET && e.range.getLastRow() >= SET_AK_FIRST) {
      maybeRebuild_();
    }
  } catch (err) { console.warn(err); }
}

/** Trigger terpasang (onChange) untuk menangkap penghapusan / penyisipan baris akun. */
function onChangeHandler(e) {
  try {
    if (e && ['REMOVE_ROW', 'INSERT_ROW'].indexOf(e.changeType) === -1) return;
    if (coaLengkap_()) maybeRebuild_();
  } catch (err) { console.warn(err); }
}

/* ------------------------------------------------------------------ */
/*  UTILITAS                                                           */
/* ------------------------------------------------------------------ */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
function sheet_(name) { return ss_().getSheetByName(name); }
function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = str_(v).replace(/[^0-9,.\-]/g, '');
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}
function round2_(n) { return Math.round(n * 100) / 100; }
function dateKey_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = str_(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function parseDateKey_(key) { return Utilities.parseDate(key, tz_(), 'yyyy-MM-dd'); }
function todayKey_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function code_(v) {
  if (typeof v === 'number') return String(Math.round(v));
  return str_(v).replace(/^'/, '');
}
function txt_(v) { return "'" + v; } // paksa teks (mis. kode akun) saat ditulis lewat setValues
function rp_(n) {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-Rp ' : 'Rp ') + s;
}
function pad3_(n) { return ('000' + n).slice(-Math.max(3, String(n).length)); }

function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

/** Kosongkan sheet sepenuhnya (isi, format, merge, validasi, CF, grafik, proteksi). */
function resetSheet_(sh) {
  sh.getCharts().forEach(c => sh.removeChart(c));
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => { try { p.remove(); } catch (e) { } });
  const full = sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns());
  full.breakApart();
  full.clearDataValidations();
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setFrozenRows(0);
  sh.setFrozenColumns(0);
  sh.showColumns(1, sh.getMaxColumns());
  full.setFontFamily(FONT).setFontSize(11);
}

// Cache per pembangunan laporan: jangan memanggil getNamedRanges() untuk setiap baris.
let REPORT_NAMED_CACHE_ = null;
function setNamed_(name, range) {
  const ss = ss_();
  if (REPORT_NAMED_CACHE_) {
    const nr = REPORT_NAMED_CACHE_[name];
    if (nr && typeof nr.setRange === 'function') nr.setRange(range);
    else ss.setNamedRange(name, range);
    REPORT_NAMED_CACHE_[name] = REPORT_NAMED_CACHE_[name] || { created: true };
    return;
  }
  const nr = ss.getNamedRanges().filter(n => n.getName() === name)[0];
  if (nr) nr.setRange(range); else ss.setNamedRange(name, range);
}

function setWidths_(sh, widths) {
  widths.forEach((w, i) => { if (w) sh.setColumnWidth(i + 1, w); });
}

function protectWarning_(sh) {
  try { sh.protect().setDescription('Sheet laporan otomatis').setWarningOnly(true); } catch (e) { }
}

/* ------------------------------------------------------------------ */
/*  PEMBACA DATA                                                       */
/* ------------------------------------------------------------------ */

function readCoa_() {
  const sh = sheet_(SH.COA);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < COA_FIRST) return [];
  return sh.getRange(COA_FIRST, 1, last - COA_FIRST + 1, 6).getValues()
    .map(r => ({
      kode: code_(r[0]), nama: str_(r[1]), jenis: str_(r[2]), normal: str_(r[3]),
      klas: str_(r[4]), kel: str_(r[5])
    }))
    .filter(a => a.kode);
}

function coaLengkap_() {
  const sh = sheet_(SH.COA);
  if (!sh) return false;
  const last = sh.getLastRow();
  if (last < COA_FIRST) return true;
  const rows = sh.getRange(COA_FIRST, 1, last - COA_FIRST + 1, 5).getValues();
  return rows.every(r => {
    const filled = r.filter(v => str_(v) !== '').length;
    return filled === 0 || filled === 5;
  });
}

/** Baris jurnal mentah (kolom input saja). */
function readJurnal_() {
  const sh = sheet_(SH.JURNAL);
  if (!sh) return [];
  const max = sh.getMaxRows();
  if (max < JU_FIRST) return [];
  const cols = Math.min(15, sh.getMaxColumns());
  const vals = sh.getRange(JU_FIRST, 1, max - JU_FIRST + 1, cols).getValues()
    .map(r => { while (r.length < 15) r.push(''); return r; });
  const out = [];
  vals.forEach((r, i) => {
    const row = {
      row: JU_FIRST + i, date: r[0], dateKey: dateKey_(r[0]), id: str_(r[1]), desc: str_(r[2]),
      kode: code_(r[3]), debit: num_(r[5]), kredit: num_(r[6]), kat: str_(r[7]), det: str_(r[8]),
      sumber: str_(r[10]), oleh: str_(r[14]).toLowerCase()
    };
    if (row.id || row.kode || row.desc || row.debit || row.kredit) out.push(row);
  });
  return out;
}

function lastJurnalRow_() {
  const sh = sheet_(SH.JURNAL);
  const max = sh.getMaxRows();
  if (max < JU_FIRST) return JU_HEADER_ROW;
  const vals = sh.getRange(JU_FIRST, 1, max - JU_FIRST + 1, 7).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    if (str_(r[0]) || str_(r[1]) || str_(r[2]) || str_(r[3]) || str_(r[5]) || str_(r[6])) return JU_FIRST + i;
  }
  return JU_HEADER_ROW;
}

function readSettings_() {
  const sh = sheet_(SH.SET);
  const s = Object.assign({}, DEFAULT_SETTINGS);
  if (!sh || sh.getLastRow() < SET_ROWS.jamPengingat) return s;
  const v = sh.getRange(SET_ROWS.nama, 2, SET_ROWS.jamPengingat - SET_ROWS.nama + 1, 1).getValues().map(r => r[0]);
  const keys = Object.keys(SET_ROWS);
  keys.forEach(k => {
    const val = v[SET_ROWS[k] - SET_ROWS.nama];
    if (val !== '' && val !== null && val !== undefined) s[k] = val;
  });
  s.tglRekap = Math.min(28, Math.max(1, parseInt(s.tglRekap, 10) || 1));
  s.hariPengingat = Math.max(1, parseInt(s.hariPengingat, 10) || 3);
  s.jamPengingat = Math.min(23, Math.max(0, parseInt(s.jamPengingat, 10) || 19));
  return s;
}

function readAkDetails_() {
  const sh = sheet_(SH.SET);
  if (!sh || sh.getLastRow() < SET_AK_FIRST) return [];
  return sh.getRange(SET_AK_FIRST, 1, sh.getLastRow() - SET_AK_FIRST + 1, 2).getValues()
    .map(r => ({ kat: str_(r[0]), det: str_(r[1]) }))
    .filter(d => KAT_AK.indexOf(d.kat) !== -1 && d.det);
}

function readTemplates_() {
  const sh = sheet_(SH.TEMPLATE);
  if (!sh || sh.getLastRow() < TPL_FIRST) return [];
  return sh.getRange(TPL_FIRST, 1, sh.getLastRow() - TPL_FIRST + 1, 10).getValues()
    .map(r => ({
      nama: str_(r[0]), d1: code_(r[1]), k1: code_(r[2]), l1: str_(r[3]) || 'Nominal',
      d2: code_(r[4]), k2: code_(r[5]), l2: str_(r[6]) || 'Nominal 2',
      kat: str_(r[7]), det: str_(r[8]), help: str_(r[9])
    }))
    .filter(t => t.nama && t.d1 && t.k1);
}

/* ------------------------------------------------------------------ */
/*  SETUP                                                              */
/* ------------------------------------------------------------------ */

function setupTemplate() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.alert('Setup / Perbaiki Template',
    'Script akan menyusun semua sheet akuntansi.\n\n' +
    '• Data di Chart of Accounts, Jurnal Umum, Template Transaksi, dan Pengaturan yang sudah ada TETAP disimpan.\n' +
    '• Sheet laporan & Ringkasan disusun ulang.\n\nLanjutkan?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  setupCore_();
  ui.alert('Selesai ✅',
    'Template siap dipakai.\n\n' +
    '1. Catat transaksi lewat aplikasi web (menu 💰 Keuangan → 🌐 Link Aplikasi).\n' +
    '2. Atur PIN pemilik (menu 👤) lalu deploy aplikasi web — langkahnya ada di sheet Petunjuk.\n' +
    '3. Pilih bulan & tahun di sheet Ringkasan untuk melihat laporan di Sheets.\n\n' +
    'Data contoh (baris kuning) bisa dihapus lewat 🧹 Hapus Data Contoh.', ui.ButtonSet.OK);
}

/**
 * Jalankan SEKALI dari editor Apps Script (pilih fungsi ini → Run) setelah menempel script.
 * Setelah selesai, muat ulang spreadsheet; menu 💰 Keuangan akan muncul.
 */
function setupPertama() {
  setupCore_();
  console.log('Setup selesai. Muat ulang spreadsheet → menu 💰 Keuangan → 👤 Atur PIN Pemilik, lalu deploy sebagai Aplikasi web.');
}

function setupCore_() {
  const ss = ss_();
  const props = PropertiesService.getDocumentProperties();

  // 1. Kumpulkan data yang sudah ada
  const oldCoa = readCoa_();
  const oldJurnal = readJurnal_();
  const oldTemplates = sheet_(SH.TEMPLATE) ? readTemplatesRaw_() : [];
  const oldSettings = sheet_(SH.SET) ? readSettings_() : Object.assign({}, DEFAULT_SETTINGS);
  const oldAk = readAkDetails_();
  const oldPeriod = readPeriodSelection_();
  const oldUsers = sheet_(SH.PENGGUNA) ? readUsersRaw_() : [];
  const oldLog = sheet_(SH.LOG) && sheet_(SH.LOG).getLastRow() >= 4
    ? sheet_(SH.LOG).getRange(4, 1, sheet_(SH.LOG).getLastRow() - 3, 5).getValues() : [];

  // 2. Gabungkan Chart of Accounts
  let coa = oldCoa.map(a => [a.kode, a.nama, a.jenis, a.normal, a.klas, a.kel]);
  if (props.getProperty('COA_SEEDED') !== 'yes') {
    const have = {};
    coa.forEach(a => have[a[0]] = true);
    DEFAULT_COA.forEach(a => { if (!have[a[0]]) coa.push(a.slice()); });
    coa.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    props.setProperty('COA_SEEDED', 'yes');
  }

  // 3. Jurnal: pertahankan transaksi pengguna, sisipkan contoh bila masih tahap placeholder
  const sampleKey = {};
  SAMPLE_JURNAL.forEach(s => sampleKey[s[1] + '|' + s[2] + '|' + s[3]] = true);
  const isSample = r => r.sumber === SUMBER_CONTOH || sampleKey[r.id + '|' + r.desc + '|' + r.kode];
  const userRows = oldJurnal.filter(r => !isSample(r)).map(r => ({
    date: r.date, id: r.id, desc: r.desc, kode: r.kode, debit: r.debit, kredit: r.kredit,
    kat: r.kat, det: r.det, sumber: r.sumber, oleh: r.oleh
  }));
  const pakaiContoh = props.getProperty('SAMPLES_REMOVED') !== 'yes' &&
    (oldJurnal.length === 0 || oldJurnal.some(isSample));
  let rows = userRows;
  if (pakaiContoh) {
    const samples = SAMPLE_JURNAL.map(s => ({
      date: parseDateKey_(s[0]), id: s[1], desc: s[2], kode: s[3], debit: s[4], kredit: s[5],
      kat: s[6], det: s[7], sumber: SUMBER_CONTOH
    }));
    rows = samples.concat(userRows);
  }
  rows = sortRows_(rows);

  // 4. Detail arus kas: default + yang sudah dipakai di jurnal
  let ak = oldAk.length ? oldAk.map(d => [d.kat, d.det]) : DEFAULT_AK_DETAILS.map(d => d.slice());
  const akHave = {};
  ak.forEach(d => akHave[d[0] + '|' + d[1]] = true);
  rows.forEach(r => {
    if (KAT_AK.indexOf(r.kat) !== -1 && r.det && !akHave[r.kat + '|' + r.det]) {
      ak.push([r.kat, r.det]); akHave[r.kat + '|' + r.det] = true;
    }
  });

  // 5. Pastikan semua sheet ada (urutan), lalu isi
  ensureSheets_();
  buildPengaturan_(oldSettings, ak);
  buildCoa_(coa);
  buildJurnal_(rows);
  buildTemplateSheet_(oldTemplates.length ? oldTemplates : DEFAULT_TEMPLATES);
  buildPetunjuk_();
  buildPengguna_(oldUsers);
  buildLog_(oldLog);

  // Periode default: bulan transaksi terakhir (atau pilihan sebelumnya)
  let period = oldPeriod;
  if (!period) {
    const keys = rows.map(r => dateKey_(r.date)).filter(Boolean).sort();
    const k = keys.length ? keys[keys.length - 1] : todayKey_();
    period = { bulan: BULAN[parseInt(k.substr(5, 2), 10) - 1], tahun: parseInt(k.substr(0, 4), 10) };
  }
  rebuildReports_(period);
  props.setProperty('UPGRADE_V', String(UPGRADE_VERSION));
  cleanupDefaultSheets_();
  ss.setActiveSheet(sheet_(SH.RINGKASAN));
}

function ensureSheets_() {
  const ss = ss_();
  SHEET_ORDER.forEach((name, i) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  const tabs = {};
  tabs[SH.RINGKASAN] = '#1F4E78'; tabs[SH.JURNAL] = '#2E7D32'; tabs[SH.TEMPLATE] = '#2E7D32';
  tabs[SH.COA] = '#2E7D32'; tabs[SH.SET] = '#757575'; tabs[SH.PETUNJUK] = '#F9A825';
  tabs[SH.PENGGUNA] = '#757575'; tabs[SH.LOG] = '#757575';
  Object.keys(tabs).forEach(n => ss.getSheetByName(n).setTabColor(tabs[n]));
}

function cleanupDefaultSheets_() {
  const ss = ss_();
  ss.getSheets().forEach(sh => {
    const n = sh.getName();
    if (SHEET_ORDER.indexOf(n) === -1 && /^(Sheet|Lembar|Sheet ?\d+|Lembar ?\d+)$/i.test(n) && sh.getLastRow() === 0) {
      try { ss.deleteSheet(sh); } catch (e) { }
    }
  });
}

function sortRows_(rows) {
  return rows.map((r, i) => ({ r: r, i: i, k: dateKey_(r.date) || '9999-99-99' }))
    .sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : a.i - b.i))
    .map(x => x.r);
}

function readTemplatesRaw_() {
  const sh = sheet_(SH.TEMPLATE);
  if (!sh || sh.getLastRow() < TPL_FIRST) return [];
  return sh.getRange(TPL_FIRST, 1, sh.getLastRow() - TPL_FIRST + 1, 10).getValues()
    .filter(r => str_(r[0]))
    .map(r => r.map((v, i) => [1, 2, 4, 5].indexOf(i) !== -1 ? code_(v) : v));
}

function readPeriodSelection_() {
  const sh = sheet_(SH.RINGKASAN);
  if (!sh) return null;
  try {
    const b = str_(sh.getRange('B3').getValue());
    const t = parseInt(sh.getRange('B4').getValue(), 10);
    if ((BULAN.indexOf(b) !== -1 || b === SETAHUN) && t > 1900) return { bulan: b, tahun: t };
  } catch (e) { }
  return null;
}

/* ------------------------------------------------------------------ */
/*  SHEET: PENGATURAN                                                  */
/* ------------------------------------------------------------------ */

function buildPengaturan_(s, ak) {
  const sh = sheet_(SH.SET);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(200, SET_AK_FIRST + ak.length + 50), 4);
  const R = "'" + SH.RINGKASAN + "'!";

  const rows = [
    ['PENGATURAN', '', '', ''],
    ['Lebih mudah diubah dari aplikasi (Pengaturan). Bila mengubah di sini, jalankan menu Keuangan → Aktifkan Otomatisasi agar jadwal ikut berubah.', '', '', ''],
    ['PENGATURAN UMUM', '', '', ''],
    ['Nama usaha', s.nama, 'Dipakai di judul Ringkasan dan email.', ''],
    ['Email penerima rekap', s.email, 'Kosongkan = email akun Google pemilik script. Pisahkan beberapa email dengan koma.', ''],
    ['Kirim rekap bulanan', s.rekap, 'Ya/Tidak. Rekap bulan lalu dikirim otomatis.', ''],
    ['Tanggal kirim rekap (1–28)', s.tglRekap, 'Dikirim sekitar pukul 07.00.', ''],
    ['Lampirkan PDF laporan', s.pdf, 'Ya/Tidak. PDF berisi Laba Rugi, Perubahan Modal, Posisi Keuangan, Arus Kas.', ''],
    ['Pengingat pencatatan', s.pengingat, 'Ya/Tidak. Email bila lama tidak ada transaksi atau ada jurnal tidak balance.', ''],
    ['Ingatkan jika tidak ada transaksi selama (hari)', s.hariPengingat, '', ''],
    ['Jam cek pengingat (0–23)', s.jamPengingat, 'Pengingat dicek setiap hari pada jam ini.', ''],
    ['', '', '', ''],
    ['PERIODE LAPORAN (otomatis dari pilihan di Ringkasan — jangan diubah)', '', '', ''],
    ['Awal periode',
      '=IFERROR(IF(' + R + '$B$3="' + SETAHUN + '",DATE(' + R + '$B$4,1,1),DATE(' + R + '$B$4,MATCH(' + R + '$B$3,' + BULAN_ARRAY + ',0),1)),DATE(YEAR(TODAY()),MONTH(TODAY()),1))', '', ''],
    ['Akhir periode', '=IF(' + R + '$B$3="' + SETAHUN + '",DATE(YEAR(B14),12,31),EOMONTH(B14,0))', '', ''],
    ['Label periode', '=IF(' + R + '$B$3="' + SETAHUN + '","Tahun "&YEAR(B14),INDEX(' + BULAN_ARRAY + ',MONTH(B14))&" "&YEAR(B14))', '', ''],
    ['', '', '', ''],
    ['DETAIL ARUS KAS (sumber dropdown di Jurnal & dasar baris Laporan Arus Kas)', '', '', ''],
    ['Kategori', 'Detail Arus Kas', '', '']
  ];
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  if (ak.length) sh.getRange(SET_AK_FIRST, 1, ak.length, 2).setValues(ak);

  sh.getRange('A1:D1').merge().setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:D2').merge().setBackground(COLOR.note).setFontStyle('italic').setWrap(true);
  ['A3:D3', 'A13:D13', 'A18:D18'].forEach(a => sh.getRange(a).merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold'));
  sh.getRange('A19:B19').setBackground(COLOR.header).setFontWeight('bold');
  sh.getRange('B4:B11').setFontColor(COLOR.input).setHorizontalAlignment('left');
  sh.getRange('C4:C11').setFontColor(COLOR.muted).setFontStyle('italic').setWrap(true);
  sh.getRange('B14:B15').setNumberFormat(FMT_DATE).setFontColor(COLOR.link);
  sh.getRange('B16').setFontColor(COLOR.link);
  sh.getRange(SET_AK_FIRST, 1, sh.getMaxRows() - SET_AK_FIRST + 1, 2).setFontColor(COLOR.input);

  const yn = SpreadsheetApp.newDataValidation().requireValueInList(['Ya', 'Tidak'], true).setAllowInvalid(false).build();
  [SET_ROWS.rekap, SET_ROWS.pdf, SET_ROWS.pengingat].forEach(r => sh.getRange(r, 2).setDataValidation(yn));
  sh.getRange(SET_ROWS.tglRekap, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 28).setAllowInvalid(false).build());
  sh.getRange(SET_ROWS.hariPengingat, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 60).setAllowInvalid(false).build());
  sh.getRange(SET_ROWS.jamPengingat, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 23).setAllowInvalid(false).build());
  sh.getRange(SET_AK_FIRST, 1, sh.getMaxRows() - SET_AK_FIRST + 1, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(KAT_AK, true).setAllowInvalid(false).build());

  setWidths_(sh, [300, 260, 420, 40]);
  sh.setFrozenRows(1);

  setNamed_('NAMA_USAHA', sh.getRange(SET_ROWS.nama, 2));
  setNamed_('PERIODE_AWAL', sh.getRange(SET_PERIOD_ROW, 2));
  setNamed_('PERIODE_AKHIR', sh.getRange(SET_PERIOD_ROW + 1, 2));
  setNamed_('PERIODE_LABEL', sh.getRange(SET_PERIOD_ROW + 2, 2));
}

/* ------------------------------------------------------------------ */
/*  SHEET: CHART OF ACCOUNTS                                           */
/* ------------------------------------------------------------------ */

function buildCoa_(coa) {
  const sh = sheet_(SH.COA);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(300, coa.length + 100), 6);
  const max = sh.getMaxRows();

  sh.getRange('A1:F1').merge().setValue('CHART OF ACCOUNTS (DAFTAR AKUN)')
    .setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:F2').merge()
    .setValue('Tambah akun di baris kosong paling bawah (isi kelima kolom pertama). Laporan otomatis menyesuaikan. Kelompok "Kas" = akun kas/bank untuk Laporan Arus Kas. Akun kontra (mis. Akumulasi Penyusutan) pakai Saldo Normal kebalikan jenisnya.')
    .setBackground(COLOR.note).setFontStyle('italic').setWrap(true);
  sh.setRowHeight(2, 36);
  sh.getRange('A3:F3').setValues([['Kode Akun', 'Nama Akun', 'Jenis Akun', 'Saldo Normal', 'Klasifikasi Laporan', 'Kelompok']])
    .setBackground(COLOR.header).setFontWeight('bold');

  sh.getRange(COA_FIRST, 1, max - COA_FIRST + 1, 1).setNumberFormat('@');
  if (coa.length) {
    sh.getRange(COA_FIRST, 1, coa.length, 6).setValues(coa.map(a => a.map(v => str_(v))));
  }
  sh.getRange(COA_FIRST, 1, max - COA_FIRST + 1, 6).setFontColor(COLOR.input);

  const dv = (list) => SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  const n = max - COA_FIRST + 1;
  sh.getRange(COA_FIRST, 3, n, 1).setDataValidation(dv(JENIS));
  sh.getRange(COA_FIRST, 4, n, 1).setDataValidation(dv(['Debit', 'Credit']));
  sh.getRange(COA_FIRST, 5, n, 1).setDataValidation(dv(KLASIFIKASI));

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND($A' + COA_FIRST + '<>"",COUNTIF($A$' + COA_FIRST + ':$A,$A' + COA_FIRST + ')>1)')
      .setBackground(COLOR.bad).setFontColor(COLOR.badText)
      .setRanges([sh.getRange(COA_FIRST, 1, n, 6)]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$F' + COA_FIRST + '="' + KELOMPOK_KAS + '"')
      .setBackground('#EEF7EE')
      .setRanges([sh.getRange(COA_FIRST, 1, n, 6)]).build()
  ];
  sh.setConditionalFormatRules(rules);
  sh.getRange('A3').setNote('Kode harus unik. Baris merah = kode ganda.');
  sh.getRange('F3').setNote('Isi "Kas" untuk akun kas & bank. Kelompok lain bebas (untuk pengelompokan).');
  setWidths_(sh, [100, 260, 110, 100, 190, 180]);
  sh.setFrozenRows(3);
}

/* ------------------------------------------------------------------ */
/*  SHEET: JURNAL UMUM                                                 */
/* ------------------------------------------------------------------ */

function buildJurnal_(rows) {
  const sh = sheet_(SH.JURNAL);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(1000, JU_FIRST + rows.length + 500), JU_COLS);
  const max = sh.getMaxRows();
  const n = max - JU_FIRST + 1;

  sh.getRange('A1:L1').merge().setValue('JURNAL UMUM')
    .setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:L2').merge()
    .setValue('Cara termudah: catat lewat aplikasi web (menu 💰 Keuangan → 🌐 Link Aplikasi). Mengetik langsung juga boleh: satu transaksi = beberapa baris dengan ID sama, total Debit = total Kredit. Kolom hijau terisi otomatis.')
    .setBackground(COLOR.note).setFontStyle('italic').setWrap(true);
  sh.setRowHeight(2, 36);
  sh.getRange('A3:G3').merge().setValue('KONTROL JURNAL')
    .setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange('A4:G4').setValues([['Total Debit', 'Total Kredit', 'Selisih', 'Status',
    'Transaksi tidak balance', 'Kode tidak dikenal', 'Baris tidak lengkap']])
    .setBackground(COLOR.header).setFontWeight('bold').setWrap(true);
  const L = JU_FIRST;
  sh.getRange('A5:G5').setFormulas([[
    '=SUM(F' + L + ':F)', '=SUM(G' + L + ':G)', '=ROUND(A5-B5,2)',
    '=IF(AND(C5=0,E5=0,F5=0,G5=0),"BALANCE","PERIKSA")',
    '=IFERROR(COUNTUNIQUE(FILTER(B' + L + ':B,B' + L + ':B<>"",L' + L + ':L<>0)),0)',
    '=COUNTIF(E' + L + ':E,"Kode tidak ditemukan")',
    '=COUNTIFS(D' + L + ':D,"<>",A' + L + ':A,"")+COUNTIFS(D' + L + ':D,"<>",B' + L + ':B,"")+COUNTIFS(B' + L + ':B,"<>",D' + L + ':D,"")'
  ]]).setFontWeight('bold');
  sh.getRange('A5:C5').setNumberFormat(FMT_RP);
  sh.getRange('E5:G5').setNumberFormat(FMT_INT).setHorizontalAlignment('center');
  sh.getRange('D5').setHorizontalAlignment('center');

  sh.getRange(JU_HEADER_ROW, 1, 1, JU_COLS).setValues([['Tanggal', 'ID Transaksi', 'Deskripsi', 'Kode Akun',
    '', 'Debit (Rp)', 'Kredit (Rp)', 'Kategori Arus Kas', 'Detail Arus Kas', '',
    'Sumber', '', '', '', 'Dicatat oleh']])
    .setBackground(COLOR.header).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');

  // Format kolom
  sh.getRange(L, 1, n, 1).setNumberFormat(FMT_DATE);
  sh.getRange(L, 4, n, 1).setNumberFormat('@');
  sh.getRange(L, 6, n, 2).setNumberFormat(FMT_RP);
  sh.getRange(L, 10, n, 1).setNumberFormat(FMT_RP);
  sh.getRange(L, 12, n, 1).setNumberFormat(FMT_RP);
  sh.getRange(L, 1, n, 4).setFontColor(COLOR.input);
  sh.getRange(L, 6, n, 4).setFontColor(COLOR.input);
  sh.getRange(L, 11, n, 1).setFontColor(COLOR.muted);
  sh.getRange(L, 15, n, 1).setFontColor(COLOR.muted);
  sh.getRange(L, 5, n, 1).setFontColor(COLOR.link);
  sh.getRange(L, 10, n, 1).setFontColor(COLOR.link);
  sh.getRange(L, 12, n, 3).setFontColor(COLOR.link);

  // Data
  writeJurnalRows_(sh, rows, L);

  // Kolom otomatis: ARRAYFORMULA ditaruh di baris judul agar tidak hilang bila baris data dihapus
  const coaA = "'" + SH.COA + "'!$A$" + COA_FIRST + ':$A';
  const coaCol = c => "'" + SH.COA + "'!$" + c + '$' + COA_FIRST + ':$' + c;
  const H = JU_HEADER_ROW;
  const af = (title, expr) => '={"' + title + '";ARRAYFORMULA(' + expr + ')}';
  sh.getRange(H, 5).setFormula(af('Nama Akun', 'IF(D' + L + ':D="","",IFERROR(VLOOKUP(D' + L + ':D&"",{' + coaA + '&"",' + coaCol('B') + '},2,FALSE),"Kode tidak ditemukan"))'));
  sh.getRange(H, 10).setFormula(af('Perubahan Kas (Rp)', 'IF(D' + L + ':D="","",IF(N' + L + ':N="' + KELOMPOK_KAS + '",IFERROR(F' + L + ':F-G' + L + ':G,0),0))'));
  sh.getRange(H, 12).setFormula(af('Cek Balance', 'IF(B' + L + ':B="","",ROUND(SUMIF(B' + L + ':B,B' + L + ':B,F' + L + ':F)-SUMIF(B' + L + ':B,B' + L + ':B,G' + L + ':G),2))'));
  sh.getRange(H, 13).setFormula(af('Jenis (bantu)', 'IF(D' + L + ':D="","",IFERROR(VLOOKUP(D' + L + ':D&"",{' + coaA + '&"",' + coaCol('C') + '},2,FALSE),""))'));
  sh.getRange(H, 14).setFormula(af('Kelompok (bantu)', 'IF(D' + L + ':D="","",IFERROR(VLOOKUP(D' + L + ':D&"",{' + coaA + '&"",' + coaCol('F') + '},2,FALSE),""))'));

  // Validasi
  const coaSh = sheet_(SH.COA);
  const setSh = sheet_(SH.SET);
  sh.getRange(L, 1, n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireDate()
    .setAllowInvalid(false).setHelpText('Isi tanggal, mis. 26/10/2026').build());
  sh.getRange(L, 4, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(coaSh.getRange('A' + COA_FIRST + ':A'), true).setAllowInvalid(true)
    .setHelpText('Pilih kode dari Chart of Accounts').build());
  sh.getRange(L, 6, n, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).setHelpText('Angka ≥ 0').build());
  sh.getRange(L, 8, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(KAT_AK, true).setAllowInvalid(false)
    .setHelpText('Isi hanya pada baris akun kas/bank').build());
  sh.getRange(L, 9, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(setSh.getRange('B' + SET_AK_FIRST + ':B'), true).setAllowInvalid(true)
    .setHelpText('Daftar detail ada di sheet Pengaturan').build());

  // Format bersyarat
  const all = sh.getRange(L, 1, n, 12);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($B' + L + '<>"",$L' + L + '<>0)')
      .setBackground(COLOR.bad).setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Kode tidak ditemukan')
      .setFontColor(COLOR.badText).setBold(true).setRanges([sh.getRange(L, 5, n, 1)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($N' + L + '="' + KELOMPOK_KAS + '",$H' + L + '="",$L' + L + '=0,$B' + L + '<>"")')
      .setBackground('#FFF3CD').setRanges([sh.getRange(L, 8, n, 2)]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$K' + L + '="' + SUMBER_CONTOH + '"')
      .setBackground(COLOR.sample).setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('BALANCE')
      .setBackground(COLOR.good).setFontColor(COLOR.goodText).setRanges([sh.getRange('D5')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PERIKSA')
      .setBackground(COLOR.bad).setFontColor(COLOR.badText).setRanges([sh.getRange('D5')]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0)
      .setBackground(COLOR.bad).setFontColor(COLOR.badText).setRanges([sh.getRange('E5:G5')]).build()
  ]);

  sh.getRange('H' + JU_HEADER_ROW).setNote('Isi hanya pada baris akun kas/bank (kelompok "Kas"). Sel kuning = baris kas yang belum diklasifikasi.');
  sh.getRange('L' + JU_HEADER_ROW).setNote('Selisih debit–kredit per ID transaksi. Harus 0; baris merah = transaksi belum balance.');
  sh.getRange('K' + JU_HEADER_ROW).setNote('CONTOH = data contoh/tutorial (bisa dihapus lewat menu). Form = dari form input.');

  setWidths_(sh, [100, 100, 260, 90, 200, 130, 130, 120, 190, 130, 80, 100, 90, 110, 140]);
  sh.setRowHeight(4, 36);
  sh.setFrozenRows(JU_HEADER_ROW);
  sh.hideColumns(13, 2);

  setNamed_('JU_SELISIH', sh.getRange('C5'));
  setNamed_('JU_TRX_TIDAK_BALANCE', sh.getRange('E5'));
  setNamed_('JU_KODE_TIDAK_DIKENAL', sh.getRange('F5'));
  setNamed_('JU_BARIS_TIDAK_LENGKAP', sh.getRange('G5'));
}

/** Tulis baris jurnal ke kolom input saja (A–D, F–I, K) — kolom rumus tidak disentuh. */
function writeJurnalRows_(sh, rows, startRow) {
  if (!rows.length) return;
  ensureSize_(sh, startRow + rows.length + 50, JU_COLS);
  const t = v => /^[=+\-@]/.test(str_(v)) ? "'" + str_(v) : (v === undefined || v === null ? '' : v);
  const ad = rows.map(r => [r.date instanceof Date ? r.date : (dateKey_(r.date) ? parseDateKey_(dateKey_(r.date)) : r.date),
    t(r.id), t(r.desc), code_(r.kode)]);
  const fi = rows.map(r => [r.debit || 0, r.kredit || 0, r.kat || '', t(r.det)]);
  const k = rows.map(r => [r.sumber || '']);
  const o = rows.map(r => [r.oleh || '']);
  sh.getRange(startRow, 4, rows.length, 1).setNumberFormat('@');
  sh.getRange(startRow, 1, rows.length, 4).setValues(ad);
  sh.getRange(startRow, 6, rows.length, 4).setValues(fi);
  sh.getRange(startRow, 11, rows.length, 1).setValues(k);
  sh.getRange(startRow, 15, rows.length, 1).setValues(o);
}

/** Kosongkan kolom input jurnal (tanpa menyentuh rumus). */
function clearJurnalInputs_(sh) {
  const n = sh.getMaxRows() - JU_FIRST + 1;
  if (n <= 0) return;
  sh.getRange(JU_FIRST, 1, n, 4).clearContent();
  sh.getRange(JU_FIRST, 6, n, 4).clearContent();
  sh.getRange(JU_FIRST, 11, n, 1).clearContent();
  if (sh.getMaxColumns() >= 15) sh.getRange(JU_FIRST, 15, n, 1).clearContent();
}

/* ------------------------------------------------------------------ */
/*  SHEET: TEMPLATE TRANSAKSI                                          */
/* ------------------------------------------------------------------ */

function buildTemplateSheet_(tpls) {
  const sh = sheet_(SH.TEMPLATE);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(150, tpls.length + 60), 10);
  sh.getRange('A1:J1').merge().setValue('TEMPLATE TRANSAKSI (untuk Input Cepat)')
    .setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:J2').merge().setValue(
    'Setiap baris = satu pilihan di form Input Cepat. Isi kolom akun dengan kode akun, atau "PILIH:<filter>" agar akun dipilih saat input. ' +
    'Filter dicocokkan ke Jenis / Klasifikasi / Kelompok, mis. PILIH:Kas, PILIH:Beban Operasi, PILIH:Expense. "PILIH" saja = semua akun. ' +
    'Pasangan 2 (opsional) dipakai untuk HPP pada penjualan. Kategori/Detail arus kas otomatis ditempel ke baris akun kas.')
    .setBackground(COLOR.note).setFontStyle('italic').setWrap(true);
  sh.setRowHeight(2, 52);
  sh.getRange(3, 1, 1, 10).setValues([['Nama Transaksi', 'Debit 1', 'Kredit 1', 'Label Nominal 1',
    'Debit 2', 'Kredit 2', 'Label Nominal 2', 'Kategori Arus Kas', 'Detail Arus Kas', 'Petunjuk']])
    .setBackground(COLOR.header).setFontWeight('bold');
  const max = sh.getMaxRows();
  sh.getRange(TPL_FIRST, 2, max - TPL_FIRST + 1, 2).setNumberFormat('@');
  sh.getRange(TPL_FIRST, 5, max - TPL_FIRST + 1, 2).setNumberFormat('@');
  if (tpls.length) sh.getRange(TPL_FIRST, 1, tpls.length, 10).setValues(tpls.map(t => t.map(v => str_(v))));
  sh.getRange(TPL_FIRST, 1, max - TPL_FIRST + 1, 10).setFontColor(COLOR.input).setVerticalAlignment('top');
  sh.getRange(TPL_FIRST, 10, max - TPL_FIRST + 1, 1).setWrap(true).setFontColor(COLOR.muted);
  sh.getRange(TPL_FIRST, 8, max - TPL_FIRST + 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(KAT_AK, true).setAllowInvalid(false).build());
  sh.getRange(TPL_FIRST, 9, max - TPL_FIRST + 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(sheet_(SH.SET).getRange('B' + SET_AK_FIRST + ':B'), true).setAllowInvalid(true).build());
  setWidths_(sh, [230, 140, 140, 190, 90, 90, 230, 120, 200, 380]);
  sh.setFrozenRows(3);
}

/* ------------------------------------------------------------------ */
/*  PENYUSUN LAPORAN (builder sederhana)                               */
/* ------------------------------------------------------------------ */

function Report_(sheetName, width, widths) {
  this.sh = sheet_(sheetName);
  this.w = width;
  this.widths = widths;
  this.rows = [];
}
Report_.prototype.add = function (cells, style, name, nameCol) {
  this.rows.push({ cells: cells || [], style: style || 'line', name: name, nameCol: nameCol });
  return this.rows.length; // nomor baris (mulai 1)
};
Report_.prototype.blank = function () { return this.add([], 'blank'); };
Report_.prototype.next = function () { return this.rows.length + 1; };
Report_.prototype.flush = function (moneyCols, extra) {
  const sh = this.sh, w = this.w, n = this.rows.length;
  resetSheet_(sh);
  ensureSize_(sh, n + 20, w);
  const vals = this.rows.map(r => {
    const a = r.cells.slice(0, w);
    while (a.length < w) a.push('');
    return a;
  });
  sh.getRange(1, 1, n, w).setValues(vals);
  const groups = {};
  this.rows.forEach((r, i) => { (groups[r.style] = groups[r.style] || []).push(i + 1); });
  const rl = rowsList => sh.getRangeList(rowsList.map(r => 'A' + r + ':' + colL_(w) + r));
  const merge = rowsList => rowsList.forEach(r => sh.getRange(r, 1, 1, w).merge());
  if (groups.title) { merge(groups.title); rl(groups.title).setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14); }
  if (groups.period) { merge(groups.period); rl(groups.period).setFontStyle('italic').setFontColor(COLOR.muted); }
  if (groups.section) { merge(groups.section); rl(groups.section).setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold'); }
  if (groups.header) rl(groups.header).setBackground(COLOR.header).setFontWeight('bold');
  if (groups.sub) rl(groups.sub).setBackground(COLOR.sub).setFontWeight('bold').setFontStyle('italic');
  if (groups.total) rl(groups.total).setBackground(COLOR.total).setFontWeight('bold');
  if (groups.final) rl(groups.final).setBackground(COLOR.final).setFontWeight('bold');
  if (groups.note) { merge(groups.note); rl(groups.note).setFontStyle('italic').setFontColor(COLOR.muted).setWrap(true); }
  (moneyCols || []).forEach(c => {
    sh.getRange(3, c, n, 1).setNumberFormat(FMT_RP);
    if (groups.line) sh.getRangeList(groups.line.map(r => colL_(c) + r)).setFontColor(COLOR.link);
  });
  if (extra) extra(sh, groups);
  setWidths_(sh, this.widths);
  this.rows.forEach((r, i) => { if (r.name) setNamed_(r.name, sh.getRange(i + 1, r.nameCol || w)); });
  protectWarning_(sh);
  return sh;
};

function colL_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const PERIOD_TITLE = '="Untuk periode "&PERIODE_LABEL&"  |  Rupiah (Rp)  |  Ubah periode di sheet Ringkasan"';
const PERIOD_AS_OF = '="Per "&DAY(PERIODE_AKHIR)&" "&INDEX(' + BULAN_ARRAY + ',MONTH(PERIODE_AKHIR))&" "&YEAR(PERIODE_AKHIR)&"  |  Rupiah (Rp)"';

/* ------------------------------------------------------------------ */
/*  SUSUN ULANG LAPORAN                                                */
/* ------------------------------------------------------------------ */

function perbaruiLaporan() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    rebuildReports_();
    ss_().toast('Struktur laporan sudah diperbarui sesuai Chart of Accounts.', 'Selesai', 5);
  } finally { lock.releaseLock(); }
}

function maybeRebuild_() {
  if (!strukturBerubah_()) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(2000)) return;
  try {
    rebuildReports_();
    ss_().toast('Laporan disusun ulang mengikuti perubahan akun / detail arus kas.', 'Laporan diperbarui', 4);
  } finally { lock.releaseLock(); }
}

/*
 * PENYEGARAN LAPORAN TERTUNDA
 * Satu trigger sekali pakai menangani beberapa perubahan yang terjadi berdekatan.
 * Perubahan COA langsung tersimpan; spreadsheet laporan dapat tertinggal selama
 * beberapa menit. Bila penjadwalan gagal, menu Perbarui Struktur Laporan tetap ada.
 */
const REPORT_PENDING_KEY_ = 'REPORT_PENDING_V1';
const REPORT_ERROR_KEY_ = 'REPORT_ERROR_V1';
const REPORT_RETRY_KEY_ = 'REPORT_RETRY_V1';
const REPORT_TRIGGER_FN_ = 'processPendingReports_';
const REPORT_DELAY_MS_ = 60000;

function reportRefreshStatus_() {
  const p = PropertiesService.getDocumentProperties();
  return { pending: !!p.getProperty(REPORT_PENDING_KEY_),
    scheduled: !p.getProperty(REPORT_ERROR_KEY_), error: p.getProperty(REPORT_ERROR_KEY_) || '' };
}

function scheduledReportTriggers_() {
  return ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === REPORT_TRIGGER_FN_);
}

function scheduleReportRefresh_() {
  if (scheduledReportTriggers_().length) return true;
  // after() adalah batas waktu MINIMUM; bukan janji tepat satu menit.
  ScriptApp.newTrigger(REPORT_TRIGGER_FN_).timeBased().after(REPORT_DELAY_MS_).create();
  return true;
}

/** Simpan status menunggu dulu; kegagalan memasang trigger tidak membatalkan akun. */
function queueReportRefresh_() {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty(REPORT_PENDING_KEY_, Utilities.getUuid());
  props.deleteProperty(REPORT_RETRY_KEY_);
  try {
    scheduleReportRefresh_();
    props.deleteProperty(REPORT_ERROR_KEY_);
    return { pending: true, scheduled: true, error: '' };
  } catch (e) {
    const msg = String((e && e.message) || e);
    props.setProperty(REPORT_ERROR_KEY_, msg);
    console.error('Gagal menjadwalkan laporan: ' + msg);
    return { pending: true, scheduled: false, error: msg };
  }
}

/**
 * Fungsi trigger, bukan dipanggil dari halaman web.
 * Beri lock agar tidak menyusun laporan saat akun sedang disimpan.
 */
function processPendingReports_() {
  const props = PropertiesService.getDocumentProperties();
  const lock = LockService.getDocumentLock();
  let acquired = false;
  try {
    acquired = lock.tryLock(20000);
    if (!acquired) return;
    if (!props.getProperty(REPORT_PENDING_KEY_)) return;
    const start = Date.now();
    rebuildReports_();
    props.deleteProperty(REPORT_RETRY_KEY_);
    props.deleteProperty(REPORT_ERROR_KEY_);
    console.log('Laporan selesai di-refresh: ' + (Date.now() - start) + ' ms');
  } catch (e) {
    const msg = String((e && e.message) || e);
    props.setProperty(REPORT_ERROR_KEY_, msg);
    props.setProperty(REPORT_RETRY_KEY_, String(Number(props.getProperty(REPORT_RETRY_KEY_) || 0) + 1));
    console.error('Refresh laporan gagal: ' + msg);
  } finally {
    if (acquired) lock.releaseLock();
    // Hapus trigger satu-kali-pakai; kosongkan slot sebelum retry.
    try { scheduledReportTriggers_().forEach(t => ScriptApp.deleteTrigger(t)); }
    catch (e) { console.error('Gagal membersihkan trigger: ' + e); }
    const retries = Number(props.getProperty(REPORT_RETRY_KEY_) || 0);
    if (props.getProperty(REPORT_PENDING_KEY_) && retries < 3) {
      try { scheduleReportRefresh_(); }
      catch (e) { props.setProperty(REPORT_ERROR_KEY_, String(e)); }
    }
  }
}

/** Opsional: jalankan sekali dari editor untuk memberi izin pembuatan trigger. */
function installFastReportRefresh() {
  const ok = scheduleReportRefresh_();
  console.log('Trigger refresh laporan siap: ' + ok);
  return ok;
}

function signatureFrom_(coa, ak) {
  const c = coa.map(a => [a.kode, a.jenis, a.normal, a.klas, a.kel].join('~'));
  const details = ak.map(d => d.kat + '~' + d.det);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, c.join('|') + '#' + details.join('|')));
}
function signature_() { return signatureFrom_(readCoa_(), readAkDetails_()); }
function strukturBerubah_() {
  return PropertiesService.getDocumentProperties().getProperty('STRUCT_SIG') !== signature_();
}

function rebuildReports_(period) {
  const coa = readCoa_();
  const ak = readAkDetails_();
  const sel = period || readPeriodSelection_() || { bulan: BULAN[new Date().getMonth()], tahun: new Date().getFullYear() };
  // Ambil semua named ranges sekali, bukan puluhan kali selama menyusun laporan.
  REPORT_NAMED_CACHE_ = {};
  ss_().getNamedRanges().forEach(n => { REPORT_NAMED_CACHE_[n.getName()] = n; });
  try {
    const gl = buildGL_(coa);
    buildTA_(coa, gl);
    buildNS_(coa, gl);
    buildLR_(coa, gl);
    buildPM_(coa, gl);
    buildPK_(coa, gl);
    buildAK_(coa, gl, ak);
    buildRingkasan_(coa, gl, sel);
    const props = PropertiesService.getDocumentProperties();
    props.setProperty('STRUCT_SIG', signatureFrom_(coa, ak));
    props.deleteProperty(REPORT_PENDING_KEY_);
    props.deleteProperty(REPORT_ERROR_KEY_);
  } finally {
    REPORT_NAMED_CACHE_ = null;
  }
}

/* ---------- General Ledger ---------- */
function buildGL_(coa) {
  const R = new Report_(SH.GL, 8, [90, 260, 100, 100, 160, 150, 150, 160]);
  R.add(['GENERAL LEDGER / BUKU BESAR'], 'title');
  R.add([PERIOD_TITLE], 'period');
  R.add(['Kode Akun', 'Nama Akun', 'Jenis Akun', 'Saldo Normal', 'Saldo Awal Periode (Rp)',
    'Debit Periode (Rp)', 'Kredit Periode (Rp)', 'Saldo Akhir (Rp)'], 'header');
  const rowOf = {};
  const first = R.next();
  coa.forEach(a => {
    const r = R.next();
    rowOf[a.kode] = r;
    R.add([
      txt_(a.kode),
      '=IFERROR(VLOOKUP($A' + r + ',' + COA_TABLE + ',2,FALSE),"")',
      '=IFERROR(VLOOKUP($A' + r + ',' + COA_TABLE + ',3,FALSE),"")',
      '=IFERROR(VLOOKUP($A' + r + ',' + COA_TABLE + ',4,FALSE),"")',
      '=IF(OR($C' + r + '="Revenue",$C' + r + '="Expense"),0,IF($D' + r + '="Credit",-1,1)*(SUMIFS(' + JR.deb + ',' + JR.kode + ',$A' + r + ',' + BEFORE_P + ')-SUMIFS(' + JR.kre + ',' + JR.kode + ',$A' + r + ',' + BEFORE_P + ')))',
      '=SUMIFS(' + JR.deb + ',' + JR.kode + ',$A' + r + ',' + IN_P + ')',
      '=SUMIFS(' + JR.kre + ',' + JR.kode + ',$A' + r + ',' + IN_P + ')',
      '=E' + r + '+IF($D' + r + '="Credit",G' + r + '-F' + r + ',F' + r + '-G' + r + ')'
    ], 'line');
  });
  // Laba ditahan: akumulasi laba/rugi sebelum awal periode (agar neraca saldo & posisi keuangan seimbang)
  const ld = R.next();
  const nb = (col, jenis) => 'SUMIFS(' + col + ',' + JR.jenis + ',"' + jenis + '",' + BEFORE_P + ')';
  R.add(['LD', 'Laba ditahan (laba/rugi s.d. awal periode)', 'Equity', 'Credit',
    '=(' + nb(JR.kre, 'Revenue') + '+' + nb(JR.kre, 'Expense') + ')-(' + nb(JR.deb, 'Revenue') + '+' + nb(JR.deb, 'Expense') + ')',
    0, 0, '=E' + ld], 'line');
  const last = ld;
  R.add(['', 'TOTAL MUTASI PERIODE', '', '', '', '=SUM(F' + first + ':F' + last + ')', '=SUM(G' + first + ':G' + last + ')', ''], 'total');
  R.blank();
  R.add(['Saldo dalam arah saldo normal akun. Akun pendapatan & beban dimulai dari 0 setiap periode; laba periode sebelumnya masuk ke baris Laba ditahan (LD).'], 'note');
  R.flush([5, 6, 7, 8], sh => {
    sh.getRange(first, 1, last - first + 1, 1).setHorizontalAlignment('left');
    sh.setFrozenRows(3);
  });
  return { rowOf: rowOf, ld: ld, first: first, last: last };
}

/* ---------- T Account ---------- */
function buildTA_(coa, gl) {
  const sh = sheet_(SH.TA);
  resetSheet_(sh);
  const per = 3, bw = 4, bh = 6;
  const blocks = Math.ceil(coa.length / per);
  const nRows = 3 + blocks * bh;
  ensureSize_(sh, nRows + 10, per * bw);
  const vals = [];
  for (let i = 0; i < nRows; i++) vals.push(new Array(per * bw).fill(''));
  vals[0][0] = 'T ACCOUNT — RINGKASAN DEBIT / KREDIT PER AKUN';
  vals[1][0] = PERIOD_TITLE;
  const titles = [], heads = [], totals = [], lines = [];
  coa.forEach((a, idx) => {
    const br = 3 + Math.floor(idx / per) * bh; // 0-based baris judul blok
    const bc = (idx % per) * bw;
    const g = gl.rowOf[a.kode];
    const debitSide = a.normal !== 'Credit';
    vals[br][bc] = '=' + GLC('A', g) + '&" — "&' + GLC('B', g);
    vals[br + 1][bc] = 'DEBIT'; vals[br + 1][bc + 2] = 'KREDIT';
    const so = debitSide ? bc : bc + 2;
    vals[br + 2][so] = 'Saldo awal'; vals[br + 2][so + 1] = '=' + GLC('E', g);
    vals[br + 3][bc] = 'Mutasi'; vals[br + 3][bc + 1] = '=' + GLC('F', g);
    vals[br + 3][bc + 2] = 'Mutasi'; vals[br + 3][bc + 3] = '=' + GLC('G', g);
    vals[br + 4][so] = 'Saldo akhir'; vals[br + 4][so + 1] = '=' + GLC('H', g);
    titles.push([br + 1, bc + 1]); heads.push([br + 2, bc + 1]); lines.push([br + 3, bc + 1]); totals.push([br + 5, bc + 1]);
  });
  sh.getRange(1, 1, nRows, per * bw).setValues(vals);
  sh.getRange(1, 1, 1, per * bw).merge().setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange(2, 1, 1, per * bw).merge().setFontStyle('italic').setFontColor(COLOR.muted);
  titles.forEach(p => sh.getRange(p[0], p[1], 1, bw).merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold'));
  heads.forEach(p => {
    sh.getRange(p[0], p[1], 1, 2).merge(); sh.getRange(p[0], p[1] + 2, 1, 2).merge();
    sh.getRange(p[0], p[1], 1, bw).setBackground(COLOR.header).setFontWeight('bold').setHorizontalAlignment('center');
  });
  lines.forEach(p => {
    sh.getRange(p[0], p[1], 3, bw).setBorder(null, null, null, null, true, null, COLOR.border, SpreadsheetApp.BorderStyle.SOLID);
    sh.getRange(p[0], p[1] + 1, 3, 1).setNumberFormat(FMT_RP).setFontColor(COLOR.link);
    sh.getRange(p[0], p[1] + 3, 3, 1).setNumberFormat(FMT_RP).setFontColor(COLOR.link);
  });
  totals.forEach(p => sh.getRange(p[0], p[1], 1, bw).setBackground(COLOR.total).setFontWeight('bold')
    .setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID));
  for (let c = 1; c <= per * bw; c++) sh.setColumnWidth(c, c % 2 === 1 ? 95 : 140);
  protectWarning_(sh);
}

/* ---------- Neraca Saldo ---------- */
function buildNS_(coa, gl) {
  const R = new Report_(SH.NS, 4, [90, 300, 170, 170]);
  R.add(['NERACA SALDO'], 'title');
  R.add(['="Per "&DAY(PERIODE_AKHIR)&" "&INDEX(' + BULAN_ARRAY + ',MONTH(PERIODE_AKHIR))&" "&YEAR(PERIODE_AKHIR)&"  |  akun nominal = mutasi "&PERIODE_LABEL'], 'period');
  R.add(['Kode Akun', 'Nama Akun', 'Saldo Debit (Rp)', 'Saldo Kredit (Rp)'], 'header');
  const first = R.next();
  const glRows = coa.map(a => gl.rowOf[a.kode]).concat([gl.ld]);
  glRows.forEach(g => {
    const dt = 'IF(' + GLC('D', g) + '="Credit",-1,1)*' + GLC('H', g);
    R.add(['=' + GLC('A', g), '=' + GLC('B', g), '=MAX(' + dt + ',0)', '=MAX(-(' + dt + '),0)'], 'line');
  });
  const last = R.next() - 1;
  const tot = R.add(['TOTAL', '', '=SUM(C' + first + ':C' + last + ')', '=SUM(D' + first + ':D' + last + ')'], 'total');
  R.blank();
  R.add(['KONTROL'], 'section');
  R.add(['Selisih Debit − Kredit', '', '=ROUND(C' + tot + '-D' + tot + ',2)', '=IF(C' + (tot + 3) + '=0,"BALANCE","PERIKSA")'], 'final', 'NS_SELISIH', 3);
  R.flush([3, 4], sh => sh.setFrozenRows(3));
}

/* ---------- Laba Rugi ---------- */
function buildLR_(coa, gl) {
  const R = new Report_(SH.LR, 3, [90, 340, 180]);
  R.add(['LAPORAN LABA RUGI'], 'title');
  R.add([PERIOD_TITLE], 'period');
  R.blank();
  const credit = g => '=' + GLC('G', g) + '-' + GLC('F', g); // arah kredit
  const debit = g => '=' + GLC('F', g) + '-' + GLC('G', g);  // arah debit

  const section = (title, accounts, valueFn, totalLabel, totalName) => {
    R.add([title], 'section');
    R.add(['Kode', 'Uraian', 'Jumlah (Rp)'], 'header');
    const f = R.next();
    if (!accounts.length) R.add(['', '(belum ada akun dengan klasifikasi ini)', 0], 'line');
    accounts.forEach(a => {
      const g = gl.rowOf[a.kode];
      R.add(['=' + GLC('A', g), '=' + GLC('B', g), valueFn(g, a)], 'line');
    });
    const l = R.next() - 1;
    const t = R.add(['', totalLabel, '=SUM(C' + f + ':C' + l + ')'], 'total', totalName);
    R.blank();
    return t;
  };
  const rev = coa.filter(a => a.jenis === 'Revenue');
  const exp = coa.filter(a => a.jenis === 'Expense');
  const tP = section('PENDAPATAN USAHA', rev.filter(a => a.klas === 'Pendapatan'), credit, 'Pendapatan Bersih', 'LR_PENDAPATAN');
  const tH = section('HARGA POKOK PENJUALAN', exp.filter(a => a.klas === 'Harga Pokok Penjualan'), debit, 'Total Harga Pokok Penjualan', 'LR_HPP');
  const tLK = R.add(['', 'LABA KOTOR', '=C' + tP + '-C' + tH], 'final', 'LR_LABA_KOTOR');
  R.blank();
  const tB = section('BEBAN OPERASI', exp.filter(a => a.klas === 'Beban Operasi'), debit, 'Total Beban Operasi', 'LR_BEBAN_OPERASI');
  const tLO = R.add(['', 'LABA OPERASI', '=C' + tLK + '-C' + tB], 'final', 'LR_LABA_OPERASI');
  R.blank();
  const lain = rev.filter(a => a.klas !== 'Pendapatan').concat(exp.filter(a => a.klas !== 'Harga Pokok Penjualan' && a.klas !== 'Beban Operasi'));
  const tL = section('PENDAPATAN (BEBAN) LAIN-LAIN', lain, credit, 'Total Pendapatan (Beban) Lain-lain', 'LR_LAIN');
  R.add(['', 'LABA (RUGI) BERSIH', '=C' + tLO + '+C' + tL], 'final', 'LR_LABA_BERSIH');
  R.blank();
  R.add(['Pendapatan & pengurang pendapatan (mis. retur) ditampilkan bersih. Pada bagian lain-lain, beban tampil negatif.'], 'note');
  R.flush([3]);
}

/* ---------- Perubahan Modal ---------- */
function buildPM_(coa, gl) {
  const R = new Report_(SH.PM, 3, [300, 330, 180]);
  R.add(['LAPORAN PERUBAHAN MODAL'], 'title');
  R.add([PERIOD_TITLE], 'period');
  R.blank();
  R.add(['Komponen', 'Keterangan', 'Jumlah (Rp)'], 'header');
  const eq = coa.filter(a => a.jenis === 'Equity');
  const awalParts = eq.map(a => (a.normal === 'Debit' ? '-' : '+') + GLC('E', gl.rowOf[a.kode])).join('');
  const first = R.add(['Modal Awal Periode', 'Modal + laba ditahan − prive s.d. awal periode',
    '=' + GLC('E', gl.ld) + awalParts], 'line', 'PM_MODAL_AWAL');
  eq.filter(a => a.normal !== 'Debit').forEach(a => {
    const g = gl.rowOf[a.kode];
    R.add(['=' + GLC('B', g), 'Penambahan selama periode', '=' + GLC('G', g) + '-' + GLC('F', g)], 'line');
  });
  R.add(['Laba (Rugi) Bersih', 'Dari Laporan Laba Rugi', '=LR_LABA_BERSIH'], 'line');
  eq.filter(a => a.normal === 'Debit').forEach(a => {
    const g = gl.rowOf[a.kode];
    R.add(['=' + GLC('B', g), 'Pengurang modal selama periode', '=-(' + GLC('F', g) + '-' + GLC('G', g) + ')'], 'line');
  });
  const last = R.next() - 1;
  R.add(['Modal Akhir Periode', 'Modal awal + penambahan + laba − prive', '=SUM(C' + first + ':C' + last + ')'], 'final', 'PM_MODAL_AKHIR');
  R.flush([3]);
}

/* ---------- Posisi Keuangan ---------- */
function buildPK_(coa, gl) {
  const R = new Report_(SH.PK, 3, [90, 340, 180]);
  R.add(['LAPORAN POSISI KEUANGAN'], 'title');
  R.add([PERIOD_AS_OF], 'period');
  R.blank();

  const groupBy = (accounts, order) => {
    const groups = {};
    const keys = [];
    accounts.forEach(a => {
      const k = a.klas || 'Lainnya';
      if (!groups[k]) { groups[k] = []; keys.push(k); }
      groups[k].push(a);
    });
    keys.sort((x, y) => {
      const ix = order.indexOf(x), iy = order.indexOf(y);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    });
    return keys.map(k => ({ klas: k, accounts: groups[k] }));
  };
  const block = (title, accounts, order, side, totalLabel, totalName) => {
    R.add([title], 'section');
    R.add(['Kode', 'Uraian', 'Jumlah (Rp)'], 'header');
    const subtotals = [];
    const gs = groupBy(accounts, order);
    if (!gs.length) R.add(['', '(belum ada akun)', 0], 'line');
    gs.forEach(gp => {
      R.add(['', gp.klas], 'sub');
      const f = R.next();
      gp.accounts.forEach(a => {
        const g = gl.rowOf[a.kode];
        R.add(['=' + GLC('A', g), '=' + GLC('B', g),
          '=IF(' + GLC('D', g) + '="' + (side === 'Debit' ? 'Credit' : 'Debit') + '",-1,1)*' + GLC('H', g)], 'line');
      });
      const l = R.next() - 1;
      subtotals.push(R.add(['', 'Total ' + gp.klas, '=SUM(C' + f + ':C' + l + ')'], 'total'));
    });
    const t = R.add(['', totalLabel, subtotals.length ? '=' + subtotals.map(r => 'C' + r).join('+') : 0], 'final', totalName);
    R.blank();
    return t;
  };
  const tA = block('ASET', coa.filter(a => a.jenis === 'Asset'), ['Aset Lancar', 'Aset Tidak Lancar'], 'Debit', 'TOTAL ASET', 'PK_TOTAL_ASET');
  const tL = block('LIABILITAS', coa.filter(a => a.jenis === 'Liability'), ['Liabilitas Jangka Pendek', 'Liabilitas Jangka Panjang'], 'Credit', 'TOTAL LIABILITAS', 'PK_TOTAL_LIABILITAS');
  R.add(['EKUITAS'], 'section');
  R.add(['Kode', 'Uraian', 'Jumlah (Rp)'], 'header');
  R.add(['', 'Modal Akhir (dari Laporan Perubahan Modal)', '=PM_MODAL_AKHIR'], 'line');
  const tE = R.add(['', 'TOTAL EKUITAS', '=PM_MODAL_AKHIR'], 'final', 'PK_TOTAL_EKUITAS');
  R.blank();
  const tLE = R.add(['', 'TOTAL LIABILITAS + EKUITAS', '=C' + tL + '+C' + tE], 'final');
  R.add(['', 'SELISIH PERSAMAAN AKUNTANSI (harus 0)', '=ROUND(C' + tA + '-C' + tLE + ',2)'], 'total', 'PK_SELISIH');
  R.flush([3]);
}

/* ---------- Arus Kas ---------- */
function buildAK_(coa, gl, ak) {
  const R = new Report_(SH.AK, 3, [130, 380, 180]);
  R.add(['LAPORAN ARUS KAS — METODE LANGSUNG'], 'title');
  R.add([PERIOD_TITLE], 'period');
  R.blank();
  const nets = [];
  const names = { Operating: 'AK_OPERASI', Investing: 'AK_INVESTASI', Financing: 'AK_PENDANAAN' };
  KAT_AK.forEach(kat => {
    R.add([KAT_AK_LABEL[kat]], 'section');
    R.add(['Kategori', 'Uraian', 'Arus Kas (Rp)'], 'header');
    const f = R.next();
    ak.filter(d => d.kat === kat).forEach(d => {
      const r = R.next();
      R.add([kat, d.det, '=SUMIFS(' + JR.kas + ',' + JR.kat + ',$A' + r + ',' + JR.det + ',$B' + r + ',' + IN_P + ')'], 'line');
    });
    const l = R.next() - 1;
    const r = R.next();
    R.add([kat, 'Lainnya (detail di luar daftar)', '=SUMIFS(' + JR.kas + ',' + JR.kat + ',$A' + r + ',' + IN_P + ')' + (l >= f ? '-SUM(C' + f + ':C' + l + ')' : '')], 'line');
    nets.push(R.add(['', 'Arus Kas Bersih dari ' + KAT_AK_LABEL[kat].replace('ARUS KAS DARI ', '').toLowerCase().replace(/^./, c => c.toUpperCase()),
      '=SUM(C' + f + ':C' + r + ')'], 'total', names[kat]));
    R.blank();
  });
  const sumNets = nets.map(r => 'C' + r).join('+');
  const tBelum = R.add(['', 'Arus kas belum diklasifikasi (isi Kategori di baris kas Jurnal)',
    '=ROUND(SUMIFS(' + JR.kas + ',' + IN_P + ')-(' + sumNets + '),2)'], 'line', 'AK_BELUM');
  R.blank();
  const tNaik = R.add(['KENAIKAN / (PENURUNAN) BERSIH KAS', '', '=' + sumNets + '+C' + tBelum], 'total');
  const tAwal = R.add(['SALDO KAS AWAL', '', '=SUMIFS(' + JR.deb + ',' + JR.kel + ',"' + KELOMPOK_KAS + '",' + BEFORE_P + ')-SUMIFS(' + JR.kre + ',' + JR.kel + ',"' + KELOMPOK_KAS + '",' + BEFORE_P + ')'], 'line');
  const tAkhir = R.add(['SALDO KAS AKHIR', '', '=C' + tNaik + '+C' + tAwal], 'final', 'AK_KAS_AKHIR');
  R.blank();
  const kas = coa.filter(a => a.kel === KELOMPOK_KAS);
  const pkKas = kas.length ? '=' + kas.map(a => {
    const g = gl.rowOf[a.kode];
    return 'IF(' + GLC('D', g) + '="Credit",-1,1)*' + GLC('H', g);
  }).join('+') : 0;
  const tPK = R.add(['Kas & bank di Posisi Keuangan', '', pkKas], 'line');
  R.add(['REKONSILIASI (harus 0)', '', '=ROUND(C' + tAkhir + '-C' + tPK + ',2)'], 'total', 'AK_REKON');
  R.blank();
  R.add(['Akun kas = akun dengan Kelompok "Kas" di Chart of Accounts. Pemindahan dana antar akun kas tidak perlu diklasifikasi.'], 'note');
  R.flush([3], sh => {
    // label baris ringkasan memakai kolom A–B
    [tNaik, tAwal, tAkhir, tPK].forEach(r => sh.getRange(r, 1, 1, 2).merge());
    sh.getRange(tPK + 1, 1, 1, 2).merge();
  });
}

/* ---------- Ringkasan ---------- */
function buildRingkasan_(coa, gl, sel) {
  const sh = sheet_(SH.RINGKASAN);
  resetSheet_(sh);
  ensureSize_(sh, 80, 12);

  const expense = coa.filter(a => a.jenis === 'Expense');
  const W = 8;
  const vals = [];
  const put = (r, c, v) => { while (vals.length < r) vals.push(new Array(W).fill('')); vals[r - 1][c - 1] = v; };

  put(1, 1, '="RINGKASAN KEUANGAN — "&UPPER(NAMA_USAHA)');
  put(3, 1, 'Bulan'); put(3, 2, sel.bulan);
  put(4, 1, 'Tahun'); put(4, 2, sel.tahun);
  put(3, 4, 'Periode laporan'); put(3, 5, '=PERIODE_LABEL');
  put(4, 4, '← Ubah bulan/tahun; semua laporan ikut berubah.');

  // KPI
  put(6, 1, 'INDIKATOR PERIODE TERPILIH');
  put(7, 1, 'Indikator'); put(7, 2, 'Nilai');
  const kpi = [
    ['Pendapatan bersih', '=LR_PENDAPATAN', FMT_RP],
    ['Harga pokok penjualan', '=LR_HPP', FMT_RP],
    ['Laba kotor', '=LR_LABA_KOTOR', FMT_RP],
    ['Margin laba kotor', '=IFERROR(LR_LABA_KOTOR/LR_PENDAPATAN,0)', FMT_PCT],
    ['Beban operasi', '=LR_BEBAN_OPERASI', FMT_RP],
    ['Laba (rugi) bersih', '=LR_LABA_BERSIH', FMT_RP],
    ['Margin laba bersih', '=IFERROR(LR_LABA_BERSIH/LR_PENDAPATAN,0)', FMT_PCT],
    ['Saldo kas & bank akhir', '=AK_KAS_AKHIR', FMT_RP],
    ['Total aset', '=PK_TOTAL_ASET', FMT_RP],
    ['Total liabilitas', '=PK_TOTAL_LIABILITAS', FMT_RP],
    ['Modal akhir', '=PM_MODAL_AKHIR', FMT_RP]
  ];
  kpi.forEach((k, i) => { put(8 + i, 1, k[0]); put(8 + i, 2, k[1]); });

  // Kontrol
  put(6, 4, 'KONTROL');
  put(7, 4, 'Pemeriksaan'); put(7, 5, 'Status'); put(7, 6, 'Nilai');
  const ok0 = name => '=IF(ROUND(' + name + ',2)=0,"OK","CEK")';
  const ctrl = [
    ['Jurnal balance (total)', ok0('JU_SELISIH'), '=JU_SELISIH', FMT_RP],
    ['Transaksi tidak balance', ok0('JU_TRX_TIDAK_BALANCE'), '=JU_TRX_TIDAK_BALANCE', FMT_INT],
    ['Kode akun tidak dikenal', ok0('JU_KODE_TIDAK_DIKENAL'), '=JU_KODE_TIDAK_DIKENAL', FMT_INT],
    ['Baris jurnal tidak lengkap', ok0('JU_BARIS_TIDAK_LENGKAP'), '=JU_BARIS_TIDAK_LENGKAP', FMT_INT],
    ['Neraca saldo balance', ok0('NS_SELISIH'), '=NS_SELISIH', FMT_RP],
    ['Persamaan akuntansi (A = L + E)', ok0('PK_SELISIH'), '=PK_SELISIH', FMT_RP],
    ['Rekonsiliasi kas', ok0('AK_REKON'), '=AK_REKON', FMT_RP],
    ['Arus kas belum diklasifikasi', ok0('AK_BELUM'), '=AK_BELUM', FMT_RP],
    ['Struktur laporan sinkron dengan akun', '=IF(COUNTA(\'' + SH.COA + '\'!$A$' + COA_FIRST + ':$A)=' + coa.length + ',"OK","PERBARUI")', coa.length, FMT_INT]
  ];
  ctrl.forEach((c, i) => { put(8 + i, 4, c[0]); put(8 + i, 5, c[1]); put(8 + i, 6, c[2]); });

  // Tren bulanan
  const TR = 21;
  put(TR, 1, '="TREN BULANAN TAHUN "&$B$4');
  put(TR + 1, 1, 'Bulan'); put(TR + 1, 2, 'Pendapatan'); put(TR + 1, 3, 'Beban'); put(TR + 1, 4, 'Laba Bersih'); put(TR + 1, 5, 'Saldo Kas Akhir');
  const rng = m => JR.tgl + ',">="&DATE($B$4,' + m + ',1),' + JR.tgl + ',"<="&EOMONTH(DATE($B$4,' + m + ',1),0)';
  const upto = m => JR.tgl + ',"<="&EOMONTH(DATE($B$4,' + m + ',1),0)';
  for (let m = 1; m <= 12; m++) {
    const r = TR + 1 + m;
    put(r, 1, BULAN[m - 1].substr(0, 3));
    put(r, 2, '=SUMIFS(' + JR.kre + ',' + JR.jenis + ',"Revenue",' + rng(m) + ')-SUMIFS(' + JR.deb + ',' + JR.jenis + ',"Revenue",' + rng(m) + ')');
    put(r, 3, '=SUMIFS(' + JR.deb + ',' + JR.jenis + ',"Expense",' + rng(m) + ')-SUMIFS(' + JR.kre + ',' + JR.jenis + ',"Expense",' + rng(m) + ')');
    put(r, 4, '=B' + r + '-C' + r);
    put(r, 5, '=SUMIFS(' + JR.deb + ',' + JR.kel + ',"' + KELOMPOK_KAS + '",' + upto(m) + ')-SUMIFS(' + JR.kre + ',' + JR.kel + ',"' + KELOMPOK_KAS + '",' + upto(m) + ')');
  }
  const TT = TR + 14;
  put(TT, 1, 'Total'); put(TT, 2, '=SUM(B' + (TR + 2) + ':B' + (TR + 13) + ')'); put(TT, 3, '=SUM(C' + (TR + 2) + ':C' + (TR + 13) + ')'); put(TT, 4, '=SUM(D' + (TR + 2) + ':D' + (TR + 13) + ')');

  // Komposisi beban periode
  put(TR, 7, 'KOMPOSISI BEBAN PERIODE TERPILIH');
  put(TR + 1, 7, 'Akun Beban'); put(TR + 1, 8, 'Jumlah');
  expense.forEach((a, i) => {
    const g = gl.rowOf[a.kode];
    put(TR + 2 + i, 7, '=' + GLC('B', g));
    put(TR + 2 + i, 8, '=' + GLC('F', g) + '-' + GLC('G', g));
  });
  const expLast = TR + 1 + Math.max(1, expense.length);
  put(Math.max(TT, expLast) + 2, 1, 'Grafik di sebelah kanan mengikuti tabel ini. Data kosong = belum ada transaksi pada bulan tersebut.');

  const n = vals.length;
  sh.getRange(1, 1, n, W).setValues(vals);

  // Gaya
  sh.getRange(1, 1, 1, W).merge().setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A3:A4').setBackground(COLOR.header).setFontWeight('bold');
  sh.getRange('B3:B4').setFontColor(COLOR.input).setFontWeight('bold').setBackground('#FFFDE7')
    .setBorder(true, true, true, true, null, null, '#F9A825', SpreadsheetApp.BorderStyle.SOLID_MEDIUM).setHorizontalAlignment('left');
  sh.getRange('D3').setFontWeight('bold');
  sh.getRange('E3:F3').merge().setFontWeight('bold').setFontColor(COLOR.link);
  sh.getRange('D4:H4').merge().setFontStyle('italic').setFontColor(COLOR.muted);
  sh.getRange('A6:B6').merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange('D6:F6').merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRangeList(['A7:B7', 'D7:F7']).setBackground(COLOR.header).setFontWeight('bold');
  kpi.forEach((k, i) => sh.getRange(8 + i, 2).setNumberFormat(k[2]).setFontColor(COLOR.link));
  sh.getRangeList(['A10:B10', 'A13:B13']).setBackground(COLOR.final).setFontWeight('bold');
  ctrl.forEach((c, i) => sh.getRange(8 + i, 6).setNumberFormat(c[3]));
  sh.getRange(8, 5, ctrl.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
  sh.getRange(TR, 1, 1, 5).merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(TR + 1, 1, 1, 5).setBackground(COLOR.header).setFontWeight('bold');
  sh.getRange(TR + 2, 2, 13, 4).setNumberFormat(FMT_RP);
  sh.getRange(TT, 1, 1, 5).setBackground(COLOR.total).setFontWeight('bold');
  sh.getRange(TR, 7, 1, 2).merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
  sh.getRange(TR + 1, 7, 1, 2).setBackground(COLOR.header).setFontWeight('bold');
  sh.getRange(TR + 2, 8, Math.max(1, expense.length), 1).setNumberFormat(FMT_RP);
  sh.getRange(Math.max(TT, expLast) + 2, 1, 1, W).merge().setFontStyle('italic').setFontColor(COLOR.muted);

  // Validasi periode
  sh.getRange('B3').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(BULAN.concat([SETAHUN]), true).setAllowInvalid(false).build());
  sh.getRange('B4').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(2000, 2100).setAllowInvalid(false).build());
  sh.getRange('B4').setNumberFormat(FMT_INT);

  // Format bersyarat status kontrol
  const st = sh.getRange(8, 5, ctrl.length, 1);
  const neg = sh.getRange(8, 2, kpi.length, 1);
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OK').setBackground(COLOR.good).setFontColor(COLOR.goodText).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('CEK').setBackground(COLOR.bad).setFontColor(COLOR.badText).setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PERBARUI').setBackground('#FFF3CD').setFontColor('#7A5C00').setRanges([st]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(COLOR.badText).setRanges([neg]).build()
  ]);
  sh.getRange('E15').setNote('Info: baris kas di Jurnal yang belum diberi Kategori Arus Kas. Pemindahan antar akun kas (mis. kas → bank) saling meniadakan.');
  sh.getRange('E16').setNote('PERBARUI = jumlah akun berubah. Jalankan menu Keuangan → Perbarui Struktur Laporan.');

  setWidths_(sh, [200, 170, 150, 250, 90, 150, 230, 150]);
  sh.setFrozenRows(1);

  // Grafik
  const colors = ['#1F4E78', '#E07B39', '#2E7D32'];
  const c1 = sh.newChart().setChartType(Charts.ChartType.COMBO)
    .addRange(sh.getRange(TR + 1, 1, 13, 4))
    .setNumHeaders(1)
    .setOption('title', 'Pendapatan, Beban & Laba Bersih per Bulan')
    .setOption('seriesType', 'bars')
    .setOption('series', { 2: { type: 'line', lineWidth: 3, pointSize: 5 } })
    .setOption('colors', colors)
    .setOption('legend', { position: 'top' })
    .setOption('vAxis', { format: 'short' })
    .setOption('width', 620).setOption('height', 320)
    .setPosition(3, 10, 0, 0).build();
  sh.insertChart(c1);
  if (expense.length) {
    const c2 = sh.newChart().setChartType(Charts.ChartType.BAR)
      .addRange(sh.getRange(TR + 1, 7, expense.length + 1, 2))
      .setNumHeaders(1)
      .setOption('title', 'Komposisi Beban — Periode Terpilih')
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#E07B39'])
      .setOption('hAxis', { format: 'short' })
      .setOption('width', 620).setOption('height', Math.max(260, 40 + expense.length * 26))
      .setPosition(20, 10, 0, 0).build();
    sh.insertChart(c2);
  }
  const c3 = sh.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(sh.getRange(TR + 1, 1, 13, 1))
    .addRange(sh.getRange(TR + 1, 5, 13, 1))
    .setNumHeaders(1)
    .setOption('title', 'Saldo Kas & Bank Akhir Bulan')
    .setOption('legend', { position: 'none' })
    .setOption('colors', ['#2E7D32'])
    .setOption('vAxis', { format: 'short' })
    .setOption('pointSize', 5)
    .setOption('width', 620).setOption('height', 280)
    .setPosition(38, 10, 0, 0).build();
  sh.insertChart(c3);
}

/* ------------------------------------------------------------------ */
/*  SHEET: PETUNJUK (TUTORIAL)                                         */
/* ------------------------------------------------------------------ */

function buildPetunjuk_() {
  const sh = sheet_(SH.PETUNJUK);
  resetSheet_(sh);
  const rows = [
    ['T', 'TEMPLATE AKUNTANSI LENGKAP — PANDUAN PENGGUNAAN'],
    ['N', 'Template usaha dagang/produksi. Pencatatan sehari-hari dilakukan lewat APLIKASI WEB (HP atau laptop). Spreadsheet ini adalah database + laporan lengkap.'],
    ['', ''],
    ['S', 'PEMASANGAN (SEKALI SAJA)'],
    ['H', 'Langkah|Yang dilakukan'],
    ['L', '1. Atur PIN pemilik|Menu 💰 Keuangan → 👤 Atur PIN Pemilik. Nama pengguna pemilik = email Google Anda.'],
    ['L', '2. Deploy aplikasi|Editor Apps Script → Terapkan → Deployment baru → jenis Aplikasi web. Jalankan sebagai: Saya. Yang memiliki akses: Siapa saja. Klik Terapkan, lalu buka URL yang berakhiran /exec.'],
    ['L', '3. Masuk|Buka link aplikasi, masuk dengan email + PIN. Simpan link di layar utama HP (Tambahkan ke layar utama).'],
    ['L', '4. Tambah pencatat|Di aplikasi: Pengaturan → Pengguna → Tambah. Beri nama pengguna & PIN awal, lalu bagikan link aplikasi.'],
    ['L', '5. Sesuaikan|Di aplikasi: Akun (Chart of Accounts, template transaksi, detail arus kas) dan Pengaturan (nama usaha, email, pengingat).'],
    ['L', 'Setelah mengubah kode|Terapkan → Kelola deployment → edit (ikon pensil) → Versi: Versi baru → Terapkan. Link tetap sama.'],
    ['', ''],
    ['S', 'PERAN PENGGUNA'],
    ['H', 'Peran|Akses'],
    ['L', 'Pemilik|Semua: beranda, catat, jurnal (semua transaksi), laporan & PDF, akun & template, pengaturan, pengguna, log aktivitas.'],
    ['L', 'Pencatat|Beranda, catat transaksi, melihat/mengubah/menghapus transaksi yang ia catat sendiri, ganti PIN sendiri.'],
    ['', ''],
    ['S', 'DATA CONTOH'],
    ['L', 'Baris kuning di Jurnal Umum|Transaksi contoh (TRX001–TRX020) agar semua laporan langsung terisi. Hapus lewat aplikasi (Pengaturan → Data contoh) atau menu 🧹 Hapus Data Contoh.'],
    ['', ''],
    ['S', 'MENU 💰 KEUANGAN DI SPREADSHEET'],
    ['H', 'Menu|Fungsi'],
    ['L', '🌐 Link Aplikasi|Menampilkan URL aplikasi web untuk dibagikan.'],
    ['L', '👤 Atur PIN Pemilik|Membuat/mengganti PIN pemilik (juga untuk memulihkan akses bila PIN lupa).'],
    ['L', '🔄 Perbarui Struktur Laporan|Menyusun ulang sheet laporan dari Chart of Accounts (biasanya otomatis).'],
    ['L', '✅ Cek Jurnal & Integritas|Mencari transaksi tidak balance/kode salah dan mencocokkan hitungan script dengan rumus sheet.'],
    ['L', '📧 / ⏰ / ⛔|Kirim rekap, aktifkan atau matikan email otomatis (bisa juga dari aplikasi).'],
    ['L', '⚙️ Setup / Perbaiki Template|Menyusun ulang semua sheet bila ada yang rusak. Data akun, jurnal, template, pengaturan & pengguna tetap aman.'],
    ['', ''],
    ['S', 'URUTAN SIKLUS AKUNTANSI'],
    ['H', 'Sheet|Keterangan'],
    ['L', 'Chart of Accounts|Daftar akun: kode, nama, jenis, saldo normal, klasifikasi laporan, kelompok. Kelompok "Kas" menandai akun kas/bank.'],
    ['L', 'Jurnal Umum|Semua transaksi (double-entry). Satu ID = satu transaksi; total debit harus sama dengan total kredit.'],
    ['L', 'Template Transaksi|Daftar transaksi siap pakai untuk tab Cepat. Tambah baris sendiri untuk transaksi yang sering terjadi.'],
    ['L', 'General Ledger|Saldo awal, mutasi debit/kredit, dan saldo akhir tiap akun untuk periode terpilih.'],
    ['L', 'T Account|Akun-T tiap akun (saldo awal, mutasi, saldo akhir).'],
    ['L', 'Neraca Saldo|Memastikan total saldo debit = total saldo kredit.'],
    ['L', 'Laba Rugi|Pendapatan − HPP = Laba Kotor; − Beban Operasi = Laba Operasi; ± lain-lain = Laba Bersih.'],
    ['L', 'Perubahan Modal|Modal awal + setoran + laba bersih − prive = modal akhir.'],
    ['L', 'Posisi Keuangan|Aset = Liabilitas + Ekuitas, dikelompokkan per klasifikasi.'],
    ['L', 'Arus Kas|Metode langsung per kategori Operating / Investing / Financing dan detailnya.'],
    ['L', 'Ringkasan|Indikator utama, status kontrol, tren bulanan, komposisi beban, dan grafik.'],
    ['L', 'Pengaturan|Nama usaha, email, pengingat, dan daftar Detail Arus Kas.'],
    ['', ''],
    ['S', 'CONTOH: CARA MENCATAT TRANSAKSI USAHA DAGANG / PRODUKSI'],
    ['H', 'Kejadian|Pencatatan (Debit / Kredit)'],
    ['L', 'Beli bahan baku tunai|Persediaan Bahan Baku (D) / Kas (K) — TRX013'],
    ['L', 'Beli bahan baku, bayar nanti|Persediaan Bahan Baku (D) / Utang Usaha (K) — TRX014'],
    ['L', 'Bahan diolah jadi produk|Persediaan Barang Jadi (D) / Persediaan Bahan Baku (K) — TRX015'],
    ['L', 'Jual produk tunai|Kas (D) / Penjualan (K)  +  HPP (D) / Persediaan Barang Jadi (K) — TRX016'],
    ['L', 'Jual produk, dibayar nanti|Piutang Usaha (D) / Penjualan (K)  +  HPP (D) / Persediaan Barang Jadi (K) — TRX017'],
    ['L', 'Setor kas ke bank|Bank (D) / Kas (K). Tidak perlu kategori arus kas — TRX018'],
    ['L', 'Bayar promosi lewat bank|Beban Pemasaran (D) / Bank (K) — TRX019'],
    ['L', 'Penyusutan akhir bulan|Beban Penyusutan (D) / Akumulasi Penyusutan (K) — TRX020'],
    ['', ''],
    ['S', 'KONTROL UTAMA (lihat sheet Ringkasan)'],
    ['H', 'Kontrol|Makna'],
    ['L', 'Jurnal balance|Total Debit = Total Kredit, dan setiap ID transaksi balance (baris merah = belum balance).'],
    ['L', 'Neraca saldo balance|Total saldo debit = total saldo kredit.'],
    ['L', 'Persamaan akuntansi|Total Aset = Total Liabilitas + Ekuitas.'],
    ['L', 'Rekonsiliasi kas|Kas akhir di Arus Kas = kas & bank di Posisi Keuangan.'],
    ['L', 'Arus kas belum diklasifikasi|Baris akun kas di Jurnal yang Kategori Arus Kas-nya kosong (sel kuning).'],
    ['', ''],
    ['S', 'TIPS'],
    ['L', 'Warna huruf|Biru = sel input. Hijau = rumus/tautan otomatis. Jangan mengetik di sheet laporan (ada peringatan proteksi).'],
    ['L', 'Saldo awal usaha lama|Catat satu transaksi "Saldo awal" di tanggal mulai: debit semua aset, kredit utang dan Modal Pemilik.'],
    ['L', 'Akun kontra|Akumulasi Penyusutan (jenis Asset, saldo normal Credit) dan Retur Penjualan (jenis Revenue, saldo normal Debit) otomatis tampil sebagai pengurang.'],
    ['L', 'Izin pertama kali|Saat menjalankan script pertama kali, Google meminta izin. Pilih akun → Lanjutan → Buka (tidak aman) → Izinkan. Ini script milik Anda sendiri.'],
    ['L', 'Mengetik langsung di Sheets|Boleh untuk Pemilik. Isi kolom "Dicatat oleh" bila transaksi itu milik pencatat tertentu.']
  ];
  const vals = rows.map(r => {
    const parts = r[1].split('|');
    return [parts[0], parts.length > 1 ? parts.slice(1).join('|') : ''];
  });
  ensureSize_(sh, vals.length + 10, 2);
  sh.getRange(1, 1, vals.length, 2).setValues(vals);
  rows.forEach((r, i) => {
    const row = i + 1;
    const rg = sh.getRange(row, 1, 1, 2);
    if (r[0] === 'T') rg.merge().setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
    else if (r[0] === 'N') rg.merge().setBackground(COLOR.note).setWrap(true);
    else if (r[0] === 'S') rg.merge().setBackground(COLOR.section).setFontColor('#FFFFFF').setFontWeight('bold');
    else if (r[0] === 'H') rg.setBackground(COLOR.header).setFontWeight('bold');
  });
  sh.getRange(1, 1, vals.length, 2).setVerticalAlignment('top');
  sh.getRange(1, 2, vals.length, 1).setWrap(true);
  sh.getRange(1, 1, vals.length, 1).setWrap(true);
  setWidths_(sh, [260, 720]);
  sh.setFrozenRows(1);
}

/* ------------------------------------------------------------------ */
/*  SHEET: PENGGUNA & LOG AKTIVITAS                                    */
/* ------------------------------------------------------------------ */

function readUsersRaw_() {
  const sh = sheet_(SH.PENGGUNA);
  if (!sh || sh.getLastRow() < 4) return [];
  return sh.getRange(4, 1, sh.getLastRow() - 3, 7).getValues().filter(r => str_(r[1]));
}

function buildPengguna_(users) {
  const sh = sheet_(SH.PENGGUNA);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(100, users.length + 50), 7);
  if (!users.length) {
    let email = '';
    try { email = str_(Session.getEffectiveUser().getEmail()).toLowerCase(); } catch (e) { }
    users = [['Pemilik', email || 'pemilik', 'Pemilik', 'Ya', '', '', '']];
  }
  sh.getRange('A1:G1').merge().setValue('PENGGUNA APLIKASI')
    .setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:G2').merge().setValue('Kelola pengguna dari aplikasi (Pengaturan → Pengguna). PIN disimpan sebagai hash, bukan angka aslinya. ' +
    'PIN pemilik pertama: menu 💰 Keuangan → 👤 Atur PIN Pemilik. Jangan bagikan sheet ini.')
    .setBackground(COLOR.note).setFontStyle('italic').setWrap(true);
  sh.setRowHeight(2, 36);
  sh.getRange(3, 1, 1, 7).setValues([['Nama', 'Nama Pengguna (login)', 'Peran', 'Aktif', 'Hash PIN', 'Salt', 'Terakhir masuk']])
    .setBackground(COLOR.header).setFontWeight('bold');
  sh.getRange(4, 1, users.length, 7).setValues(users);
  sh.getRange(4, 7, sh.getMaxRows() - 3, 1).setNumberFormat('dd mmm yyyy hh:mm');
  sh.getRange(4, 3, sh.getMaxRows() - 3, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pemilik', 'Pencatat'], true).setAllowInvalid(false).build());
  sh.getRange(4, 4, sh.getMaxRows() - 3, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ya', 'Tidak'], true).setAllowInvalid(false).build());
  setWidths_(sh, [200, 260, 110, 70, 120, 120, 160]);
  sh.hideColumns(5, 2);
  sh.setFrozenRows(3);
  protectWarning_(sh);
}

function buildLog_(rows) {
  const sh = sheet_(SH.LOG);
  resetSheet_(sh);
  ensureSize_(sh, Math.max(500, rows.length + 200), 5);
  sh.getRange('A1:E1').merge().setValue('LOG AKTIVITAS APLIKASI')
    .setBackground(COLOR.title).setFontColor('#FFFFFF').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2:E2').merge().setValue('Dicatat otomatis: masuk, tambah/ubah/hapus transaksi, perubahan akun & pengaturan.')
    .setBackground(COLOR.note).setFontStyle('italic');
  sh.getRange(3, 1, 1, 5).setValues([['Waktu', 'Pengguna', 'Aksi', 'ID', 'Detail']]).setBackground(COLOR.header).setFontWeight('bold');
  if (rows.length) sh.getRange(4, 1, rows.length, 5).setValues(rows);
  sh.getRange(4, 1, sh.getMaxRows() - 3, 1).setNumberFormat('dd mmm yyyy hh:mm');
  setWidths_(sh, [150, 200, 170, 90, 420]);
  sh.setFrozenRows(3);
  protectWarning_(sh);
}

/* ------------------------------------------------------------------ */
/*  TRANSAKSI: ID & VALIDASI                                           */
/* ------------------------------------------------------------------ */

function nextId_(rows) {
  let max = Number(PropertiesService.getDocumentProperties().getProperty('LAST_TRX_NUM') || 0);
  rows.forEach(r => {
    const m = /^TRX(\d+)$/i.exec(r.id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return 'TRX' + pad3_(max + 1);
}

function validasiPayload_(p, accMap) {
  if (!p || !p.lines) return 'Data transaksi kosong.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str_(p.tanggal))) return 'Tanggal belum diisi dengan benar.';
  if (!str_(p.deskripsi)) return 'Deskripsi wajib diisi.';
  const lines = p.lines.filter(l => num_(l.debit) || num_(l.kredit) || code_(l.kode));
  if (lines.length < 2) return 'Minimal 2 baris (satu debit, satu kredit).';
  let td = 0, tk = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const kode = code_(l.kode);
    if (!kode || !accMap[kode]) return 'Baris ' + (i + 1) + ': akun belum dipilih / tidak ada di Chart of Accounts.';
    const d = num_(l.debit), k = num_(l.kredit);
    if (d < 0 || k < 0) return 'Baris ' + (i + 1) + ': nominal tidak boleh negatif.';
    if (d > 0 && k > 0) return 'Baris ' + (i + 1) + ': isi Debit ATAU Kredit, bukan keduanya.';
    if (d === 0 && k === 0) return 'Baris ' + (i + 1) + ' (' + accMap[kode].nama + '): nominal masih 0.';
    if (l.kat && KAT_AK.indexOf(l.kat) === -1) return 'Kategori arus kas tidak dikenal: ' + l.kat;
    td += d; tk += k;
  }
  if (round2_(td) !== round2_(tk)) return 'Belum balance: total debit ' + rp_(td) + ' ≠ total kredit ' + rp_(tk) + '.';
  if (td <= 0) return 'Nominal transaksi masih 0.';
  p.lines = lines;
  return '';
}

/* ------------------------------------------------------------------ */
/*  PERAWATAN JURNAL                                                   */
/* ------------------------------------------------------------------ */

function urutkanJurnal() {
  sortJurnalCore_();
  ss_().toast('Jurnal diurutkan berdasarkan tanggal lalu ID.', 'Selesai', 4);
}

function sortJurnalCore_() {
  const sh = sheet_(SH.JURNAL);
  const rows = sortRows_(readJurnal_());
  clearJurnalInputs_(sh);
  writeJurnalRows_(sh, rows, JU_FIRST);
}

function hapusDataContoh() {
  const ui = SpreadsheetApp.getUi();
  const n = readJurnal_().filter(r => r.sumber === SUMBER_CONTOH).length;
  if (!n) { ui.alert('Tidak ada data contoh di Jurnal Umum.'); return; }
  const resp = ui.alert('Hapus Data Contoh',
    'Menghapus ' + n + ' baris contoh (Sumber = CONTOH) dari Jurnal Umum.\n' +
    'Transaksi Anda sendiri, akun, dan template tidak dihapus.\n\nLanjutkan?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  hapusContohCore_();
  ui.alert('Data contoh dihapus ✅', 'Periode di Ringkasan diatur ke bulan ini. Selamat mencatat!', ui.ButtonSet.OK);
}

function hapusContohCore_() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const rows = readJurnal_();
    const sisa = rows.filter(r => r.sumber !== SUMBER_CONTOH);
    const sh = sheet_(SH.JURNAL);
    clearJurnalInputs_(sh);
    writeJurnalRows_(sh, sisa, JU_FIRST);
    PropertiesService.getDocumentProperties().setProperty('SAMPLES_REMOVED', 'yes');
    const rk = sheet_(SH.RINGKASAN);
    const today = todayKey_();
    rk.getRange('B3').setValue(BULAN[parseInt(today.substr(5, 2), 10) - 1]);
    rk.getRange('B4').setValue(parseInt(today.substr(0, 4), 10));
    return rows.length - sisa.length;
  } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/*  MESIN HITUNG (untuk email & cek integritas)                        */
/* ------------------------------------------------------------------ */

function hitung_(coa, rows, startKey, endKey) {
  const acc = {};
  coa.forEach(a => acc[a.kode] = Object.assign({ before: 0, pd: 0, pk: 0 }, a));
  rows.forEach(r => {
    const a = acc[r.kode];
    if (!a || !r.dateKey || r.dateKey > endKey) return;
    if (r.dateKey < startKey) a.before += r.debit - r.kredit;
    else { a.pd += r.debit; a.pk += r.kredit; }
  });
  const list = Object.keys(acc).map(k => acc[k]);
  const sum = (filter, fn) => list.filter(filter).reduce((s, a) => s + fn(a), 0);
  const cr = a => a.pk - a.pd;
  const dr = a => a.pd - a.pk;
  const closeDr = a => a.before + a.pd - a.pk;
  const isRev = a => a.jenis === 'Revenue', isExp = a => a.jenis === 'Expense';
  const pendapatan = sum(a => isRev(a) && a.klas === 'Pendapatan', cr);
  const hpp = sum(a => isExp(a) && a.klas === 'Harga Pokok Penjualan', dr);
  const bebanOps = sum(a => isExp(a) && a.klas === 'Beban Operasi', dr);
  const lain = sum(a => (isRev(a) && a.klas !== 'Pendapatan') || (isExp(a) && a.klas !== 'Harga Pokok Penjualan' && a.klas !== 'Beban Operasi'), cr);
  const labaKotor = pendapatan - hpp;
  const labaBersih = labaKotor - bebanOps + lain;
  const kasAwal = sum(a => a.kel === KELOMPOK_KAS, a => a.before);
  const kasAkhir = sum(a => a.kel === KELOMPOK_KAS, closeDr);
  const totalAset = sum(a => a.jenis === 'Asset', closeDr);
  const totalLiab = -sum(a => a.jenis === 'Liability', closeDr);
  const modalAkhir = -sum(a => a.jenis === 'Equity', closeDr) - sum(a => isRev(a) || isExp(a), closeDr);
  const beban = list.filter(isExp).map(a => ({ nama: a.nama, kode: a.kode, jumlah: dr(a) }))
    .filter(b => Math.abs(b.jumlah) > 0.004).sort((x, y) => y.jumlah - x.jumlah);
  const ids = {};
  let belumKlasifikasi = 0;
  rows.forEach(r => {
    if (!(r.id && r.dateKey >= startKey && r.dateKey <= endKey)) return;
    ids[r.id] = true;
    const a = acc[r.kode];
    if (a && a.kel === KELOMPOK_KAS && KAT_AK.indexOf(r.kat) === -1) belumKlasifikasi += r.debit - r.kredit;
  });
  const totalPendapatan = sum(isRev, cr);
  const totalBeban = sum(isExp, dr);
  const saldo = list.map(a => ({ kode: a.kode, nama: a.nama, jenis: a.jenis, kel: a.kel, saldo: closeDr(a) }));
  return {
    pendapatan, hpp, labaKotor, bebanOps, lain, labaBersih, kasAwal, kasAkhir, totalAset, totalLiab, modalAkhir,
    beban, totalPendapatan, totalBeban, saldo, belumKlasifikasi: round2_(belumKlasifikasi),
    jumlahTransaksi: Object.keys(ids).length, selisihNeraca: round2_(totalAset - totalLiab - modalAkhir)
  };
}

function cekJurnal_(coa, rows) {
  const accMap = {};
  coa.forEach(a => accMap[a.kode] = a);
  const byId = {};
  const unknown = [], incomplete = [];
  rows.forEach(r => {
    if (r.kode && !accMap[r.kode]) unknown.push('Baris ' + r.row + ' (' + (r.id || 'tanpa ID') + '): kode ' + r.kode);
    if (!r.dateKey || !r.id || !r.kode) incomplete.push('Baris ' + r.row + (r.id ? ' (' + r.id + ')' : '') + ': ' +
      [!r.dateKey ? 'tanggal' : '', !r.id ? 'ID' : '', !r.kode ? 'kode akun' : ''].filter(Boolean).join(', ') + ' kosong');
    if (r.id) { byId[r.id] = byId[r.id] || 0; byId[r.id] += r.debit - r.kredit; }
  });
  const unbalanced = Object.keys(byId).filter(id => Math.abs(round2_(byId[id])) > 0)
    .map(id => id + ' (selisih ' + rp_(byId[id]) + ')');
  return { unknown, incomplete, unbalanced };
}

function periodKeys_(bulan, tahun) {
  if (bulan === SETAHUN) return { start: tahun + '-01-01', end: tahun + '-12-31', label: 'Tahun ' + tahun };
  const m = BULAN.indexOf(bulan) + 1;
  const last = new Date(tahun, m, 0).getDate();
  const mm = ('0' + m).slice(-2);
  return { start: tahun + '-' + mm + '-01', end: tahun + '-' + mm + '-' + ('0' + last).slice(-2), label: bulan + ' ' + tahun, bulan: bulan, tahun: tahun };
}
function prevPeriod_(bulan, tahun) {
  if (bulan === SETAHUN) return periodKeys_(SETAHUN, tahun - 1);
  const m = BULAN.indexOf(bulan);
  return m === 0 ? periodKeys_(BULAN[11], tahun - 1) : periodKeys_(BULAN[m - 1], tahun);
}

function cekIntegritas() {
  const ui = SpreadsheetApp.getUi();
  SpreadsheetApp.flush();
  const coa = readCoa_(), rows = readJurnal_();
  const sel = readPeriodSelection_();
  const out = [];
  const j = cekJurnal_(coa, rows);
  const lim = a => a.slice(0, 10).join('\n   ') + (a.length > 10 ? '\n   … dan ' + (a.length - 10) + ' lainnya' : '');
  out.push(j.unbalanced.length ? '❌ Transaksi tidak balance:\n   ' + lim(j.unbalanced) : '✅ Semua transaksi balance.');
  out.push(j.unknown.length ? '❌ Kode akun tidak dikenal:\n   ' + lim(j.unknown) : '✅ Semua kode akun dikenal.');
  out.push(j.incomplete.length ? '⚠️ Baris tidak lengkap:\n   ' + lim(j.incomplete) : '✅ Tidak ada baris yang tidak lengkap.');
  if (strukturBerubah_()) out.push('⚠️ Struktur akun berubah — jalankan Perbarui Struktur Laporan.');

  if (sel) {
    const p = periodKeys_(sel.bulan, sel.tahun);
    const h = hitung_(coa, rows, p.start, p.end);
    const get = n => { try { return Number(ss_().getRangeByName(n).getValue()) || 0; } catch (e) { return NaN; } };
    const pairs = [
      ['Laba bersih', h.labaBersih, get('LR_LABA_BERSIH')],
      ['Total aset', h.totalAset, get('PK_TOTAL_ASET')],
      ['Total liabilitas', h.totalLiab, get('PK_TOTAL_LIABILITAS')],
      ['Modal akhir', h.modalAkhir, get('PM_MODAL_AKHIR')],
      ['Saldo kas akhir', h.kasAkhir, get('AK_KAS_AKHIR')]
    ];
    const diff = pairs.filter(x => Math.abs(round2_(x[1] - x[2])) > 0.01);
    out.push(diff.length
      ? '❌ Hitungan script ≠ rumus laporan (' + p.label + '):\n   ' + diff.map(x => x[0] + ': script ' + rp_(x[1]) + ' vs sheet ' + rp_(x[2])).join('\n   ')
      : '✅ Hitungan script cocok dengan laporan ' + p.label + ' (laba bersih ' + rp_(h.labaBersih) + ').');
    out.push(Math.abs(h.selisihNeraca) < 0.01 ? '✅ Aset = Liabilitas + Ekuitas.' : '❌ Persamaan akuntansi selisih ' + rp_(h.selisihNeraca));
  }
  ui.alert('Hasil Cek Jurnal & Integritas', out.join('\n\n'), ui.ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/*  EMAIL REKAP & PENGINGAT                                            */
/* ------------------------------------------------------------------ */

function penerima_(s) {
  const e = str_(s.email);
  return e || Session.getEffectiveUser().getEmail();
}

/** Trigger bulanan: kirim rekap bulan lalu. */
function kirimRekapBulanan() {
  const s = readSettings_();
  if (str_(s.rekap) !== 'Ya') return;
  const today = todayKey_();
  const m = parseInt(today.substr(5, 2), 10) - 1; // bulan ini (0-based) → bulan lalu
  const y = parseInt(today.substr(0, 4), 10);
  const bulan = BULAN[(m + 11) % 12];
  const tahun = m === 0 ? y - 1 : y;
  kirimRekap_(bulan, tahun, s);
}

/** Menu: kirim rekap periode yang dipilih di Ringkasan. */
function kirimRekapSekarang() {
  const sel = readPeriodSelection_();
  const ui = SpreadsheetApp.getUi();
  if (!sel) { ui.alert('Pilih Bulan & Tahun di sheet Ringkasan terlebih dahulu.'); return; }
  const s = readSettings_();
  const to = kirimRekap_(sel.bulan, sel.tahun, s);
  ui.alert('Email terkirim ✅', 'Rekap ' + periodKeys_(sel.bulan, sel.tahun).label + ' dikirim ke ' + to + '.', ui.ButtonSet.OK);
}

function kirimRekap_(bulan, tahun, s) {
  const coa = readCoa_(), rows = readJurnal_();
  const p = periodKeys_(bulan, tahun);
  const q = prevPeriod_(bulan, tahun);
  const h = hitung_(coa, rows, p.start, p.end);
  const g = hitung_(coa, rows, q.start, q.end);
  const j = cekJurnal_(coa, rows);
  const to = penerima_(s);
  const nama = str_(s.nama) || 'Usaha';

  const delta = (a, b) => {
    if (!b) return '<span style="color:#888">–</span>';
    const pct = (a - b) / Math.abs(b) * 100;
    const col = pct >= 0 ? '#1E6B34' : '#9C0006';
    return '<span style="color:' + col + '">' + (pct >= 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(1) + '%</span>';
  };
  const row = (label, a, b, bold) => '<tr' + (bold ? ' style="font-weight:bold;background:#E2F0D9"' : '') + '>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee">' + label + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">' + rp_(a) + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#666">' + rp_(b) + '</td>' +
    '<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">' + delta(a, b) + '</td></tr>';
  const margin = h.pendapatan ? (h.labaBersih / h.pendapatan * 100).toFixed(1) + '%' : '–';
  const top = h.beban.slice(0, 5).map(b => '<tr><td style="padding:4px 10px">' + b.nama + '</td><td style="padding:4px 10px;text-align:right">' + rp_(b.jumlah) + '</td></tr>').join('')
    || '<tr><td style="padding:4px 10px;color:#888">Belum ada beban.</td></tr>';
  const masalah = [];
  if (j.unbalanced.length) masalah.push(j.unbalanced.length + ' transaksi tidak balance');
  if (j.unknown.length) masalah.push(j.unknown.length + ' baris dengan kode akun tidak dikenal');
  if (j.incomplete.length) masalah.push(j.incomplete.length + ' baris jurnal tidak lengkap');
  if (Math.abs(h.selisihNeraca) >= 0.01) masalah.push('persamaan akuntansi selisih ' + rp_(h.selisihNeraca));

  const html =
    '<div style="font-family:Arial,sans-serif;max-width:640px;color:#222">' +
    '<div style="background:#17365D;color:#fff;padding:16px 20px"><div style="font-size:18px;font-weight:bold">Rekap Keuangan — ' + nama + '</div>' +
    '<div style="opacity:.85">' + p.label + ' · ' + h.jumlahTransaksi + ' transaksi</div></div>' +
    '<div style="display:flex;gap:8px;padding:14px 0">' +
    kartu_('Laba bersih', h.labaBersih, 'Margin ' + margin) + kartu_('Pendapatan', h.pendapatan, '') + kartu_('Kas & bank', h.kasAkhir, '') +
    '</div>' +
    '<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#D9EAF7;font-weight:bold">' +
    '<td style="padding:6px 10px">Indikator</td><td style="padding:6px 10px;text-align:right">' + p.label + '</td>' +
    '<td style="padding:6px 10px;text-align:right">' + q.label + '</td><td style="padding:6px 10px;text-align:right">Perubahan</td></tr>' +
    row('Pendapatan bersih', h.pendapatan, g.pendapatan) + row('Harga pokok penjualan', h.hpp, g.hpp) +
    row('Laba kotor', h.labaKotor, g.labaKotor) + row('Beban operasi', h.bebanOps, g.bebanOps) +
    row('Pendapatan (beban) lain', h.lain, g.lain) + row('Laba (rugi) bersih', h.labaBersih, g.labaBersih, true) +
    row('Saldo kas & bank akhir', h.kasAkhir, g.kasAkhir) + row('Total aset', h.totalAset, g.totalAset) +
    row('Total liabilitas', h.totalLiab, g.totalLiab) + row('Modal akhir', h.modalAkhir, g.modalAkhir) +
    '</table>' +
    '<h3 style="font-size:15px;margin:18px 0 6px">5 beban terbesar</h3><table style="border-collapse:collapse;width:100%;font-size:14px">' + top + '</table>' +
    '<div style="margin-top:16px;padding:10px 12px;background:' + (masalah.length ? '#F8D7DA' : '#D4EDDA') + '">' +
    (masalah.length ? '⚠️ Perlu dicek: ' + masalah.join('; ') + '.' : '✅ Semua kontrol jurnal OK.') + '</div>' +
    '<p style="margin-top:16px"><a href="' + appUrl_() + '" style="color:#1F4E78">Buka aplikasi</a></p>' +
    '<p style="font-size:12px;color:#888">Email otomatis dari Template Akuntansi. Ubah pengaturan di sheet Pengaturan.</p></div>';

  const opts = { to: to, subject: 'Rekap Keuangan ' + nama + ' — ' + p.label, htmlBody: html, name: nama };
  if (str_(s.pdf) === 'Ya') {
    try { opts.attachments = [pdfBlob_(bulan, tahun, nama)]; }
    catch (e) { console.warn('PDF gagal: ' + e); opts.htmlBody += '<p style="font-size:12px;color:#9C0006">PDF tidak dapat dibuat: ' + e.message + '</p>'; }
  }
  MailApp.sendEmail(opts);
  return to;
}

function kartu_(label, val, sub) {
  return '<div style="flex:1;border:1px solid #D9EAF7;padding:10px 12px"><div style="font-size:12px;color:#666">' + label + '</div>' +
    '<div style="font-size:17px;font-weight:bold;color:' + (val < 0 ? '#9C0006' : '#17365D') + '">' + rp_(val) + '</div>' +
    (sub ? '<div style="font-size:12px;color:#666">' + sub + '</div>' : '') + '</div>';
}

/** Trigger harian: ingatkan bila lama tidak mencatat atau ada jurnal bermasalah. */
function cekPengingatHarian() {
  const s = readSettings_();
  if (str_(s.pengingat) !== 'Ya') return;
  const coa = readCoa_(), rows = readJurnal_();
  const real = rows.filter(r => r.sumber !== SUMBER_CONTOH);
  const lastKey = real.map(r => r.dateKey).filter(Boolean).sort().pop();
  const today = todayKey_();
  const hari = lastKey ? Math.round((parseDateKey_(today) - parseDateKey_(lastKey)) / 86400000) : null;
  const j = cekJurnal_(coa, rows);
  const pesan = [];
  if (hari === null) pesan.push('Belum ada transaksi yang dicatat (selain data contoh).');
  else if (hari >= s.hariPengingat) pesan.push('Transaksi terakhir tercatat ' + hari + ' hari lalu (' + lastKey + '). Jangan lupa mencatat pemasukan & pengeluaran terbaru.');
  if (j.unbalanced.length) pesan.push('Ada ' + j.unbalanced.length + ' transaksi tidak balance: ' + j.unbalanced.slice(0, 5).join(', ') + '.');
  if (j.unknown.length) pesan.push('Ada ' + j.unknown.length + ' baris dengan kode akun tidak dikenal.');
  if (j.incomplete.length) pesan.push('Ada ' + j.incomplete.length + ' baris jurnal tidak lengkap.');
  if (!pesan.length) return;

  // Hindari email ganda di hari yang sama
  const props = PropertiesService.getDocumentProperties();
  if (props.getProperty('LAST_REMINDER') === today) return;
  props.setProperty('LAST_REMINDER', today);

  const nama = str_(s.nama) || 'Usaha';
  MailApp.sendEmail({
    to: penerima_(s), name: nama,
    subject: 'Pengingat Pencatatan Keuangan — ' + nama,
    htmlBody: '<div style="font-family:Arial,sans-serif;max-width:560px"><h3 style="color:#17365D">Pengingat pencatatan</h3><ul>' +
      pesan.map(x => '<li style="margin-bottom:6px">' + x + '</li>').join('') + '</ul>' +
      '<p><a href="' + appUrl_() + '">Buka aplikasi</a> lalu ketuk Catat.</p>' +
      '<p style="font-size:12px;color:#888">Matikan pengingat di sheet Pengaturan (Pengingat pencatatan = Tidak).</p></div>'
  });
}

const TRIGGER_HANDLERS = ['kirimRekapBulanan', 'cekPengingatHarian', 'onChangeHandler'];

function aktifkanOtomatisasi() {
  const ui = SpreadsheetApp.getUi();
  const info = pasangTrigger_();
  ui.alert('Otomatisasi aktif ✅', info.join('\n') + '\n\nPenerima email: ' + penerima_(readSettings_()) +
    '\nUbah pengaturan di sheet Pengaturan (atau di aplikasi), lalu jalankan menu ini lagi.', ui.ButtonSet.OK);
}

/** Pasang ulang semua jadwal sesuai Pengaturan. Mengembalikan ringkasan. */
function pasangTrigger_() {
  const s = readSettings_();
  hapusTrigger_();
  const info = [];
  if (str_(s.rekap) === 'Ya') {
    ScriptApp.newTrigger('kirimRekapBulanan').timeBased().onMonthDay(s.tglRekap).atHour(7).inTimezone(tz_()).create();
    info.push('📧 Rekap bulan lalu: setiap tanggal ' + s.tglRekap + ' sekitar pukul 07.00' + (str_(s.pdf) === 'Ya' ? ' (dengan PDF)' : ''));
  }
  if (str_(s.pengingat) === 'Ya') {
    ScriptApp.newTrigger('cekPengingatHarian').timeBased().everyDays(1).atHour(s.jamPengingat).inTimezone(tz_()).create();
    info.push('⏰ Pengingat: dicek setiap hari sekitar pukul ' + s.jamPengingat + '.00 (jika ' + s.hariPengingat + ' hari tanpa transaksi / ada jurnal bermasalah)');
  }
  ScriptApp.newTrigger('onChangeHandler').forSpreadsheet(ss_()).onChange().create();
  info.push('🔄 Laporan di Sheets disusun ulang saat baris akun dihapus/ditambah');
  return info;
}

function appUrl_() {
  try { return ScriptApp.getService().getUrl() || ss_().getUrl(); } catch (e) { return ss_().getUrl(); }
}

function matikanOtomatisasi() {
  const n = hapusTrigger_();
  SpreadsheetApp.getUi().alert('Otomatisasi dimatikan', n + ' jadwal dihapus. Email rekap & pengingat tidak dikirim lagi.', SpreadsheetApp.getUi().ButtonSet.OK);
}

function hapusTrigger_() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}