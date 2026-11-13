/**
 * ============================================================================
 *  WEB APP — server: login PIN, peran, API untuk Index.html, mesin laporan
 *  Deploy: Terapkan → Deployment baru → Aplikasi web
 *          Jalankan sebagai: Saya   |   Yang memiliki akses: Siapa saja
 *  (Akses dijaga oleh login PIN di dalam aplikasi.)
 * ============================================================================
 */

const PERAN = { PEMILIK: 'Pemilik', PENCATAT: 'Pencatat' };
const SESSION_HOURS = 12;
const SESSION_DAYS_INGAT = 30;
const PIN_ROUNDS = 250;
const MAX_GAGAL = 5;
const KUNCI_MENIT = 15;
const USER_FIRST = 4; // baris data pertama di sheet Pengguna

/* ------------------------------------------------------------------ */
/*  ENTRY POINT                                                        */
/* ------------------------------------------------------------------ */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Keuangan ' + (str_(readSettings_().nama) || ''))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Sisipkan file HTML lain ke dalam template (dipakai Index.html untuk Game.html). */
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** Satu-satunya pintu masuk dari aplikasi. */
function api(req) {
  try {
    req = req || {};
    const action = String(req.action || '');
    const data = req.data || {};
    if (action === 'info') return ok_({ namaUsaha: str_(readSettings_().nama), siap: readUsers_().some(u => u.hash && u.aktif) });
    if (action === 'login') return ok_(login_(data));
    const user = auth_(req.token);
    const def = ACTIONS[action];
    if (!def) throw new Error('Aksi tidak dikenal: ' + action);
    if (def.pemilik && user.peran !== PERAN.PEMILIK) throw new Error('Hanya Pemilik yang dapat membuka bagian ini.');
    return ok_(def.run(data, user, req.token));
  } catch (e) {
    if (!(e && e.code === 'AUTH')) console.warn((e && e.message) || e);
    return { ok: false, error: (e && e.message) || String(e), code: (e && e.code) || '' };
  }
}

function ok_(data) { return { ok: true, data: data === undefined ? null : data }; }
function authError_(msg) { const e = new Error(msg || 'Sesi berakhir. Silakan masuk lagi.'); e.code = 'AUTH'; return e; }

const ACTIONS = {
  me: { run: (d, u) => publicUser_(u) },
  logout: { run: (d, u, token) => { PropertiesService.getScriptProperties().deleteProperty('sess:' + token); return true; } },
  gantiPin: { run: (d, u) => gantiPin_(u, d) },
  bootstrap: { run: (d, u) => { try { ensureUpgrades_(); } catch (e) { console.warn('upgrade: ' + e); } return bootstrap_(u); } },
  panduan: { run: (d, u) => panduan_(u) },
  game: { run: (d, u) => gameAction_(d.aksi, d, u) },
  dashboard: { run: (d, u) => dashboard_(d, u) },
  jurnal: { run: (d, u) => daftarJurnal_(d, u) },
  transaksi: { run: (d, u) => ambilTransaksi_(d.id, u) },
  simpan: { run: (d, u) => simpanCore_(d.payload, u, d.id) },
  hapus: { run: (d, u) => hapusCore_(d.id, u) },

  laporan: { pemilik: true, run: d => laporanPeriode_(d) },
  bukuBesar: { pemilik: true, run: d => bukuBesar_(d) },
  pdf: { pemilik: true, run: d => pdfBase64_(d) },
  kirimRekap: { pemilik: true, run: d => ({ to: kirimRekap_(d.bulan, Number(d.tahun), readSettings_()) }) },
  simpanAkun: { pemilik: true, run: (d, u) => simpanAkun_(d, u) },
  hapusAkun: { pemilik: true, run: (d, u) => hapusAkun_(d.kode, u) },
  simpanTemplates: { pemilik: true, run: (d, u) => simpanTemplates_(d.list, u) },
  simpanAkDetails: { pemilik: true, run: (d, u) => simpanAkDetails_(d.list, u) },
  pengaturan: { pemilik: true, run: () => pengaturan_() },
  simpanPengaturan: { pemilik: true, run: (d, u) => simpanPengaturan_(d, u) },
  otomatisasi: { pemilik: true, run: (d, u) => { const info = d.aktif ? pasangTrigger_() : (hapusTrigger_(), []); log_(u, d.aktif ? 'Aktifkan otomatisasi' : 'Matikan otomatisasi', '', ''); return { info: info, status: statusTrigger_() }; } },
  users: { pemilik: true, run: () => readUsers_().map(publicUser_) },
  simpanUser: { pemilik: true, run: (d, u) => simpanUser_(d, u) },
  hapusContoh: { pemilik: true, run: (d, u) => { const n = hapusContohCore_(); log_(u, 'Hapus data contoh', '', n + ' baris'); return { n: n }; } },
  log: { pemilik: true, run: d => bacaLog_(d.limit || 60) },
  infoArsip: { pemilik: true, run: () => infoArsip_() },
  tutupTahun: { pemilik: true, run: (d, u) => tutupTahun_(Number(d.tahun), u) }
};

/* ------------------------------------------------------------------ */
/*  PENGGUNA & LOGIN                                                   */
/* ------------------------------------------------------------------ */

function readUsers_() {
  const sh = sheet_(SH.PENGGUNA);
  if (!sh || sh.getLastRow() < USER_FIRST) return [];
  return sh.getRange(USER_FIRST, 1, sh.getLastRow() - USER_FIRST + 1, 7).getValues()
    .map((r, i) => ({
      row: USER_FIRST + i, nama: str_(r[0]), username: str_(r[1]).toLowerCase(), peran: str_(r[2]) || PERAN.PENCATAT,
      aktif: str_(r[3]) !== 'Tidak', hash: str_(r[4]), salt: str_(r[5]), last: dateKey_(r[6]) || str_(r[6])
    }))
    .filter(u => u.username);
}

function publicUser_(u) {
  return { nama: u.nama, username: u.username, peran: u.peran, aktif: u.aktif, adaPin: !!u.hash, last: u.last };
}

function hashPin_(pin, salt) {
  let h = salt + ':' + pin;
  for (let i = 0; i < PIN_ROUNDS; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt)
      .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
  }
  return h;
}

function cekFormatPin_(pin) {
  if (!/^\d{6,12}$/.test(String(pin || ''))) throw new Error('PIN harus 6–12 angka.');
}

function tulisPin_(row, pin) {
  cekFormatPin_(pin);
  const salt = Utilities.getUuid().replace(/-/g, '');
  sheet_(SH.PENGGUNA).getRange(row, 5, 1, 2).setValues([[hashPin_(String(pin), salt), salt]]);
}

