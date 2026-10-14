/*
 * Onair — backend de démonstration, écrit en Node.js pur (sans dépendance npm)
 * pour rester exécutable hors-ligne. Implémente :
 *  - inscription / connexion réelles (mot de passe haché avec PBKDF2 + sel, session signée en cookie httpOnly)
 *  - paiement simulé (style Stripe Checkout en mode test — aucune carte n'est jamais débitée)
 *  - connexion YouTube / TikTok simulée (mock OAuth)
 *  - détection IA de clips simulée (mock)
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'onair-demo-secret-change-me';
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------- password hashing (PBKDF2, no deps) ----------------
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return { hash, salt };
}
function verifyPassword(password, salt, hash) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash));
}

// ---------------- signed session token (HMAC, no deps) ----------------
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySession(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) { return null; }
}

// ---------------- cookies ----------------
function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  let str = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (opts.maxAge) str += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
  appendHeader(res, 'Set-Cookie', str);
}
function clearCookie(res, name) {
  appendHeader(res, 'Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function appendHeader(res, name, value) {
  const existing = res.getHeader(name);
  if (!existing) res.setHeader(name, value);
  else if (Array.isArray(existing)) res.setHeader(name, [...existing, value]);
  else res.setHeader(name, [existing, value]);
}

// ---------------- request helpers ----------------
function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function getUser(req) {
  const cookies = parseCookies(req);
  const session = verifySession(cookies.onair_session);
  return session;
}

// ---------------- domain logic ----------------
const TIERS = {
  creator: [{ max: 2, price: 19 }, { max: 5, price: 15 }, { max: Infinity, price: 12 }],
  agency: [{ max: 2, price: 39 }, { max: 5, price: 29 }, { max: Infinity, price: 19 }],
};
function priceFor(plan, n, period) {
  const tier = TIERS[plan] && TIERS[plan].find(t => n <= t.max);
  if (!tier) return null;
  let unit = tier.price;
  if (period === 'annual') unit = Math.round(unit * 0.8);
  return unit;
}
function randomHandle(platform) {
  const adjectives = ['nova', 'pulse', 'lumen', 'kiwi', 'frame', 'echo', 'drift', 'orbit'];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return platform === 'youtube' ? `@${a}studio${n}` : `@${a}.${n}`;
}
const CLIP_TITLES = [
  'Le moment où tout bascule', 'La punchline qui a tout changé', 'Réaction inattendue du public',
  'Le conseil que personne ne donne', 'Ce chiffre va vous surprendre', "L'erreur à ne jamais commettre",
  'Le secret derrière ce succès', 'Quand le plan ne marche pas du tout',
];

// ---------------- route handlers ----------------
async function handleSignup(req, res) {
  const { name, email, password } = await readJsonBody(req);
  if (!name || !email || !password) return sendJson(res, 400, { error: 'Nom, email et mot de passe requis.' });
  if (password.length < 6) return sendJson(res, 400, { error: 'Le mot de passe doit contenir au moins 6 caractères.' });
  const emailNorm = String(email).toLowerCase().trim();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNorm);
  if (existing) return sendJson(res, 409, { error: 'Un compte existe déjà avec cet email.' });
  const { hash, salt } = hashPassword(password);
  const info = db.prepare('INSERT INTO users (name, email, password_hash, password_salt) VALUES (?, ?, ?, ?)')
    .run(name, emailNorm, hash, salt);
  const user = { id: Number(info.lastInsertRowid), name, email: emailNorm };
  const token = signSession({ ...user, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  setCookie(res, 'onair_session', token, { maxAge: 7 * 24 * 3600 * 1000 });
  sendJson(res, 200, { user });
}

async function handleLogin(req, res) {
  const { email, password } = await readJsonBody(req);
  if (!email || !password) return sendJson(res, 400, { error: 'Email et mot de passe requis.' });
  const emailNorm = String(email).toLowerCase().trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNorm);
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    return sendJson(res, 401, { error: 'Email ou mot de passe incorrect.' });
  }
  const user = { id: row.id, name: row.name, email: row.email };
  const token = signSession({ ...user, exp: Date.now() + 7 * 24 * 3600 * 1000 });
  setCookie(res, 'onair_session', token, { maxAge: 7 * 24 * 3600 * 1000 });
  sendJson(res, 200, { user });
}

function handleLogout(req, res) {
  clearCookie(res, 'onair_session');
  sendJson(res, 200, { ok: true });
}

function handleMe(req, res, user) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY connected_at DESC').all(user.id);
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(user.id);
  sendJson(res, 200, { user: { id: user.id, name: user.name, email: user.email }, accounts, subscription: subscription || null });
}

async function handleConnect(req, res, user, platform) {
  if (!['youtube', 'tiktok'].includes(platform)) return sendJson(res, 400, { error: 'Plateforme inconnue.' });
  await new Promise(r => setTimeout(r, 700)); // simulate OAuth handshake latency
  const handle = randomHandle(platform);
  const followers = Math.floor(Math.random() * 900000 + 5000);
  const info = db.prepare('INSERT INTO accounts (user_id, platform, handle, followers) VALUES (?, ?, ?, ?)')
    .run(user.id, platform, handle, followers);
  sendJson(res, 200, {
    account: { id: Number(info.lastInsertRowid), platform, handle, followers },
    note: "Connexion simulée — aucune vraie autorisation OAuth YouTube/TikTok n'a eu lieu (mock de démonstration).",
  });
}

async function handleCheckout(req, res, user) {
  const { plan, period, accountCount } = await readJsonBody(req);
  if (!TIERS[plan]) return sendJson(res, 400, { error: 'Plan inconnu.' });
  const n = Math.max(1, Math.min(50, parseInt(accountCount, 10) || 1));
  const p = period === 'annual' ? 'annual' : 'monthly';
  const unit = priceFor(plan, n, p);
  const total = unit * n;
  const fakeSessionId = 'cs_test_' + crypto.randomBytes(10).toString('hex');
  await new Promise(r => setTimeout(r, 900)); // simulate Stripe Checkout round-trip
  db.prepare(`INSERT INTO subscriptions (user_id, plan, period, account_count, unit_price, total_price, stripe_session_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(user.id, plan, p, n, unit, total, fakeSessionId);
  sendJson(res, 200, {
    ok: true, session_id: fakeSessionId, plan, period: p, account_count: n, unit_price: unit, total_price: total,
    note: "Paiement simulé en mode test — aucune carte n'a été débitée (mock de démonstration, pas de vraie intégration Stripe).",
  });
}

function handleClipsGet(req, res, user) {
  let clips = db.prepare('SELECT * FROM clips WHERE user_id = ? ORDER BY created_at DESC').all(user.id);
  if (clips.length === 0) {
    const insert = db.prepare(`INSERT INTO clips (user_id, title, platform, duration_s, score, views, status)
                                VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < 6; i++) {
      const platform = i % 2 === 0 ? 'youtube' : 'tiktok';
      const title = CLIP_TITLES[i % CLIP_TITLES.length];
      const duration = Math.floor(Math.random() * 40 + 20);
      const score = Math.floor(Math.random() * 35 + 65);
      const views = Math.floor(Math.random() * 50000);
      insert.run(user.id, title, platform, duration, score, views, 'draft');
    }
    clips = db.prepare('SELECT * FROM clips WHERE user_id = ? ORDER BY score DESC').all(user.id);
  }
  sendJson(res, 200, { clips, note: 'Détection IA simulée — extraits générés de façon fictive pour la démo.' });
}

async function handleClipPublish(req, res, user, clipId) {
  const clip = db.prepare('SELECT * FROM clips WHERE id = ? AND user_id = ?').get(clipId, user.id);
  if (!clip) return sendJson(res, 404, { error: 'Clip introuvable.' });
  await new Promise(r => setTimeout(r, 600));
  db.prepare('UPDATE clips SET status = ? WHERE id = ?').run('published', clip.id);
  sendJson(res, 200, { ok: true, clip: { ...clip, status: 'published' } });
}

// ---------------- static file serving ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---------------- router ----------------
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  try {
    if (pathname === '/api/signup' && req.method === 'POST') return await handleSignup(req, res);
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);

    if (pathname === '/api/me' && req.method === 'GET') {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non authentifié.' });
      return handleMe(req, res, user);
    }

    const connectMatch = pathname.match(/^\/api\/connect\/(youtube|tiktok)$/);
    if (connectMatch && req.method === 'POST') {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non authentifié.' });
      return await handleConnect(req, res, user, connectMatch[1]);
    }

    if (pathname === '/api/checkout' && req.method === 'POST') {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non authentifié.' });
      return await handleCheckout(req, res, user);
    }

    if (pathname === '/api/clips' && req.method === 'GET') {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non authentifié.' });
      return handleClipsGet(req, res, user);
    }

    const publishMatch = pathname.match(/^\/api\/clips\/(\d+)\/publish$/);
    if (publishMatch && req.method === 'POST') {
      const user = getUser(req);
      if (!user) return sendJson(res, 401, { error: 'Non authentifié.' });
      return await handleClipPublish(req, res, user, publishMatch[1]);
    }

    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Route inconnue.' });

    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Erreur serveur interne.' });
  }
});

server.listen(PORT, () => {
  console.log(`Onair backend démo lancé sur http://localhost:${PORT}`);
});
