# Desain: Tiga Agent OpenClaw di atas Backend yang Dipulihkan

**Tanggal:** 2026-08-11
**Status:** Menunggu review
**Target:** VPS Azure `agent-lfiathan` (70.153.193.16), `/opt/agent-lfiathan`

---

## 1. Latar dan kondisi terverifikasi

Tujuannya menjalankan tiga agent OpenClaw — Lfiathan (umum), Kara (keuangan),
Marcus (latihan dan diet) — di atas backend Fastify yang sudah ada.

Investigasi 2026-08-11 menemukan bahwa fondasinya tidak seperti yang diasumsikan.
Semua poin di bawah diverifikasi langsung di server, bukan disimpulkan dari kode:

| Area | Kondisi sebenarnya |
| --- | --- |
| Skema database | `agent_lfiathan` **kosong, nol tabel**. 9 migrasi belum pernah jalan. |
| Penyebab | `deploy.yml` memanggil `dist/node_modules/.bin/knex` (tidak ada); `\|\| echo` menelan kegagalannya tiap deploy. |
| `/health` | Hijau, karena hanya menguji koneksi — tidak pernah menyentuh skema. |
| Import email | Tidak pernah berfungsi di sini. Memanggil `google_api.py` yang tidak ada, butuh Python yang tidak ada di container, tanpa kredensial Google, tanpa `TX_EMAIL_IMPORT_*` di `.env`. |
| OpenClaw | v2026.7.1-2. Gateway berjalan sebagai **systemd user service** (`openclaw-gateway.service`), enabled, dengan `Linger=yes` — jadi selamat dari reboot. |
| Agent | `openclaw.json` hanya punya `agents.defaults`, **tanpa `agents.list`**. Hanya `main` yang hidup. `agents/finance/` cuma sqlite kosong sisa percobaan. |
| Telegram | Satu bot, `dmPolicy: "open"`, `allowFrom: ["*"]`, `tools.profile: "coding"`, workspace `/home/lfiathan`, tanpa sandbox. |
| Auth API | `AGENT_API_KEYS` tidak diset, jadi seluruh `/api/*` terbuka. `src/common/auth.ts` sudah ditulis tapi belum di-commit. |

Temuan Telegram adalah yang paling mendesak: siapa pun yang menemukan bot itu
bisa memerintah agent bertool coding di dalam home directory.

---

## 2. Keputusan dan alasannya

| # | Keputusan | Alasan |
| --- | --- | --- |
| D1 | Susunan **main / finance / trainer** | Sesuai `openclaw-persona/multi-agent-config.json5` dan persona KARA/MARCUS yang sudah ditulis. Menggantikan rencana lama `finance/dietary-strava/logbook`. |
| D2 | Model data **hibrida** | Postgres jadi sumber kebenaran angka; workspace agent untuk catatan kerja dan draf. |
| D3 | **Backend dulu**, agent belakangan | Hibrida menuntut API yang hidup dan terautentikasi; memasang agent lebih dulu berarti menyambungkannya ke skema kosong. |
| D4 | Gmail lewat **`googleapis` native** | Menghapus Python, `execFile`, dan script eksternal sekaligus. Satu-satunya opsi yang mengurangi permukaan serangan. |
| D5 | **Backend mengambil email, Kara menilai** | Lihat §5.1. |
| D6 | Kara **tanpa `exec`, tanpa sandbox Docker** | Konsekuensi langsung D5. |

### 2.1 Mengapa D6 membatalkan catatan "NON-NEGOTIABLE" di draf

`multi-agent-config.json5` memberi Kara `exec` khusus untuk `gogcli`, lalu
menandai sandbox Docker sebagai *non-negotiable* — dengan alasan yang benar:
begitu `exec` terbuka pada agent yang membaca email orang asing, container
adalah satu-satunya batas tersisa.

Alasan itu gugur bersama premisnya. Karena pengambilan email pindah ke backend
(D5), Kara tidak pernah menjalankan CLI dan tidak pernah memegang kredensial
Gmail. Tanpa `exec`, sandbox per-agent kehilangan pekerjaannya — dan VPS
2vCPU/4GB ini tidak perlu menjalankan container sandbox untuk tiap agent.