function login_(d) {
  const username = str_(d.username).toLowerCase();
  const pin = String(d.pin || '');
  if (!username || !pin) throw new Error('Isi nama pengguna dan PIN.');
  const cache = CacheService.getScriptCache();
  const key = 'gagal:' + username;
  const gagal = parseInt(cache.get(key) || '0', 10);
  if (gagal >= MAX_GAGAL) throw new Error('Terlalu banyak percobaan. Coba lagi dalam ' + KUNCI_MENIT + ' menit.');
  const u = readUsers_().filter(x => x.username === username)[0];
  const cocok = u && u.aktif && u.hash && hashPin_(pin, u.salt) === u.hash;
  if (!cocok) {
    cache.put(key, String(gagal + 1), KUNCI_MENIT * 60);
    if (u && !u.hash) throw new Error('PIN untuk pengguna ini belum diatur. Minta Pemilik mengaturnya.');
    if (u && !u.aktif) throw new Error('Akun ini dinonaktifkan.');
    throw new Error('Nama pengguna atau PIN salah. Sisa percobaan: ' + Math.max(0, MAX_GAGAL - gagal - 1) + '.');
  }
  cache.remove(key);
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const exp = Date.now() + (d.ingat ? SESSION_DAYS_INGAT * 24 : SESSION_HOURS) * 3600e3;
  const props = PropertiesService.getScriptProperties();
  bersihkanSesi_(props);
  props.setProperty('sess:' + token, JSON.stringify({ u: u.username, exp: exp }));
  sheet_(SH.PENGGUNA).getRange(u.row, 7).setValue(new Date());
  log_(u, 'Masuk', '', '');
  return { token: token, user: publicUser_(u) };
}

function bersihkanSesi_(props) {
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(k => {
    if (k.indexOf('sess:') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); }
  });
}

function auth_(token) {
  if (!token) throw authError_('Silakan masuk.');
  const raw = PropertiesService.getScriptProperties().getProperty('sess:' + token);
  if (!raw) throw authError_();
  const s = JSON.parse(raw);
  if (s.exp < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('sess:' + token); throw authError_(); }
  const u = readUsers_().filter(x => x.username === s.u)[0];
  if (!u || !u.aktif) throw authError_('Akun tidak aktif lagi.');
  return u;
}

function gantiPin_(u, d) {
  if (hashPin_(String(d.lama || ''), u.salt) !== u.hash) throw new Error('PIN lama salah.');
  tulisPin_(u.row, d.baru);
  log_(u, 'Ganti PIN', '', '');
  return true;
}

function simpanUser_(d, actor) {
  const users = readUsers_();
  const username = str_(d.username).toLowerCase();
  const lama = str_(d.usernameLama).toLowerCase();
  if (!/^[a-z0-9._@+\-]{3,60}$/.test(username)) throw new Error('Nama pengguna 3–60 karakter: huruf kecil, angka, titik, @, - atau _.');
  if (!str_(d.nama)) throw new Error('Nama wajib diisi.');
  if ([PERAN.PEMILIK, PERAN.PENCATAT].indexOf(d.peran) === -1) throw new Error('Peran tidak valid.');
  const aktif = d.aktif !== false;
  const target = lama ? users.filter(x => x.username === lama)[0] : null;
  if (lama && !target) throw new Error('Pengguna tidak ditemukan.');
  if (users.some(x => x.username === username && x !== target)) throw new Error('Nama pengguna sudah dipakai.');
  if (!target && !d.pin) throw new Error('Isi PIN awal untuk pengguna baru.');
  // Jangan sampai tidak ada Pemilik aktif ber-PIN
  const sisa = users.filter(x => x !== target && x.peran === PERAN.PEMILIK && x.aktif && x.hash).length +
    ((d.peran === PERAN.PEMILIK && aktif && (d.pin || (target && target.hash))) ? 1 : 0);
  if (sisa === 0) throw new Error('Harus ada minimal satu Pemilik aktif yang punya PIN.');
  if (d.pin) cekFormatPin_(d.pin);

  const sh = sheet_(SH.PENGGUNA);
  const row = target ? target.row : Math.max(USER_FIRST - 1, sh.getLastRow()) + 1;
  sh.getRange(row, 1, 1, 4).setValues([[safeText_(d.nama), username, d.peran, aktif ? 'Ya' : 'Tidak']]);
  if (d.pin) tulisPin_(row, d.pin);
  if (target && target.username !== username) gantiPencatat_(target.username, username);
  log_(actor, target ? 'Ubah pengguna' : 'Tambah pengguna', '', username + ' (' + d.peran + (aktif ? '' : ', nonaktif') + (d.pin ? ', PIN baru' : '') + ')');
  return readUsers_().map(publicUser_);
}

/** Bila username diganti, perbarui kolom "Dicatat oleh" di jurnal. */
function gantiPencatat_(lama, baru) {
  const sh = sheet_(SH.JURNAL);
  const n = sh.getMaxRows() - JU_FIRST + 1;
  const vals = sh.getRange(JU_FIRST, 15, n, 1).getValues();
  let ubah = false;
  vals.forEach(r => { if (str_(r[0]).toLowerCase() === lama) { r[0] = baru; ubah = true; } });
  if (ubah) sh.getRange(JU_FIRST, 15, n, 1).setValues(vals);
}

