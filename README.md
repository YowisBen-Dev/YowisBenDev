# YowisBen Dev — Bot Telegram + Web Admin Controller

Satu service Railway berisi dua bagian yang saling mengendalikan:

1. **Bot Telegram** (@YowisBen_bot) dengan alur verifikasi saluran WhatsApp berbasis AI, plus fitur:
   - **Deploy APK Flutter** — kirim `.zip` proyek Flutter lengkap → bot build APK release → kirim file APK + info (nama, package, versi, ukuran, waktu build).
   - **Deploy Website** — kirim `.html` atau `.zip` + minta nama subdomain → live di `https://<subdomain>.netlify.app`.
   - **Download Video All Sosmed** — kirim tautan (TikTok, Instagram, YouTube, Facebook, X, dsb) → otomatis diunduh dan dikirim; `/audio <link>` untuk MP3.
2. **Web Admin Controller** — panel dengan login password, animasi penuh, dan kendali **start / restart / stop** proses bot secara realtime, log streaming, daftar pengguna terverifikasi, serta **generator fitur AI**: jelaskan fitur yang diinginkan dalam bahasa bebas → AI menulis plugin → aktifkan → langsung jadi perintah baru di bot tanpa deploy ulang.

## Cara Deploy ke Railway (5 langkah)

1. Deploy pakai **zip terbaru** (`yowisben-admin-panel.zip`) — versi lama punya bug: `.env` tidak ikut ke image (lihat bagian Troubleshooting di bawah). Ekstrak, push ke GitHub atau `railway up`.
2. Di Railway: **New Project → Deploy from GitHub repo** — Railway otomatis memakai `Dockerfile` (builder DOCKERFILE dari `railway.json`). Build pertama agak lama (10–20 menit) karena image memuat Flutter SDK + Android SDK + yt-dlp; itu wajar dan hanya sekali.
3. Set **Variables** di Railway (lihat tabel di bawah) — **disarankan**. Kalau tidak diisi, nilai dari file `.env` di dalam image yang dipakai; Variables dashboard selalu menimpa `.env`.
4. Deploy selesai → buka domain Railway (mis. `https://xxx.up.railway.app`) → login pakai `ADMIN_PASSWORD`.
5. Di panel, tekan **Start** (atau biarkan `BOT_AUTOSTART=true` menyalakan bot sendiri). Bot langsung online — kalau gagal, panel menampilkan banner merah berisi penyebab persisnya.

> **RAM**: build APK Flutter butuh memori besar. Set resource service minimal **2 GB** (disarankan 4 GB) di Railway untuk fitur deploy APK. Web + bot biasa cukup di 512 MB–1 GB.

### Variabel Environment

| Variabel | Isi | Keterangan |
| --- | --- | --- |
| `BOT_TOKEN` | token @BotFather | sudah terisi di `.env` proyek ini |
| `ADMIN_ID` | `7596781256` | Telegram ID admin (perintah `/stats` di bot) |
| `ADMIN_PASSWORD` | `YowisBen2026` | **ganti** password login web ini |
| `GEMINI_API_KEY` | key Google AI Studio (format `AIza...`) | verifikasi screenshot + generator fitur |
| `NETLIFY_TOKEN` | token Netlify | deploy website ke subdomain |
| `WA_CHANNEL_LINK` | link saluran WhatsApp | syarat verifikasi user |
| `BOT_AUTOSTART` | `true` | bot menyala otomatis saat service hidup |
| `GEMINI_MODEL` | `gemini-2.5-flash` | opsional; klien otomatis mencoba model pengganti (2.0-flash / saran API) |

## Troubleshooting: "Bot berhenti" / tombol Start tidak bereaksi

Gejala: toast "Perintah start dikirim" muncul, tapi badge tetap **Bot berhenti** dan bot tidak merespon `/start` di Telegram. Penyebab hampir selalu: **proses bot mati seketika saat menyala**. Buka halaman **Log Realtime** di panel — penyebabnya tertulis di sana, dan dashboard kini menampilkan **banner merah diagnosis**.

| Pesan di banner/log | Penyebab | Solusi |
| --- | --- | --- |
| `BOT_TOKEN kosong — bot tidak bisa jalan` | `.env` tidak ikut ke image / Variables kosong di Railway | versi zip lama mengecualikan `.env` lewat `.dockerignore` → **deploy ulang pakai zip baru**, atau isi `BOT_TOKEN` di Railway → Variables |
| `Gemini: API key not valid (401)` | key bukan API key AI Studio (mis. format `AQ.Ab8R...`) | buat key di **aistudio.google.com/apikey** (berawalan `AIza`), pasang di Variables, Restart |
| `Polling terhenti: 409 Conflict` | ada dua proses bot yang jalan bersamaan (mis. Railway + komputer lokal) | matikan salah satunya, tekan Restart |
| `Gagal start bot: 401 Unauthorized` | token bot salah/dicabut | regenerate token di @BotFather, update `BOT_TOKEN`, Restart |