---

## 3. Fase 1 — Pulihkan skema database

**Masalah.** Migrasi tidak pernah berhasil, dan kegagalannya tidak pernah terlihat.

**Perubahan.**

1. `src/config/knexfile.ts` — tambahkan pada blok `migrations`:

   ```ts
   loadExtensions: [extname(fileURLToPath(import.meta.url))],
   ```

   Knex saat ini menghitung file `.d.ts` sebagai migrasi (melaporkan 18 pending
   untuk 9 migrasi asli) dan akan tersedak pada file deklarasi pertama yang
   tidak mengekspor `up()`. Menuliskan `['.js']` secara mati akan memperbaiki
   produksi tapi mematikan migrasi di mesin lokal, tempat migrasi masih `.ts`.
   Menurunkan ekstensi dari knexfile itu sendiri membuat keduanya benar.

2. `.github/workflows/deploy.yml` — perbaiki perintah migrasi:

   ```
   docker compose exec -T app node /app/node_modules/.bin/knex \
     --knexfile /app/dist/src/config/knexfile.js migrate:latest
   ```

   Hapus `|| echo "⚠ Migration failed or no pending migrations"`. `set -euo
   pipefail` di atasnya sudah benar; baris itulah yang melucutinya. Migrasi yang
   gagal **harus** menggagalkan deploy.

3. Jalankan 9 migrasi di produksi.

**Selesai bila:** `\dt` menampilkan 9 tabel, `migrate:status` melaporkan 0 pending,
dan `/health` tetap `200`.

---

## 4. Fase 2 — Nyalakan autentikasi API

**Perubahan.**

1. Commit dan deploy pekerjaan yang menggantung: `src/common/auth.ts`,
   `src/app.ts`, `src/config/index.ts`, `src/types/fastify.d.ts`.

2. **Tambahkan `/api/strava/webhook` ke `PUBLIC_PATHS`.** Ini wajib, bukan opsional.
   Endpoint itu dipanggil server Strava — GET untuk verifikasi langganan, POST
   untuk event — dan Strava tidak bisa mengirim header `x-api-key`. Menyalakan
   auth tanpa ini membuat webhook kena 401 diam-diam sampai Strava mencabut
   langganannya. Endpoint tersebut sudah punya otentikasinya sendiri lewat
   `hub.verify_token`, jadi membukanya tidak menambah risiko.

3. Isi `AGENT_API_KEYS` di `.env` produksi. `auth.ts` mencocokkan **path penuh**
   (`path === scope || path.startsWith(scope + '/')`), jadi scope harus ditulis
   sebagai prefix lengkap:

   | Agent | Scope |
   | --- | --- |
   | `kara` | `/api/transactions`, `/api/portfolio` |
   | `marcus` | `/api/dietary`, `/api/strava` |
   | `lfiathan` | keenam prefix |

   Kunci dibuat dengan `openssl rand -hex 32`, ditulis langsung ke `.env` di
   server, tidak pernah melewati chat.

**Selesai bila:** tanpa kunci → 401; kunci Marcus ke `/api/transactions` → 403;
kunci Kara ke `/api/transactions` → 200; `GET /api/strava/webhook` dengan
`hub.verify_token` benar → 200 tanpa kunci.

---

## 5. Fase 3 — Bangun ulang import email

### 5.1 Pembagian tugas: backend mengambil, Kara menilai

Pertanyaan yang mendasari fase ini: haruskah Gmail diakses backend atau Kara?
Kara lebih cerdas — dia bisa mengurai format bank apa pun tanpa aturan khusus.
Tetapi:

- **Kredensial dan injeksi.** Kara yang fetch berarti dia butuh akses Gmail dan
  `exec`, dan teks karangan orang asing masuk ke agent yang berwenang menulis.
  Persona-nya melarang menuruti perintah di dalam email, tapi persona adalah
  permintaan, bukan batas keamanan.
- **Determinisme.** Indeks unik `source_fingerprint` memberi jaminan
  exactly-once **hanya bila parsing-nya reproducible**. LLM yang membaca ulang
  inbox yang sama bisa menghasilkan nominal atau tanggal yang sedikit berbeda →
  fingerprint berbeda → baris duplikat. Kecerdasan non-deterministik justru
  melumpuhkan idempotensi yang sudah dibangun.