/** Menu Sheets: atur PIN pemilik (akun Google yang membuka spreadsheet). */
function aturPinPemilik() {
  const ui = SpreadsheetApp.getUi();
  const email = str_(Session.getEffectiveUser().getEmail()).toLowerCase();
  const users = readUsers_();
  let u = users.filter(x => x.username === email)[0] || users.filter(x => x.peran === PERAN.PEMILIK)[0];
  const r = ui.prompt('Atur PIN Pemilik', 'Nama pengguna: ' + (u ? u.username : email) + '\nKetik PIN baru (6–12 angka):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pin = str_(r.getResponseText());
  try { cekFormatPin_(pin); } catch (e) { ui.alert(e.message); return; }
  const sh = sheet_(SH.PENGGUNA);
  if (!u) {
    const row = Math.max(USER_FIRST - 1, sh.getLastRow()) + 1;
    sh.getRange(row, 1, 1, 4).setValues([['Pemilik', email || 'pemilik', PERAN.PEMILIK, 'Ya']]);
    u = { row: row, username: email || 'pemilik' };
  }
  tulisPin_(u.row, pin);
  sh.getRange(u.row, 3, 1, 2).setValues([[PERAN.PEMILIK, 'Ya']]);
  ui.alert('PIN tersimpan ✅', 'Masuk ke aplikasi dengan:\nNama pengguna: ' + u.username + '\nPIN: (yang baru saja Anda ketik)', ui.ButtonSet.OK);
}

/** Menu Sheets: tampilkan link aplikasi. */
function linkAplikasi() {
  const ui = SpreadsheetApp.getUi();
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { }
  ui.alert('Link Aplikasi', url
    ? url + '\n\nBagikan link ini ke pencatat. Mereka masuk dengan nama pengguna & PIN yang Anda buat di halaman Pengaturan → Pengguna.'
    : 'Aplikasi belum di-deploy.\n\nDi editor Apps Script: Terapkan → Deployment baru → jenis "Aplikasi web" → Jalankan sebagai: Saya, Akses: Siapa saja → Terapkan. Salin URL /exec yang muncul.', ui.ButtonSet.OK);
}

/* ------------------------------------------------------------------ */
/*  LOG AKTIVITAS                                                      */
/* ------------------------------------------------------------------ */

function log_(u, aksi, id, detail) {
  try {
    const sh = sheet_(SH.LOG);
    if (!sh) return;
    const row = Math.max(3, sh.getLastRow()) + 1;
    ensureSize_(sh, row + 10, 5);
    sh.getRange(row, 1, 1, 5).setValues([[new Date(), u ? u.username : '', aksi, id || '', safeText_(detail || '')]]);
  } catch (e) { console.warn('log gagal: ' + e); }
}

function bacaLog_(limit) {
  const sh = sheet_(SH.LOG);
  if (!sh || sh.getLastRow() < 4) return [];
  const n = Math.min(limit, sh.getLastRow() - 3);
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues().reverse().map(r => ({
    waktu: r[0] instanceof Date ? Utilities.formatDate(r[0], tz_(), 'yyyy-MM-dd HH:mm') : str_(r[0]),
    user: str_(r[1]), aksi: str_(r[2]), id: str_(r[3]), detail: str_(r[4])
  }));
}

/* ------------------------------------------------------------------ */
/*  DATA DASAR                                                         */
/* ------------------------------------------------------------------ */

function bootstrap_(u) {
  const rows = readJurnal_();
  const years = {};
  rows.forEach(r => { if (r.dateKey) years[r.dateKey.substr(0, 4)] = true; });
  years[todayKey_().substr(0, 4)] = true;
  const s = readSettings_();
  return {
    user: publicUser_(u),
    namaUsaha: str_(s.nama),
    accounts: readCoa_(),
    templates: readTemplates_(),
    akDetails: readAkDetails_(),
    today: todayKey_(),
    nextId: nextId_(rows),
    tahun: Object.keys(years).map(Number).sort(),
    terakhir: rows.map(r => r.dateKey).filter(Boolean).sort().pop() || todayKey_(),
    adaContoh: rows.some(r => r.sumber === SUMBER_CONTOH),
    urlSheet: ss_().getUrl(),
    reportsPending: !!PropertiesService.getDocumentProperties().getProperty('REPORT_PENDING_V1'),
    reportsScheduled: !PropertiesService.getDocumentProperties().getProperty('REPORT_ERROR_V1'),
    jenis: JENIS, klasifikasi: KLASIFIKASI, katAk: KAT_AK, bulan: BULAN, setahun: SETAHUN
  };
}

function groupTrx_(rows, accMap) {
  const by = {}, order = [];
  rows.forEach(r => {
    if (!r.id) return;
    if (!by[r.id]) { by[r.id] = { id: r.id, tanggal: r.dateKey, deskripsi: r.desc, oleh: r.oleh, sumber: r.sumber, lines: [], total: 0, selisih: 0 }; order.push(r.id); }
    const t = by[r.id];
    const a = accMap[r.kode];
    t.lines.push({ kode: r.kode, nama: a ? a.nama : '(kode tidak dikenal)', kas: !!(a && a.kel === KELOMPOK_KAS), debit: r.debit, kredit: r.kredit, kat: r.kat, det: r.det });
    t.total += r.debit; t.selisih += r.debit - r.kredit;
    if (r.dateKey && (!t.tanggal || r.dateKey > t.tanggal)) t.tanggal = r.dateKey;
    if (!t.oleh && r.oleh) t.oleh = r.oleh;
  });
  return order.map(id => { const t = by[id]; t.selisih = round2_(t.selisih); return t; });
}

function bolehUbah_(t, u) {
  if (u.peran === PERAN.PEMILIK) return true;
  return t.oleh === u.username && t.sumber !== SUMBER_CONTOH;
}

function accMap_(coa) { const m = {}; coa.forEach(a => m[a.kode] = a); return m; }

function periode_(d) {
  const bulan = d.bulan === SETAHUN || BULAN.indexOf(d.bulan) !== -1 ? d.bulan : BULAN[parseInt(todayKey_().substr(5, 2), 10) - 1];
  const tahun = parseInt(d.tahun, 10) || parseInt(todayKey_().substr(0, 4), 10);
  return Object.assign(periodKeys_(bulan, tahun), { bulan: bulan, tahun: tahun });
}

/* ------------------------------------------------------------------ */
/*  DASHBOARD                                                          */
/* ------------------------------------------------------------------ */

function dashboard_(d, u) {
  const coa = readCoa_(), rows = readJurnal_(), acc = accMap_(coa);
  const p = periode_(d), q = prevPeriod_(p.bulan, p.tahun);
  const h = hitung_(coa, rows, p.start, p.end);
  const g = hitung_(coa, rows, q.start, q.end);
  const trend = [];
  for (let m = 1; m <= 12; m++) {
    const k = periodKeys_(BULAN[m - 1], p.tahun);
    const x = hitung_(coa, rows, k.start, k.end);
    trend.push({ bulan: BULAN[m - 1].substr(0, 3), pendapatan: x.totalPendapatan, beban: x.totalBeban, laba: x.labaBersih, kas: x.kasAkhir, ada: x.jumlahTransaksi > 0 });
  }
  const j = cekJurnal_(coa, rows);
  const mine = u.peran === PERAN.PEMILIK ? rows : rows.filter(r => r.oleh === u.username);
  const recent = groupTrx_(mine, acc).reverse().slice(0, 6).map(t => ringkasTrx_(t, u));
  const pick = x => ({ pendapatan: x.pendapatan, hpp: x.hpp, labaKotor: x.labaKotor, bebanOps: x.bebanOps, lain: x.lain, labaBersih: x.labaBersih, kasAkhir: x.kasAkhir, kasAwal: x.kasAwal, totalAset: x.totalAset, totalLiab: x.totalLiab, modalAkhir: x.modalAkhir, jumlahTransaksi: x.jumlahTransaksi });
  return {
    periode: { label: p.label, bulan: p.bulan, tahun: p.tahun, start: p.start, end: p.end, prevLabel: q.label },
    kini: pick(h), lalu: pick(g),
    kas: h.saldo.filter(a => a.kel === KELOMPOK_KAS).map(a => ({ kode: a.kode, nama: a.nama, saldo: a.saldo })),
    piutang: h.saldo.filter(a => a.kel === 'Piutang').reduce((s, a) => s + a.saldo, 0),
    utang: -h.saldo.filter(a => a.jenis === 'Liability').reduce((s, a) => s + a.saldo, 0),
    persediaan: h.saldo.filter(a => /persediaan/i.test(a.kel)).reduce((s, a) => s + a.saldo, 0),
    beban: h.beban,
    trend: trend,
    kontrol: { tidakBalance: j.unbalanced, kodeAsing: j.unknown, tidakLengkap: j.incomplete, belumKlasifikasi: h.belumKlasifikasi, selisihNeraca: h.selisihNeraca },
    recent: recent
  };
}

function ringkasTrx_(t, u) {
  return { id: t.id, tanggal: t.tanggal, deskripsi: t.deskripsi, total: t.total, oleh: t.oleh, sumber: t.sumber, selisih: t.selisih, lines: t.lines, boleh: bolehUbah_(t, u) };
}

/* ------------------------------------------------------------------ */
/*  JURNAL: daftar, ambil, simpan, hapus                               */
/* ------------------------------------------------------------------ */

function daftarJurnal_(d, u) {
  const coa = readCoa_(), acc = accMap_(coa);
  let rows = readJurnal_();
  if (u.peran !== PERAN.PEMILIK) rows = rows.filter(r => r.oleh === u.username);
  const p = periode_(d);
  let list = groupTrx_(rows, acc).filter(t => d.semua || (t.tanggal >= p.start && t.tanggal <= p.end) || !t.tanggal);
  const q = str_(d.q).toLowerCase();
  if (q) list = list.filter(t => (t.id + ' ' + t.deskripsi + ' ' + t.oleh + ' ' + t.lines.map(l => l.kode + ' ' + l.nama + ' ' + l.det).join(' ')).toLowerCase().indexOf(q) !== -1);
  if (d.kode) list = list.filter(t => t.lines.some(l => l.kode === d.kode));
  list.sort((a, b) => (b.tanggal || '').localeCompare(a.tanggal || '') || b.id.localeCompare(a.id));
  return { periode: { label: p.label }, list: list.slice(0, 500).map(t => ringkasTrx_(t, u)), total: list.length };
}

function ambilTransaksi_(id, u) {
  const coa = readCoa_();
  const t = groupTrx_(readJurnal_().filter(r => r.id === id), accMap_(coa))[0];
  if (!t) throw new Error('Transaksi ' + id + ' tidak ditemukan.');
  if (u.peran !== PERAN.PEMILIK && t.oleh !== u.username) throw new Error('Anda hanya dapat membuka transaksi yang Anda catat.');
  return ringkasTrx_(t, u);
}

/** Simpan transaksi baru (editId kosong) atau ganti transaksi lama. */
function simpanCore_(payload, user, editId) {
  const coa = readCoa_();
  const accMap = accMap_(coa);
  const err = validasiPayload_(payload, accMap);
  if (err) throw new Error(err);

  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SH.JURNAL);
    const existing = readJurnal_();
    const date = parseDateKey_(payload.tanggal);
    let id = editId ? str_(editId) : nextId_(existing);
    let old = [];
    if (editId) {
      old = existing.filter(r => r.id === id);
      if (!old.length) throw new Error('Transaksi ' + id + ' tidak ditemukan (mungkin sudah dihapus).');
      const t = { oleh: old[0].oleh, sumber: old[0].sumber };
      if (!bolehUbah_(t, user)) throw new Error('Anda hanya dapat mengubah transaksi yang Anda catat sendiri.');
    }
    const oleh = old.length ? (old[0].oleh || user.username) : user.username;
    const sumber = old.length && old[0].sumber && old[0].sumber !== SUMBER_CONTOH ? old[0].sumber : 'Form';
    const rows = payload.lines.map(l => {
      const a = accMap[code_(l.kode)];
      const isKas = a.kel === KELOMPOK_KAS;
      return {
        date: date, id: id, desc: str_(payload.deskripsi), kode: a.kode,
        debit: round2_(num_(l.debit)), kredit: round2_(num_(l.kredit)),
        kat: isKas ? str_(l.kat) : '', det: isKas && str_(l.kat) ? str_(l.det) : '', sumber: sumber, oleh: oleh
      };
    });

    let diurutkan = false;
    if (editId) {
      const first = existing.findIndex(r => r.id === id);
      const sisa = existing.filter(r => r.id !== id);
      sisa.splice(Math.min(first, sisa.length), 0, ...rows);
      clearJurnalInputs_(sh);
      writeJurnalRows_(sh, sortRows_(sisa), JU_FIRST);
      diurutkan = true;
    } else {
      writeJurnalRows_(sh, rows, lastJurnalRow_() + 1);
      const lastKey = existing.map(r => r.dateKey).filter(Boolean).sort().pop();
      if (lastKey && payload.tanggal < lastKey) { sortJurnalCore_(); diurutkan = true; }
    }

    const baru = tambahAkDetailBaru_(rows);
    SpreadsheetApp.flush();
    if (baru) rebuildReports_();
    log_(user, editId ? 'Ubah transaksi' : 'Tambah transaksi', id, str_(payload.deskripsi) + ' — ' + rp_(rows.reduce((s, r) => s + r.debit, 0)));
    const all = readJurnal_();
    return {
      id: id, edit: !!editId, diurutkan: diurutkan, nextId: nextId_(all), akDetails: readAkDetails_(),
      message: (editId ? id + ' diperbarui' : 'Tersimpan sebagai ' + id) + ' (' + rows.length + ' baris).'
    };
  } finally { lock.releaseLock(); }
}

