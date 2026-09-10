const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  brand: 'TAKARI PANEL',
  year: 2026,
  secret: process.env.KEY_SECRET || 'ganti-ini-di-production-jangan-lupa',
  keyPrefix: 'TKR-BS',
  keyExpiryDays: 30,
  rateLimitWindowMs: 60 * 1000,
  rateLimitMax: 5,
  telegramSupport: 'https://t.me/Takariofficiall',
};

// ====== STORAGE (file-based, no DB needed) ======
const DB_FILE = path.join(__dirname, 'keys.json');
let db = { keys: {}, rateLimits: {} };

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!db.keys) db.keys = {};
      if (!db.rateLimits) db.rateLimits = {};
    }
  } catch (e) {
    console.error('DB load error, starting fresh:', e.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('DB save error:', e.message);
  }
}

loadDB();

// ====== GAME LIST ======
const GAMES = [
  {
    slug: 'BloodStrike',
    name: 'Blood Strike',
    desc: 'ESP + Aimbot + Memory + Skin DNS — Takari Mods',
    active: true,
  },
];

// ====== KEY GENERATION ======
function generateKey() {
  const raw = crypto.randomBytes(24).toString('hex').toUpperCase();
  const chunk = raw.match(/.{1,4}/g).slice(0, 4).join('-');
  return `${CONFIG.keyPrefix}-${chunk}`;
}

function hashCode(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// ====== RATE LIMIT ======
function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = db.rateLimits[ip] || { count: 0, resetAt: now + CONFIG.rateLimitWindowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + CONFIG.rateLimitWindowMs;
  }
  bucket.count += 1;
  db.rateLimits[ip] = bucket;
  saveDB();
  return bucket.count <= CONFIG.rateLimitMax;
}

// ====== MIDDLEWARE ======
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== ROUTES ======

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/games', (req, res) => {
  res.json(GAMES.filter(g => g.active));
});

app.get('/GETKEY/:game', (req, res) => {
  const gameSlug = String(req.params.game).trim();
  const game = GAMES.find(g => g.slug.toLowerCase() === gameSlug.toLowerCase() && g.active);

  if (!game) {
    return res.status(404).send(renderError('Game tidak ditemukan atau tidak aktif.'));
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).send(renderError('Terlalu banyak request. Coba lagi dalam 1 menit.'));
  }

  const key = generateKey();
  const now = Date.now();
  const expiresAt = now + CONFIG.keyExpiryDays * 24 * 60 * 60 * 1000;

  db.keys[key] = {
    key,
    game: game.slug,
    createdAt: now,
    expiresAt,
    used: false,
    ipHash: hashCode(ip).slice(0, 12),
  };
  saveDB();

  res.send(renderKeyPage(game, key, expiresAt));
});

app.get('/verify', (req, res) => {
  const key = String(req.query.key || '').trim().toUpperCase();
  if (!key) {
    return res.send(renderVerifyPage(null, 'Masukkan key untuk verifikasi.'));
  }
  const entry = db.keys[key];
  if (!entry) {
    return res.send(renderVerifyPage(null, 'Key tidak ditemukan.'));
  }
  if (Date.now() > entry.expiresAt) {
    return res.send(renderVerifyPage(entry, 'Key sudah expired.', true));
  }
  res.send(renderVerifyPage(entry, null));
});

app.get('/api/verify', (req, res) => {
  const key = String(req.query.key || '').trim().toUpperCase();
  if (!key) return res.json({ valid: false, reason: 'no_key' });
  const entry = db.keys[key];
  if (!entry) return res.json({ valid: false, reason: 'not_found' });
  if (Date.now() > entry.expiresAt) return res.json({ valid: false, reason: 'expired', key: entry });
  res.json({ valid: true, key: entry });
});

// ====== HTML RENDERERS ======
function baseHead(title) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — ${CONFIG.brand}</title>
<link rel="stylesheet" href="/style.css"></head><body>`;
}

function baseFoot() {
  return `<footer>© ${CONFIG.year} ${CONFIG.brand}<br>
<span class="muted">Jika gagal atau error, hubungi support via Telegram.</span><br>
<a href="${CONFIG.telegramSupport}" target="_blank" rel="noopener">@Takariofficiall</a></footer>
</div></body></html>`;
}

function renderKeyPage(game, key, expiresAt) {
  const exp = new Date(expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  return `${baseHead('Key ' + game.name)}
<div class="wrap">
  <div class="brand">${CONFIG.brand}</div>
  <h1>Key Berhasil Di-generate</h1>
  <p class="sub">Game: <strong>${game.name}</strong></p>

  <div class="keybox">
    <span id="keytext">${key}</span>
    <button class="copy" onclick="copyKey()">Copy</button>
  </div>

  <p class="hint">Berlaku sampai <strong>${exp}</strong>. Simpan key ini baik-baik.</p>

  <div class="actions">
    <a href="/" class="btn ghost">← Kembali</a>
    <a href="/verify?key=${encodeURIComponent(key)}" class="btn primary">Cek Key</a>
  </div>

  <p class="muted" style="margin-top:20px">Key ini tercatat di sistem. Bisa dicek keasliannya di halaman verify.</p>
${baseFoot()}
<script>
function copyKey(){
  const t = document.getElementById('keytext').innerText;
  navigator.clipboard.writeText(t).then(()=>{
    const b = document.querySelector('.copy');
    b.innerText='Copied!';
    setTimeout(()=>b.innerText='Copy',1500);
  });
}
</script>`;
}

function renderVerifyPage(entry, errorMsg, expired) {
  let statusHtml = '';
  if (errorMsg) {
    statusHtml = `<div class="status err">${errorMsg}</div>`;
  } else if (entry) {
    const exp = new Date(entry.expiresAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const created = new Date(entry.createdAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    statusHtml = `<div class="status ${expired ? 'warn' : 'ok'}">
      <strong>${expired ? 'EXPIRED' : 'VALID'}</strong><br>
      Game: ${entry.game}<br>
      Dibuat: ${created}<br>
      Berlaku sampai: ${exp}
    </div>`;
  }

  return `${baseHead('Verify Key')}
<div class="wrap">
  <div class="brand">${CONFIG.brand}</div>
  <h1>Verifikasi Key</h1>
  <p class="sub">Masukkan key untuk cek keasliannya.</p>

  <form method="GET" action="/verify" class="verify-form">
    <input type="text" name="key" placeholder="TKR-BS-XXXX-XXXX-XXXX-XXXX"
           value="${entry ? entry.key : ''}" autocomplete="off">
    <button type="submit" class="btn primary">Cek</button>
  </form>

  ${statusHtml}

  <div class="actions" style="margin-top:28px">
    <a href="/" class="btn ghost">← Kembali</a>
  </div>
${baseFoot()}`;
}

function renderError(msg) {
  return `${baseHead('Error')}
<div class="wrap">
  <div class="brand">${CONFIG.brand}</div>
  <h1>Oops</h1>
  <p class="sub">${msg}</p>
  <div class="actions"><a href="/" class="btn primary">← Kembali</a></div>
${baseFoot()}`;
}

// ====== START ======
app.listen(PORT, () => {
  console.log(`[${CONFIG.brand}] running on http://localhost:${PORT}`);
});