- **Biaya dan keaktifan.** Backend jalan terjadwal dengan nol token. Kara hanya
  hidup saat diajak bicara, jadi email Selasa baru tercatat saat chat dibuka.

Keunggulan Kara tetap nyata untuk satu kasus: bank mengganti template dan parser
rule-based diam-diam melewatkannya.

**Resolusi: pisahkan "cerdas" dari "memegang inbox".** Kecerdasan ditaruh di
langkah *parsing*, bukan *fetch*.

```
Gmail ──(googleapis, deterministik, terjadwal)──> backend
   │
   ├─ parser rule-based berhasil ──> fingerprint ──> INSERT transactions
   │
   └─ parser gagal ──> satu pass LLM atas teks yang SUDAH diambil
                          └──> status confidence rendah ──> pending-approvals
                                     └──> ditinjau Kara / disetujui ──> INSERT
```

Backend tetap satu-satunya pemegang kredensial Gmail. Kara mengerjakan yang
memang keahliannya menurut persona-nya: menilai isi buku besar — tagihan janggal,
fee yang berubah, alokasi yang melenceng.

### 5.2 Perubahan kode

Ketergantungan Python terkurung di satu seam. `runGapi()`
(`transaction-email-import.job.ts:195`) dipakai hanya di dua tempat di dalam
`fetchGmailMessages()`: `gmail search` dan `gmail get`.

1. Tambah dependensi `googleapis`.
2. Ganti `runGapi()` dan `fetchGmailMessages()` dengan klien Gmail API native.
   **Pertahankan tipe `GmailEnvelope` dan `GmailMessage` persis seperti sekarang**
   — dengan begitu parsing, `makeFingerprint()`, dan penulisan DB tidak tersentuh.
3. Hapus `PYTHON_BIN` dan `GOOGLE_API_SCRIPT`.
4. Tambahkan jalur fallback LLM sesuai §5.1, menulis ke `pending-approvals`
   alih-alih langsung `INSERT`.

   **Provider fallback harus disediakan lebih dulu.** `.env` produksi saat ini
   tidak memuat kunci LLM apa pun — bukan `OPENROUTER_API_KEY`, bukan
   `DEEPSEEK_API_KEY`. Backend tidak bisa meminjam kredensial gateway OpenClaw;
   kunci itu tersimpan di store OpenClaw sendiri, bukan di environment. Pilihan
   default: `deepseek-v4-flash` lewat `DEEPSEEK_API_KEY` baru di `.env` app,
   karena hanya ekstraksi terstruktur dari teks pendek — tidak perlu model mahal,
   dan konsisten dengan provider yang sudah dipakai gateway.

5. Sambungkan `transaction-email-review.job.ts` ke antrean itu — job-nya sudah
   membaca `pending-approvals` tetapi saat ini tidak ada yang mengisinya.
   Direktorinya `${TX_EMAIL_IMPORT_LOG_DIR}/pending-approvals`, default
   `/opt/agent-lfiathan/logs/email-import/pending-approvals`.
6. Set `TX_EMAIL_IMPORT_USER_ID`, `TX_EMAIL_IMPORT_USER_EMAIL`,
   `TX_EMAIL_IMPORT_MAX_EMAILS`, `TX_EMAIL_IMPORT_LOG_DIR` di `.env` produksi.

**Catatan penting:** hari ini import menulis langsung ke `transactions`
(baris 323) tanpa gerbang persetujuan apa pun. Hasil ekstraksi LLM **tidak boleh**
mengikuti jalur itu.

**Selesai bila:** dry-run mengambil email nyata tanpa Python; menjalankan dua kali
berturut-turut tidak menambah baris duplikat; email yang gagal diurai mendarat di
`pending-approvals`, bukan di `transactions`.

---

## 6. Fase 4 — Tiga agent