Error konfigurasi (BOT_TOKEN kosong) **tidak** di-restart otomatis — percuma restart terus; perbaiki dulu, lalu tekan Start/Restart. Verifikasi AI yang bermasalah otomatis mengirim peringatan + langkah perbaikan ke chat admin, dan admin bisa memverifikasi user manual: `/verif <telegram_id_user>` (cabut: `/unverif <id>`).

## Cara Pakai Bot

1. User kirim `/start` → bot meminta **follow saluran WhatsApp** (tombol tersedia) → kirim **screenshot bukti**.
2. AI (Gemini vision) menganalisis screenshot (±5 detik). Lolos → semua fitur terbuka, admin dapat notifikasi. Gagal → boleh ulangi sampai 5x.
3. Menu utama: **Deploy APK Flutter**, **Deploy Website**, **Download Video**, **Fitur Tambahan**, **Bantuan**.
4. Perintah: `/deployapk` `/deployweb` `/audio <link>` `/fitur` `/cancel` `/help`; khusus admin: `/stats`, `/verif <id>`, `/unverif <id>`.

## Web Admin Controller

- **Dashboard** — status proses (cincin LIVE/OFF), uptime, statistik (user terverifikasi, APK dibuild, website deploy, unduhan media).
- **Kontrol Bot** — tombol Start / Restart / Stop dengan konfirmasi; auto-restart 5x jika proses bot mati tiba-tiba (bisa dimatikan lewat `BOT_AUTOSTART=false`).
- **Fitur & Plugin** — daftar plugin dengan saklar aktif/nonaktif dan hapus. Tombol **Buat Fitur Baru** menjalankan generator AI; hasil kode ditampilkan dulu (bisa dirancang ulang) baru diaktifkan → bot *hot-reload* tanpa deploy.
- **Log Realtime** — stream SSE, filter level, unduh `.txt`.
- **Pengguna** — daftar yang lolos verifikasi AI.

## Engine AI: dua lapis (biar tidak pernah mati)

- Utama: **Gemini** (vision untuk verifikasi screenshot, teks untuk generator fitur).
- Cadangan: **engine template offline** di `src/ai/templates.js`. Jika Gemini error (key salah, kuota, region diblokir), generator fitur tetap menghasilkan plugin yang bisa dipakai dan ditandai `template` di panel. Verifikasi screenshot yang AI-nya bermasalah akan menyuruh user mencoba lagi (tidak ada lolos palsu).

## Batasan yang jujur perlu diketahui

- **20 MB** batas unduhan file oleh Bot API Telegram (zip proyek/situs), **50 MB** batas unggah — unduhan video dibatasi ±45 MB otomatis.
- Build APK butuh **5–15 menit** per proyek dan RAM memadai; proyek Flutter harus utuh (`pubspec.yaml` + folder `android/`).
- Netlify: subdomain yang sudah dipakai otomatis diberi akhiran acak; kuota akun Netlify berlaku.
- Beberapa konten sosmed yang privat/ber-login tidak bisa diunduh (mesin: yt-dlp; bisa diperbarui lewat `pip install -U yt-dlp` di Dockerfile).

## Struktur Proyek

```
├── Dockerfile              # Node 20 + Flutter 3.24 + Android SDK 34 + JDK17 + yt-dlp + ffmpeg
├── railway.json            # builder DOCKERFILE + healthcheck /health
├── src/
│   ├── index.js            # Express + process manager bot (start/stop/restart, SSE log)
│   ├── bot/worker.js       # seluruh logika bot (verifikasi, fitur, sesi)
│   ├── bot/pluginLoader.js # muat/validasi plugin
│   ├── ai/gemini.js        # klien Gemini (vision + teks, retry model)
│   ├── ai/templates.js     # engine template offline
│   ├── services/netlify.js # API Netlify (buat situs + deploy zip)
│   └── services/ytdlp.js   # wrapper yt-dlp
├── plugins/                # plugin contoh: ping, sapa, quote, kalkulator (bisa jadi contoh AI)
├── public/                 # web admin (HTML/CSS/JS murni, animasi penuh)
└── data/                   # runtime (dibuat otomatis; jangan di-commit)
```

## Menjalankan Lokal (opsional)

```bash
npm install
cp .env.example .env   # isi sesuai kebutuhan
node src/index.js      # buka http://localhost:3000
```

Untuk mencoba panel tanpa menyambung Telegram: `MOCK_BOT=1 node src/index.js` (bot simulasi + data contoh).

## Keamanan

- `.env` berisi token asli milik pemilik proyek — **jangan pernah di-push ke repo publik**.
- Karena token sempat ditempel di percakapan, sangat disarankan **regenerate token** via @BotFather (`/revoke`) dan mengganti `ADMIN_PASSWORD` sebelum dipakai luas.
- Web admin dilindungi cookie HttpOnly + rate limit login; hanya satu akun admin (password).
