// Configuración central: lee .env (si existe) y las claves guardadas desde la UI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.CLIP_OFFICE_DATA || path.join(ROOT, 'data');
export const DIRS = {
  data: DATA_DIR,
  sources: path.join(DATA_DIR, 'sources'),
  clips: path.join(DATA_DIR, 'clips'),
  stories: path.join(DATA_DIR, 'stories'),
  music: path.join(DATA_DIR, 'music'),
  voice: path.join(DATA_DIR, 'voice'),
  tmp: path.join(DATA_DIR, 'tmp'),
  fonts: path.join(ROOT, 'assets', 'fonts'),
};
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* sin .env */ }

const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');

/** Claves que el usuario puede configurar desde Ajustes (se guardan solo en tu PC). */
export const SECRET_KEYS = {
  ANTHROPIC_API_KEY: 'Cerebro de los agentes (Claude). Sin esto funcionan en modo básico.',
  CLAUDE_MODEL: 'Modelo de Claude (por defecto claude-opus-5-5).',
  YOUTUBE_API_KEY: 'Estadísticas públicas de YouTube y búsqueda de videos Creative Commons.',
  YOUTUBE_CLIENT_ID: 'OAuth de Google para subir videos a tu canal.',
  YOUTUBE_CLIENT_SECRET: 'OAuth de Google (secreto).',
  OPENAI_API_KEY: 'Opcional: transcripción Whisper cuando el video no trae subtítulos.',
  PEXELS_API_KEY: 'Opcional: fotos de stock gratuitas para los videos de datos curiosos.',
  TIKTOK_ACCESS_TOKEN: 'Opcional: métricas de TikTok (Display API).',
  INSTAGRAM_ACCESS_TOKEN: 'Opcional: métricas de Instagram (Graph API, cuenta profesional).',
  INSTAGRAM_USER_ID: 'Opcional: ID de tu cuenta profesional de Instagram.',
  YTDLP_COOKIES_FILE: 'Opcional: ruta a cookies.txt si YouTube pide verificar que no eres un bot.',
  APP_PASSWORD: 'Contraseña para entrar a la oficina desde el link público (npm run online).',
};

let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8')); } catch { secrets = {}; }

export function getSecret(name) {
  return (secrets[name] ?? process.env[name] ?? '').toString().trim();
}

export function setSecrets(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in SECRET_KEYS)) continue;
    if (v === null || v === '') delete secrets[k];
    else secrets[k] = String(v).trim();
  }
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

export function secretStatus() {
  const out = {};
  for (const [k, desc] of Object.entries(SECRET_KEYS)) {
    const v = getSecret(k);
    out[k] = { set: Boolean(v), desc, preview: v ? (k.endsWith('MODEL') || k.endsWith('FILE') || k.endsWith('USER_ID') ? v : `••••${v.slice(-4)}`) : '' };
  }
  return out;
}

export const PORT = Number(process.env.PORT || 4321);
export const HOST = process.env.HOST || '127.0.0.1';
export const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
export const BIN = {
  ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobe: process.env.FFPROBE_PATH || 'ffprobe',
  ytdlp: process.env.YTDLP_PATH || 'yt-dlp',
  edgeTts: process.env.EDGE_TTS_PATH || 'edge-tts',
  python: process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3'),
};
