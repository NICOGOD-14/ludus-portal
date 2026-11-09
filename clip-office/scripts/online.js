// Abre la oficina con un LINK PÚBLICO gratis (Cloudflare Tunnel) protegido con contraseña.
// Uso: npm run online   (el link funciona mientras esta ventana y tu laptop estén encendidas)
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = path.join(ROOT, 'bin');
const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const arm = process.arch === 'arm64';

const { getSecret, setSecrets, PORT } = await import('../server/config.js');

// 1) contraseña
let pw = getSecret('APP_PASSWORD');
let created = false;
if (!pw) {
  const words = ['tigre', 'neon', 'vice', 'cohete', 'pulpo', 'radar', 'clip', 'turbo', 'lima', 'condor', 'nube', 'rayo'];
  const pick = () => words[crypto.randomInt(words.length)];
  pw = `${pick()}-${pick()}-${crypto.randomInt(100, 1000)}`;
  setSecrets({ APP_PASSWORD: pw });
  created = true;
}

// 2) cloudflared
function findCloudflared() {
  const local = path.join(BIN_DIR, win ? 'cloudflared.exe' : 'cloudflared');
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  if (fs.existsSync(local)) return local;
  if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore', shell: win }).status === 0) return 'cloudflared';
  return null;
}

async function downloadCloudflared() {
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
  const name = win ? 'cloudflared-windows-amd64.exe' : mac ? `cloudflared-darwin-${arm ? 'arm64' : 'amd64'}.tgz` : `cloudflared-linux-${arm ? 'arm64' : 'amd64'}`;
  console.log(`⬇️  Descargando Cloudflare Tunnel (${name}), solo la primera vez…`);
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`No pude descargar cloudflared (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.join(BIN_DIR, win ? 'cloudflared.exe' : 'cloudflared');
  if (name.endsWith('.tgz')) {
    const tgz = path.join(BIN_DIR, name);
    fs.writeFileSync(tgz, buf);
    spawnSync('tar', ['-xzf', tgz, '-C', BIN_DIR], { stdio: 'inherit' });
    fs.rmSync(tgz, { force: true });
  } else fs.writeFileSync(out, buf);
  if (!win) fs.chmodSync(out, 0o755);
  return out;
}

let cf = findCloudflared();
if (!cf) {
  try { cf = await downloadCloudflared(); } catch (e) {
    console.error(`❌ ${e.message}\n   Instálalo a mano: ${win ? 'winget install --id Cloudflare.cloudflared' : mac ? 'brew install cloudflared' : 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'}`);
    process.exit(1);
  }
}

// 3) servidor
await import('../server/index.js');
const { setPublicUrl } = await import('../server/auth.js');
const { emit } = await import('../server/db.js');
const { log } = await import('../server/agents.js');

// 4) túnel (se reinicia solo si se cae)
function startTunnel(attempt = 0) {
  const p = spawn(cf, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { windowsHide: true });
  let found = false;
  let url = '';
  let warned = false;
  const timer = setTimeout(() => {
    if (!found) { warned = true; console.warn('⏳ Cloudflare todavía no conecta. Revisa tu internet; si usas una red de la universidad o empresa, puede que bloquee el túnel (prueba con los datos del celular).'); }
  }, 40000);
  const onData = (chunk) => {
    const txt = chunk.toString();
    const u = txt.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (u && !url) { url = u[0]; console.log('🔌 Conectando el túnel…'); }
    for (const l of txt.split('\n')) if (/ ERR /.test(l) && !/fetch features|ICMP/.test(l)) console.warn('   ' + l.replace(/^\S+ ERR /, '⚠️  '));
    const m = url && /Registered tunnel connection/.test(txt) ? [url] : null;
    if (m && !found) {
      found = true;
      clearTimeout(timer);
      if (warned) console.log('✅ ¡Conectado!');
      setPublicUrl(m[0]);
      emit('public_url', { url: m[0] });
      log('valeria', `🌐 La oficina está en línea: ${m[0]}`);
      const line = '═'.repeat(64);
      console.log(`\n${line}\n  🌐 TU OFICINA EN INTERNET:  ${m[0]}\n  🔑 Contraseña:  ${pw}${created ? '   (nueva, guárdala; puedes cambiarla en Ajustes)' : ''}\n  📱 Ábrelo desde tu celular o cualquier PC.\n  ⚠️  Funciona mientras esta ventana y tu laptop sigan encendidas.\n  ℹ️  El link cambia cada vez que lo vuelves a abrir.\n${line}\n`);
    }
  };
  p.stdout.on('data', onData);
  p.stderr.on('data', onData);
  p.on('error', (e) => console.error('❌ Cloudflare Tunnel:', e.message));
  p.on('close', (code) => {
    setPublicUrl('');
    emit('public_url', { url: '' });
    const wait = Math.min(60, 5 * (attempt + 1));
    console.warn(`⚠️  El túnel se cerró (código ${code}). Reintentando en ${wait} s…`);
    setTimeout(() => startTunnel(attempt + 1), wait * 1000);
  });
  process.on('exit', () => p.kill());
}
startTunnel();