function tambahAkDetailBaru_(rows) {
  const ak = readAkDetails_();
  const have = {};
  ak.forEach(d => have[d.kat + '|' + d.det] = true);
  const baru = [];
  rows.forEach(r => { if (r.kat && r.det && !have[r.kat + '|' + r.det]) { baru.push([r.kat, safeText_(r.det)]); have[r.kat + '|' + r.det] = true; } });
  if (baru.length) {
    const set = sheet_(SH.SET);
    const lr = Math.max(SET_AK_FIRST - 1, set.getLastRow());
    set.getRange(lr + 1, 1, baru.length, 2).setValues(baru);
  }
  return baru.length > 0;
}

function hapusCore_(id, user) {
  id = str_(id);
  if (!id) throw new Error('ID kosong.');
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(SH.JURNAL);
    const rows = readJurnal_();
    const target = rows.filter(r => r.id === id);
    if (!target.length) throw new Error('Transaksi ' + id + ' tidak ditemukan.');
    if (!bolehUbah_({ oleh: target[0].oleh, sumber: target[0].sumber }, user)) throw new Error('Anda hanya dapat menghapus transaksi yang Anda catat sendiri.');
    clearJurnalInputs_(sh);
    writeJurnalRows_(sh, rows.filter(r => r.id !== id), JU_FIRST);
    SpreadsheetApp.flush();
    log_(user, 'Hapus transaksi', id, target[0].desc + ' — ' + rp_(target.reduce((s, r) => s + r.debit, 0)));
    return { message: id + ' dihapus (' + target.length + ' baris).', nextId: nextId_(readJurnal_()) };
  } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/*  LAPORAN LENGKAP (mesin, tidak bergantung pada pilihan di Sheets)   */
/* ------------------------------------------------------------------ */