1. ~~**Tutup lubang Telegram.**~~ **SELESAI 2026-08-11.** `dmPolicy` diubah dari
   `"open"` ke `"allowlist"` dan `allowFrom` dari `["*"]` ke `["tg:5829448496"]`,
   lewat `openclaw config patch --stdin` (dry-run dulu, dengan backup
   `openclaw.json.pre-dmpolicy`). ID diverifikasi sebagai satu-satunya peer yang
   pernah ada dengan query langsung ke `state/openclaw.sqlite`. Gateway di-restart
   dan `openclaw doctor` mengonfirmasi mode allowlist aktif.
2. **`agents.list`** sesuai draf, dengan penyesuaian D6 — Kara tanpa `exec`,
   tanpa `sandbox`. Marcus tetap `deepseek-v4-flash`; Kara `deepseek-v4-pro`.
3. **Tiga bot Telegram**, satu per agent, plus `bindings` yang memetakan
   `accountId` ke `agentId`. Pemetaan deterministik, cocok pertama menang.
4. **Skill per agent** untuk memanggil `/api/*`, masing-masing membawa kuncinya
   sendiri dari Fase 2. Skill bersifat per-workspace sehingga tetap terisolasi
   antar-agent — berbeda dari konfigurasi MCP tingkat gateway yang justru dibagi.
5. **`agentToAgent: { enabled: false }`** dipertahankan.
6. ~~**systemd unit** untuk gateway.~~ Tidak diperlukan — sudah terpasang sebagai
   systemd user service dengan lingering aktif. Bila perlu dikelola, gunakan
   `openclaw gateway install|start|stop|restart|status`, bukan unit buatan tangan.

**Selesai bila:** pesan ke tiap bot dijawab agent yang benar; Kara menolak
pertanyaan latihan dan Marcus menolak pertanyaan uang; kunci Marcus ditolak 403
oleh `/api/transactions`; `systemctl restart` memulihkan ketiganya.

---

## 7. Yang harus dikerjakan pemilik

Tiga hal yang tidak boleh dikerjakan agen otomatis:

1. **OAuth Google** — consent di browser untuk menerbitkan refresh token.
2. **Dua bot baru di BotFather.** Token ditulis langsung ke file di VPS, jangan
   ditempel ke chat.
3. **Ganti token bot yang sekarang.** Token itu sempat tercetak apa adanya dalam
   transkrip sesi 2026-08-11.
4. **Sediakan `DEEPSEEK_API_KEY`** untuk `.env` app, bila jalur fallback LLM
   di §5.2 jadi dipakai. Tanpa ini, Fase 3 tetap bisa berjalan penuh dengan
   parser rule-based saja — email yang tidak dikenali hanya akan dilewati alih-alih
   diendapkan untuk ditinjau.

---

## 8. Di luar cakupan

- Membersihkan riwayat git dari password Postgres lama. Password itu **sudah
  mati** — diverifikasi gagal autentikasi lewat jalur `scram-sha-256` yang
  sebenarnya — jadi ini kebersihan repo, bukan insiden keamanan. Destruktif,
  butuh persetujuan terpisah.
- Mengganti cron job yang ada dengan scheduled task milik OpenClaw.
- Postgres dan Redis mendengar di `0.0.0.0`. Saat ini tertutup Azure NSG
  (diverifikasi dari luar), jadi hanya satu lapis pertahanan — layak diperketat,
  tapi bukan bagian dari pekerjaan ini.

---

## 9. Risiko

| Risiko | Penanganan |
| --- | --- |
| Migrasi gagal di tengah pada DB produksi | DB kosong, jadi tidak ada data yang bisa hilang. Ini justru waktu teraman untuk menjalankannya. |
| Menyalakan auth memutus pemanggil yang ada | `PUBLIC_PATHS` diperbaiki lebih dulu (§4.2); webhook Strava diuji sebelum dan sesudah. |
| Restart gateway kehilangan kredensial DeepSeek | Gateway sudah di-restart 2026-08-11 tanpa error, `Connectivity probe: ok`. Lokasi kunci tetap belum ditemukan — tidak ada di env proses, unit systemd, `credentials/`, blok `auth` di config, maupun tabel `auth_profile_*` di sqlite (keduanya nol baris). Belum terbukti lewat panggilan model nyata; uji satu pesan Telegram untuk memastikan. |
| Ekstraksi LLM memasukkan angka salah ke buku besar | Tidak pernah `INSERT` langsung — selalu lewat `pending-approvals`. |
