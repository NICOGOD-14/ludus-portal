// Acceso con contraseña para cuando la oficina se abre a internet (túnel).
// Desde tu propia PC (localhost directo) no pide nada; desde el link público, sí.
import crypto from 'node:crypto';
import { getSecret } from './config.js';

const COOKIE = 'lco_session';
const attempts = new Map(); // ip -> { n, until }

let publicUrl = '';
export function setPublicUrl(u) { publicUrl = u || ''; }
export function getPublicUrl() { return publicUrl; }

function token() {
  const pw = getSecret('APP_PASSWORD');
  return pw ? crypto.createHmac('sha256', pw).update('ludus-clip-office').digest('hex') : '';
}

function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

/** ¿Viene de internet (túnel/proxy) o de fuera de esta PC? */
export function isRemote(req) {
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return true;
  const ip = req.socket.remoteAddress || '';
  return !(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
}

const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function authMiddleware(req, res, next) {
  if (!isRemote(req)) return next();
  if (req.path === '/login' || req.path === '/favicon.ico' || req.path.startsWith('/fonts/')) return next();
  if (req.path === '/api/youtube/callback') return next(); // vuelve de Google; solo guarda el permiso
  const t = token();
  if (!t) return res.status(403).type('html').send(page('Esta oficina no tiene contraseña configurada, así que no se puede abrir desde internet. En tu PC ejecuta "npm run online" para crear una.'));
  if (safeEq(cookies(req)[COOKIE] || '', t)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return res.status(401).json({ error: 'Necesitas iniciar sesión' });
  res.redirect('/login');
}

export function loginRoutes(app, express) {
  app.get('/login', (req, res) => res.type('html').send(page()));
  app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
    const a = attempts.get(ip) || { n: 0, until: 0 };
    if (a.until > Date.now()) return res.status(429).type('html').send(page('Demasiados intentos. Espera 15 minutos.'));
    const t = token();
    const ok = t && safeEq(crypto.createHmac('sha256', String(req.body.password || '')).update('ludus-clip-office').digest('hex'), t);
    if (!ok) {
      a.n += 1;
      if (a.n >= 8) { a.until = Date.now() + 15 * 60000; a.n = 0; }
      attempts.set(ip, a);
      return res.status(401).type('html').send(page('Contraseña incorrecta.'));
    }
    attempts.delete(ip);
    const secure = req.headers['x-forwarded-proto'] === 'https' || Boolean(req.headers['cf-connecting-ip']);
    res.setHeader('Set-Cookie', `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}`);
    res.redirect('/');
  });
}

function page(msg = '') {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ludus Clip Office</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f4f4f4;font-family:system-ui,sans-serif;padding:16px}
form{width:100%;max-width:340px;display:flex;flex-direction:column;gap:12px}h1{font-size:22px;margin:0 0 6px}b{color:#C6FF00}
input{padding:12px;border-radius:10px;border:1px solid #333;background:#121212;color:#fff;font-size:16px}
button{padding:12px;border-radius:10px;border:0;background:#C6FF00;color:#000;font-weight:700;font-size:16px;cursor:pointer}.m{color:#ff6b6b;font-size:14px}.t{color:#999;font-size:13px}</style></head>
<body><form method="post" action="/login"><h1>▶ Ludus <b>Clip Office</b></h1><div class="t">Ingresa la contraseña de tu oficina.</div>
${msg ? `<div class="m">${msg}</div>` : ''}<input type="password" name="password" placeholder="Contraseña" autofocus required autocomplete="current-password"><button>Entrar</button></form></body></html>`;
}