function laporan_(coa, rows, startKey, endKey, akMaster) {
  const acc = {};
  coa.forEach(a => acc[a.kode] = Object.assign({ before: 0, pd: 0, pk: 0 }, a));
  const kasMoves = {};
  rows.forEach(r => {
    const a = acc[r.kode];
    if (!a || !r.dateKey || r.dateKey > endKey) return;
    if (r.dateKey < startKey) { a.before += r.debit - r.kredit; return; }
    a.pd += r.debit; a.pk += r.kredit;
    if (a.kel === KELOMPOK_KAS) {
      const kat = KAT_AK.indexOf(r.kat) !== -1 ? r.kat : '';
      const k = kat + '|' + (kat ? r.det : '');
      kasMoves[k] = (kasMoves[k] || 0) + r.debit - r.kredit;
    }
  });
  const nominal = a => a.jenis === 'Revenue' || a.jenis === 'Expense';
  const gl = coa.map(a0 => {
    const a = acc[a0.kode];
    const sign = a.normal === 'Credit' ? -1 : 1;
    const awal = nominal(a) ? 0 : sign * a.before;
    const akhir = awal + (a.normal === 'Credit' ? a.pk - a.pd : a.pd - a.pk);
    return { kode: a.kode, nama: a.nama, jenis: a.jenis, normal: a.normal, klas: a.klas, kel: a.kel, awal: awal, debit: a.pd, kredit: a.pk, akhir: akhir, dt: sign * akhir };
  });
  const ld = -coa.filter(nominal).reduce((s, a) => s + acc[a.kode].before, 0);
  const glAll = gl.concat([{ kode: 'LD', nama: 'Laba ditahan (s.d. awal periode)', jenis: 'Equity', normal: 'Credit', awal: ld, debit: 0, kredit: 0, akhir: ld, dt: -ld }]);

  // Neraca saldo
  const ns = glAll.map(g => ({ kode: g.kode, nama: g.nama, debit: Math.max(g.dt, 0), kredit: Math.max(-g.dt, 0) }));
  const nsTot = { debit: ns.reduce((s, x) => s + x.debit, 0), kredit: ns.reduce((s, x) => s + x.kredit, 0) };

  // Laba rugi
  const cr = g => g.kredit - g.debit, dr = g => g.debit - g.kredit;
  const sec = (filter, fn) => { const items = gl.filter(filter).map(g => ({ kode: g.kode, nama: g.nama, nilai: fn(g) })); return { items: items, total: items.reduce((s, x) => s + x.nilai, 0) }; };
  const isRev = g => g.jenis === 'Revenue', isExp = g => g.jenis === 'Expense';
  const pendapatan = sec(g => isRev(g) && g.klas === 'Pendapatan', cr);
  const hpp = sec(g => isExp(g) && g.klas === 'Harga Pokok Penjualan', dr);
  const bebanOps = sec(g => isExp(g) && g.klas === 'Beban Operasi', dr);
  const lain = sec(g => (isRev(g) && g.klas !== 'Pendapatan') || (isExp(g) && g.klas !== 'Harga Pokok Penjualan' && g.klas !== 'Beban Operasi'), cr);
  const labaKotor = pendapatan.total - hpp.total;
  const labaOperasi = labaKotor - bebanOps.total;
  const labaBersih = labaOperasi + lain.total;

  // Perubahan modal
  const eq = gl.filter(g => g.jenis === 'Equity');
  const modalAwal = ld + eq.reduce((s, g) => s + (g.normal === 'Debit' ? -g.awal : g.awal), 0);
  const pmItems = [{ label: 'Modal awal periode', nilai: modalAwal }]
    .concat(eq.filter(g => g.normal !== 'Debit').map(g => ({ label: g.nama, ket: 'Penambahan selama periode', nilai: g.kredit - g.debit })))
    .concat([{ label: 'Laba (rugi) bersih', nilai: labaBersih }])
    .concat(eq.filter(g => g.normal === 'Debit').map(g => ({ label: g.nama, ket: 'Pengurang modal', nilai: -(g.debit - g.kredit) })));
  const modalAkhir = pmItems.reduce((s, x) => s + x.nilai, 0);

  // Posisi keuangan
  const groups = (list, order, val) => {
    const by = {}, keys = [];
    list.forEach(g => { const k = g.klas || 'Lainnya'; if (!by[k]) { by[k] = []; keys.push(k); } by[k].push({ kode: g.kode, nama: g.nama, nilai: val(g) }); });
    keys.sort((x, y) => { const ix = order.indexOf(x), iy = order.indexOf(y); return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy); });
    return keys.map(k => ({ klas: k, items: by[k], total: by[k].reduce((s, x) => s + x.nilai, 0) }));
  };
  const aset = groups(gl.filter(g => g.jenis === 'Asset'), ['Aset Lancar', 'Aset Tidak Lancar'], g => g.dt);
  const liab = groups(gl.filter(g => g.jenis === 'Liability'), ['Liabilitas Jangka Pendek', 'Liabilitas Jangka Panjang'], g => -g.dt);
  const totalAset = aset.reduce((s, x) => s + x.total, 0);
  const totalLiab = liab.reduce((s, x) => s + x.total, 0);

  // Arus kas
  const akSections = KAT_AK.map(kat => {
    const items = [];
    const seen = {};
    (akMaster || []).filter(d => d.kat === kat).forEach(d => { seen[d.det] = true; items.push({ det: d.det, nilai: kasMoves[kat + '|' + d.det] || 0 }); });
    Object.keys(kasMoves).forEach(k => {
      const parts = k.split('|');
      if (parts[0] === kat && !seen[parts[1]]) items.push({ det: parts[1] || '(tanpa detail)', nilai: kasMoves[k] });
    });
    return { kat: kat, label: KAT_AK_LABEL[kat].replace('ARUS KAS DARI AKTIVITAS ', 'Aktivitas ').replace(/(Aktivitas )(\w)(\w*)/, (m, a, b, c) => a + b + c.toLowerCase()), items: items, total: items.reduce((s, x) => s + x.nilai, 0) };
  });
  const belum = kasMoves['|'] || 0;
  const kasGl = gl.filter(g => g.kel === KELOMPOK_KAS);
  const kasAwal = kasGl.reduce((s, g) => s + g.awal * (g.normal === 'Credit' ? -1 : 1), 0);
  const naik = akSections.reduce((s, x) => s + x.total, 0) + belum;
  const kasAkhir = kasAwal + naik;
  const kasPK = kasGl.reduce((s, g) => s + g.dt, 0);

  return {
    periode: { start: startKey, end: endKey },
    gl: glAll, ns: { items: ns, total: nsTot, selisih: round2_(nsTot.debit - nsTot.kredit) },
    lr: { pendapatan, hpp, labaKotor, bebanOps, labaOperasi, lain, labaBersih },
    pm: { items: pmItems, modalAwal, modalAkhir },
    pk: { aset, liab, totalAset, totalLiab, modalAkhir, totalLE: totalLiab + modalAkhir, selisih: round2_(totalAset - totalLiab - modalAkhir) },
    ak: { sections: akSections, belum, naik, kasAwal, kasAkhir, kasPK, rekon: round2_(kasAkhir - kasPK) }
  };
}

function laporanPeriode_(d) {
  const p = periode_(d);
  const lap = laporan_(readCoa_(), readJurnal_(), p.start, p.end, readAkDetails_());
  lap.periode = { label: p.label, bulan: p.bulan, tahun: p.tahun, start: p.start, end: p.end, perTanggal: perTanggal_(p.end) };
  lap.kontrol = cekJurnal_(readCoa_(), readJurnal_());
  return lap;
}

function perTanggal_(key) {
  return parseInt(key.substr(8, 2), 10) + ' ' + BULAN[parseInt(key.substr(5, 2), 10) - 1] + ' ' + key.substr(0, 4);
}

function bukuBesar_(d) {
  const coa = readCoa_();
  const a = coa.filter(x => x.kode === str_(d.kode))[0];
  if (!a) throw new Error('Akun tidak ditemukan.');
  const p = periode_(d);
  const sign = a.normal === 'Credit' ? -1 : 1;
  const nominal = a.jenis === 'Revenue' || a.jenis === 'Expense';
  const rows = readJurnal_().filter(r => r.kode === a.kode && r.dateKey && r.dateKey <= p.end);
  let saldo = nominal ? 0 : sign * rows.filter(r => r.dateKey < p.start).reduce((s, r) => s + r.debit - r.kredit, 0);
  const awal = saldo;
  const mutasi = sortRows_(rows.filter(r => r.dateKey >= p.start)).map(r => {
    saldo += sign * (r.debit - r.kredit);
    return { tanggal: r.dateKey, id: r.id, deskripsi: r.desc, debit: r.debit, kredit: r.kredit, saldo: saldo };
  });
  return { akun: a, periode: { label: p.label }, awal: awal, mutasi: mutasi, akhir: saldo };
}

/* ------------------------------------------------------------------ */
/*  PDF (HTML → PDF, tanpa mengubah sheet)                             */
/* ------------------------------------------------------------------ */

function laporanHtml_(lap, nama) {
  const n = v => rp_(v).replace('-Rp ', '(Rp ') + (v < 0 ? ')' : '');
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const row = (l, v, cls) => '<tr class="' + (cls || '') + '"><td>' + esc(l) + '</td><td class="n">' + n(v) + '</td></tr>';
  const head = (t, sub) => '<h2>' + esc(t) + '</h2><div class="sub">' + esc(nama) + ' — ' + esc(sub) + '</div>';
  const items = list => list.map(x => row((x.kode ? x.kode + '  ' : '') + x.nama, x.nilai)).join('');
  const L = lap.lr, P = lap.pm, K = lap.pk, A = lap.ak;
  let h = '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10.5pt;color:#1b2a36}h2{color:#12324A;margin:0 0 2px;font-size:15pt}' +
    '.sub{color:#5B6B78;margin-bottom:10px}table{width:100%;border-collapse:collapse;margin-bottom:6px}td{padding:4px 6px;border-bottom:1px solid #e3e8ec}' +
    '.n{text-align:right;white-space:nowrap}.sec td{background:#12324A;color:#fff;font-weight:bold}.tot td{font-weight:bold;background:#f2f5f7}' +
    '.fin td{font-weight:bold;background:#E8F2EC;border-top:2px solid #12324A}.page{page-break-after:always;padding:8px 0}</style></head><body>';
  h += '<div class="page">' + head('Laporan Laba Rugi', 'Periode ' + lap.periode.label) + '<table>' +
    '<tr class="sec"><td colspan="2">Pendapatan usaha</td></tr>' + items(L.pendapatan.items) + row('Pendapatan bersih', L.pendapatan.total, 'tot') +
    '<tr class="sec"><td colspan="2">Harga pokok penjualan</td></tr>' + items(L.hpp.items) + row('Total HPP', L.hpp.total, 'tot') +
    row('Laba kotor', L.labaKotor, 'fin') +
    '<tr class="sec"><td colspan="2">Beban operasi</td></tr>' + items(L.bebanOps.items) + row('Total beban operasi', L.bebanOps.total, 'tot') +
    row('Laba operasi', L.labaOperasi, 'fin') +
    '<tr class="sec"><td colspan="2">Pendapatan (beban) lain-lain</td></tr>' + items(L.lain.items) + row('Total lain-lain', L.lain.total, 'tot') +
    row('Laba (rugi) bersih', L.labaBersih, 'fin') + '</table></div>';
  h += '<div class="page">' + head('Laporan Perubahan Modal', 'Periode ' + lap.periode.label) + '<table>' +
    P.items.map(x => row(x.label, x.nilai)).join('') + row('Modal akhir periode', P.modalAkhir, 'fin') + '</table></div>';
  const grp = gs => gs.map(g => '<tr class="tot"><td colspan="2">' + esc(g.klas) + '</td></tr>' + items(g.items) + row('Total ' + g.klas, g.total, 'tot')).join('');
  h += '<div class="page">' + head('Laporan Posisi Keuangan', 'Per ' + lap.periode.perTanggal) + '<table>' +
    '<tr class="sec"><td colspan="2">Aset</td></tr>' + grp(K.aset) + row('Total aset', K.totalAset, 'fin') +
    '<tr class="sec"><td colspan="2">Liabilitas</td></tr>' + grp(K.liab) + row('Total liabilitas', K.totalLiab, 'fin') +
    '<tr class="sec"><td colspan="2">Ekuitas</td></tr>' + row('Modal akhir', K.modalAkhir) + row('Total liabilitas + ekuitas', K.totalLE, 'fin') + '</table></div>';
  h += '<div>' + head('Laporan Arus Kas (metode langsung)', 'Periode ' + lap.periode.label) + '<table>' +
    A.sections.map(s => '<tr class="sec"><td colspan="2">' + esc(s.label) + '</td></tr>' + s.items.map(x => row(x.det, x.nilai)).join('') + row('Arus kas bersih', s.total, 'tot')).join('') +
    (A.belum ? row('Belum diklasifikasi', A.belum) : '') +
    row('Kenaikan (penurunan) kas', A.naik, 'tot') + row('Saldo kas awal', A.kasAwal) + row('Saldo kas akhir', A.kasAkhir, 'fin') + '</table></div>';
  return h + '</body></html>';
}

function pdfBlob_(bulan, tahun, nama) {
  const p = periodKeys_(bulan, tahun);
  const lap = laporan_(readCoa_(), readJurnal_(), p.start, p.end, readAkDetails_());
  lap.periode = { label: p.label, perTanggal: perTanggal_(p.end) };
  return Utilities.newBlob(laporanHtml_(lap, nama), MimeType.HTML, 'laporan.html').getAs(MimeType.PDF)
    .setName('Laporan Keuangan ' + nama + ' - ' + p.label + '.pdf');
}

function pdfBase64_(d) {
  const p = periode_(d);
  const nama = str_(readSettings_().nama) || 'Usaha';
  const blob = pdfBlob_(p.bulan, p.tahun, nama);
  return { name: blob.getName(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/* ------------------------------------------------------------------ */
/*  AKUN, TEMPLATE, DETAIL ARUS KAS                                    */
/* ------------------------------------------------------------------ */

function kodeDipakai_(kode) {
  return readJurnal_().some(r => r.kode === kode);
}

/**
 * Simpan chart of accounts tanpa menunggu delapan laporan selesai disusun.
 * Perubahan nama saja sudah tercermin melalui VLOOKUP di laporan Sheets;
 * perubahan struktural antre untuk dibangun oleh time-driven trigger.
 */
function simpanAkun_(d, u) {
  const start = Date.now();
  const a = { kode: code_(d.kode), nama: str_(d.nama), jenis: str_(d.jenis), normal: str_(d.normal), klas: str_(d.klas), kel: str_(d.kel) };
  const lama = code_(d.kodeLama);
  if (!/^[A-Za-z0-9.\-]{1,12}$/.test(a.kode)) throw new Error('Kode akun 1–12 karakter (huruf/angka/titik/strip).');
  if (!a.nama) throw new Error('Nama akun wajib diisi.');
  if (JENIS.indexOf(a.jenis) === -1) throw new Error('Jenis akun tidak valid.');
  if (['Debit', 'Credit'].indexOf(a.normal) === -1) throw new Error('Saldo normal harus Debit atau Credit.');
  if (KLASIFIKASI.indexOf(a.klas) === -1) throw new Error('Klasifikasi laporan tidak valid.');

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const coa = readCoa_();
    const old = lama ? coa.find(x => x.kode === lama) : null;
    if (lama && !old) throw new Error('Akun lama tidak ditemukan.');
    if (coa.some(x => x.kode === a.kode && x.kode !== lama)) throw new Error('Kode ' + a.kode + ' sudah dipakai akun lain.');
    if (lama && lama !== a.kode && kodeDipakai_(lama)) throw new Error('Kode ' + lama + ' sudah dipakai di jurnal, jadi tidak bisa diganti. Ubah nama/klasifikasinya saja, atau buat akun baru.');

    const structural = !old || ['kode', 'jenis', 'normal', 'klas', 'kel'].some(k => old[k] !== a[k]);
    const sh = sheet_(SH.COA);
    const vals = sh.getRange(COA_FIRST, 1, Math.max(1, sh.getLastRow() - COA_FIRST + 1), 1).getValues();
    let row = -1;
    if (lama) row = vals.findIndex(r => code_(r[0]) === lama);
    if (lama) row += COA_FIRST;
    else row = Math.max(COA_FIRST - 1, sh.getLastRow()) + 1;
    ensureSize_(sh, row + 10, 6);
    sh.getRange(row, 1).setNumberFormat('@');
    sh.getRange(row, 1, 1, 6).setValues([[a.kode, safeText_(a.nama), a.jenis, a.normal, a.klas, safeText_(a.kel)]]);
    if (lama && lama !== a.kode) gantiKodeTemplate_(lama, a.kode);
    // Jangan flush semua formula spreadsheet sebelum mengonfirmasi penyimpanan.
    // Daftar baru dibuat dari snapshot COA yang sudah dibaca untuk validasi.
    const updated = old ? coa.map(x => x.kode === lama ? a : x) : coa.concat([a]);
    const report = structural ? queueReportRefresh_() : reportRefreshStatus_();
    log_(u, lama ? 'Ubah akun' : 'Tambah akun', a.kode, a.nama);
    console.log('simpanAkun_ (' + (structural ? 'struktural' : 'nama saja') + '): ' + (Date.now() - start) + ' ms');
    return { accounts: updated, report: report };
  } finally { lock.releaseLock(); }
}

function hapusAkun_(kode, u) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    kode = code_(kode);
    if (kodeDipakai_(kode)) throw new Error('Akun ' + kode + ' sudah dipakai di jurnal sehingga tidak bisa dihapus.');
    if (readTemplates_().some(t => [t.d1, t.k1, t.d2, t.k2].indexOf(kode) !== -1)) throw new Error('Akun ' + kode + ' masih dipakai di Template Transaksi. Ubah templatenya dulu.');
    const sh = sheet_(SH.COA);
    const vals = sh.getRange(COA_FIRST, 1, Math.max(1, sh.getLastRow() - COA_FIRST + 1), 1).getValues();
    const idx = vals.findIndex(r => code_(r[0]) === kode);
    if (idx === -1) throw new Error('Akun tidak ditemukan.');
    sh.deleteRow(COA_FIRST + idx);
    const report = queueReportRefresh_();
    log_(u, 'Hapus akun', kode, '');
    return { accounts: readCoa_().filter(a => a.kode !== kode), report: report };
  } finally { lock.releaseLock(); }
}

function gantiKodeTemplate_(lama, baru) {
  const sh = sheet_(SH.TEMPLATE);
  if (sh.getLastRow() < TPL_FIRST) return;
  const rg = sh.getRange(TPL_FIRST, 1, sh.getLastRow() - TPL_FIRST + 1, 10);
  const v = rg.getValues();
  v.forEach(r => [1, 2, 4, 5].forEach(i => { if (code_(r[i]) === lama) r[i] = baru; }));
  rg.setValues(v.map(r => r.map(x => str_(x))));
}

function simpanTemplates_(list, u) {
  if (!Array.isArray(list)) throw new Error('Data template tidak valid.');
  const kodeOk = accMap_(readCoa_());
  const sideOk = v => !v || /^PILIH(:.*)?$/i.test(v) || kodeOk[v];
  const rows = list.map((t, i) => {
    const r = [str_(t.nama), code_(t.d1), code_(t.k1), str_(t.l1), code_(t.d2), code_(t.k2), str_(t.l2), str_(t.kat), str_(t.det), str_(t.help)];
    if (!r[0]) throw new Error('Template ke-' + (i + 1) + ': nama wajib diisi.');
    if (!r[1] || !r[2]) throw new Error('Template "' + r[0] + '": Debit 1 dan Kredit 1 wajib diisi.');
    [r[1], r[2], r[4], r[5]].forEach(v => { if (!sideOk(v)) throw new Error('Template "' + r[0] + '": akun ' + v + ' tidak ada.'); });
    if ((r[4] && !r[5]) || (!r[4] && r[5])) throw new Error('Template "' + r[0] + '": pasangan 2 harus berisi Debit dan Kredit.');
    if (r[7] && KAT_AK.indexOf(r[7]) === -1) throw new Error('Template "' + r[0] + '": kategori arus kas tidak valid.');
    return r.map(x => safeText_(x));
  });
  const sh = sheet_(SH.TEMPLATE);
  const n = sh.getMaxRows() - TPL_FIRST + 1;
  sh.getRange(TPL_FIRST, 1, n, 10).clearContent();
  ensureSize_(sh, TPL_FIRST + rows.length + 20, 10);
  if (rows.length) sh.getRange(TPL_FIRST, 1, rows.length, 10).setValues(rows);
  log_(u, 'Simpan template', '', rows.length + ' template');
  return readTemplates_();
}

function simpanAkDetails_(list, u) {
  if (!Array.isArray(list)) throw new Error('Data tidak valid.');
  const seen = {};
  const rows = [];
  list.forEach(d => {
    const kat = str_(d.kat), det = str_(d.det);
    if (!det) return;
    if (KAT_AK.indexOf(kat) === -1) throw new Error('Kategori tidak valid untuk "' + det + '".');
    if (seen[kat + '|' + det]) return;
    seen[kat + '|' + det] = true;
    rows.push([kat, safeText_(det)]);
  });
  const sh = sheet_(SH.SET);
  const n = sh.getMaxRows() - SET_AK_FIRST + 1;
  sh.getRange(SET_AK_FIRST, 1, n, 2).clearContent();
  if (rows.length) sh.getRange(SET_AK_FIRST, 1, rows.length, 2).setValues(rows);
  SpreadsheetApp.flush();
  rebuildReports_();
  log_(u, 'Simpan detail arus kas', '', rows.length + ' detail');
  return readAkDetails_();
}

/* ------------------------------------------------------------------ */
/*  PENGATURAN                                                         */
/* ------------------------------------------------------------------ */

function pengaturan_() {
  const s = readSettings_();
  return { settings: s, emailDefault: Session.getEffectiveUser().getEmail(), status: statusTrigger_(), adaContoh: readJurnal_().some(r => r.sumber === SUMBER_CONTOH) };
}

function simpanPengaturan_(d, u) {
  const yn = v => v === 'Tidak' ? 'Tidak' : 'Ya';
  const s = {
    nama: str_(d.nama) || 'Usaha Saya', email: str_(d.email), rekap: yn(d.rekap),
    tglRekap: Math.min(28, Math.max(1, parseInt(d.tglRekap, 10) || 1)), pdf: yn(d.pdf), pengingat: yn(d.pengingat),
    hariPengingat: Math.min(60, Math.max(1, parseInt(d.hariPengingat, 10) || 3)),
    jamPengingat: Math.min(23, Math.max(0, parseInt(d.jamPengingat, 10)))
  };
  if (isNaN(s.jamPengingat)) s.jamPengingat = 19;
  if (s.email && !s.email.split(',').every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim()))) throw new Error('Format email tidak valid.');
  const sh = sheet_(SH.SET);
  sh.getRange(SET_ROWS.nama, 2, 8, 1).setValues([[safeText_(s.nama)], [s.email], [s.rekap], [s.tglRekap], [s.pdf], [s.pengingat], [s.hariPengingat], [s.jamPengingat]]);
  let info = null;
  if (statusTrigger_().aktif) info = pasangTrigger_(); // jadwal mengikuti pengaturan baru
  log_(u, 'Simpan pengaturan', '', '');
  return { settings: readSettings_(), status: statusTrigger_(), info: info };
}

function statusTrigger_() {
  const names = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  return { aktif: names.length > 0 && names.some(n => TRIGGER_HANDLERS.indexOf(n) !== -1), rekap: names.indexOf('kirimRekapBulanan') !== -1, pengingat: names.indexOf('cekPengingatHarian') !== -1 };
}

/* ------------------------------------------------------------------ */
/*  UTIL                                                               */
/* ------------------------------------------------------------------ */

/** Cegah teks dari pengguna dibaca sebagai rumus oleh Sheets. */
function safeText_(v) {
  const s = str_(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/* ------------------------------------------------------------------ */
/*  PANDUAN                                                            */
/* ------------------------------------------------------------------ */

/** Isi Panduan.html; bagian khusus Pemilik disaring untuk Pencatat. */
function panduan_(u) {
  let html = HtmlService.createHtmlOutputFromFile('Panduan').getContent();
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  if (u.peran !== PERAN.PEMILIK) {
    html = html.replace(/<article\b[^>]*data-akses="pemilik"[^>]*>[\s\S]*?<\/article>/g, '');
  }
  return { html: html };
}

/* ------------------------------------------------------------------ */
/*  TUTUP TAHUN (ARSIP JURNAL)                                         */
/* ------------------------------------------------------------------ */

const SUMBER_SALDO_AWAL = 'Saldo Awal';

function infoArsip_() {
  const rows = readJurnal_();
  const years = rows.filter(r => r.dateKey && r.sumber !== SUMBER_SALDO_AWAL).map(r => Number(r.dateKey.substr(0, 4)));
  const kini = Number(todayKey_().substr(0, 4));
  const tertua = years.length ? Math.min.apply(null, years) : null;
  const arsip = ss_().getSheets().map(sh => sh.getName()).filter(n => /^Arsip Jurnal \d{4}$/.test(n));
  return { tertua: tertua, bisa: !!(tertua && tertua < kini), tahunIni: kini, baris: rows.length, arsip: arsip,
    adaContoh: rows.some(r => r.sumber === SUMBER_CONTOH) };
}

/**
 * Pindahkan semua transaksi s.d. 31 Des tahun Y ke sheet "Arsip Jurnal Y",
 * lalu ganti dengan satu jurnal saldo awal bertanggal 31 Des Y
 * (pendapatan, beban, dan prive ditutup ke modal).
 */
function tutupTahun_(Y, u) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const info = infoArsip_();
    if (!info.bisa || Y !== info.tertua) throw new Error('Yang bisa ditutup hanya tahun tertua yang sudah lewat' + (info.tertua ? ' (' + info.tertua + ')' : '') + '.');
    if (info.adaContoh) throw new Error('Hapus data contoh dulu sebelum menutup tahun.');
    const coa = readCoa_();
    const rows = readJurnal_();
    const cek = cekJurnal_(coa, rows);
    if (cek.unbalanced.length || cek.unknown.length || cek.incomplete.length) throw new Error('Perbaiki dulu jurnal yang tidak balance / kode salah / tidak lengkap.');
    const akhir = Y + '-12-31';
    const lama = rows.filter(r => r.dateKey <= akhir);
    const sisa = rows.filter(r => r.dateKey > akhir);
    const nama = 'Arsip Jurnal ' + Y;
    if (ss_().getSheetByName(nama)) throw new Error('Sheet "' + nama + '" sudah ada.');

    // Saldo akhir tahun per akun (arah debit)
    const acc = accMap_(coa);
    const saldo = {};
    lama.forEach(r => { saldo[r.kode] = (saldo[r.kode] || 0) + r.debit - r.kredit; });
    const nominal = k => acc[k] && (acc[k].jenis === 'Revenue' || acc[k].jenis === 'Expense');
    const ekuitas = k => acc[k] && acc[k].jenis === 'Equity';
    const modal = coa.filter(a => a.jenis === 'Equity' && a.normal === 'Credit')[0];
    if (!modal) throw new Error('Tidak ada akun Modal (Equity, saldo normal Credit).');
    let totalEkuitas = 0;
    Object.keys(saldo).forEach(k => { if (nominal(k) || ekuitas(k)) totalEkuitas += saldo[k]; });
    const tanggal = parseDateKey_(akhir);
    const id = 'SA' + (Y + 1);
    const desc = 'Saldo awal ' + (Y + 1) + ' (tutup tahun ' + Y + ')';
    const lines = [];
    Object.keys(saldo).sort().forEach(k => {
      if (nominal(k) || ekuitas(k)) return;
      const v = round2_(saldo[k]);
      if (v) lines.push({ date: tanggal, id: id, desc: desc, kode: k, debit: v > 0 ? v : 0, kredit: v < 0 ? -v : 0, kat: '', det: '', sumber: SUMBER_SALDO_AWAL, oleh: u.username });
    });
    const te = round2_(totalEkuitas);
    if (te) lines.push({ date: tanggal, id: id, desc: desc, kode: modal.kode, debit: te > 0 ? te : 0, kredit: te < 0 ? -te : 0, kat: '', det: '', sumber: SUMBER_SALDO_AWAL, oleh: u.username });

    // Arsip
    const sh = ss_().insertSheet(nama);
    const head = [['Tanggal', 'ID Transaksi', 'Deskripsi', 'Kode Akun', 'Nama Akun', 'Debit (Rp)', 'Kredit (Rp)', 'Kategori Arus Kas', 'Detail Arus Kas', 'Sumber', 'Dicatat oleh']];
    ensureSize_(sh, lama.length + 10, 11);
    sh.getRange(1, 1, 1, 11).setValues(head).setBackground(COLOR.header).setFontWeight('bold');
    if (lama.length) {
      sh.getRange(2, 4, lama.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, lama.length, 11).setValues(lama.map(r => [r.date, safeText_(r.id), safeText_(r.desc), r.kode, acc[r.kode] ? acc[r.kode].nama : '', r.debit, r.kredit, r.kat, safeText_(r.det), r.sumber, r.oleh]));
      sh.getRange(2, 1, lama.length, 1).setNumberFormat(FMT_DATE);
      sh.getRange(2, 6, lama.length, 2).setNumberFormat(FMT_RP);
    }
    sh.setFrozenRows(1);
    protectWarning_(sh);

    // Nomor TRX tidak boleh terpakai ulang
    let maxNo = Number(PropertiesService.getDocumentProperties().getProperty('LAST_TRX_NUM') || 0);
    lama.forEach(r => { const m = /^TRX(\d+)$/i.exec(r.id); if (m) maxNo = Math.max(maxNo, parseInt(m[1], 10)); });
    PropertiesService.getDocumentProperties().setProperty('LAST_TRX_NUM', String(maxNo));

    // Tulis ulang jurnal
    const jsh = sheet_(SH.JURNAL);
    clearJurnalInputs_(jsh);
    writeJurnalRows_(jsh, sortRows_(lines.concat(sisa)), JU_FIRST);
    SpreadsheetApp.flush();
    log_(u, 'Tutup tahun', id, lama.length + ' baris diarsip ke ' + nama);
    return { arsip: nama, baris: lama.length, saldoAwal: lines.length, info: infoArsip_() };
  } finally { lock.releaseLock(); }
}