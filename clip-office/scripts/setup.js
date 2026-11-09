// Verifica e instala lo necesario: dependencias de Node, yt-dlp, edge-tts y FFmpeg.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const py = process.env.PYTHON_PATH || (win ? 'python' : 'python3');
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => console.log(`  ❌ ${m}`);
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', shell: win }).status === 0;
const runv = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: win }).status === 0;

console.log('\n🏢 Ludus Clip Office — instalación\n');

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express'))) {
  console.log('📦 Instalando dependencias de Node…');
  runv(win ? 'npm.cmd' : 'npm', ['install']);
}
ok(`Node ${process.version}`);

if (has('ffmpeg', ['-version'])) ok('FFmpeg');
else {
  bad('FFmpeg no está instalado (es el motor de edición de video).');
  if (win) console.log('     Instálalo con:  winget install --id Gyan.FFmpeg -e   (luego cierra y abre la terminal)');
  else if (mac) console.log('     Instálalo con:  brew install ffmpeg');
  else console.log('     Instálalo con:  sudo apt install ffmpeg');
}

if (!has(py)) {
  bad(`Python no está instalado. Descárgalo de https://www.python.org/downloads/ (marca "Add Python to PATH").`);
} else {
  ok('Python');
  const need = [];
  if (!has('yt-dlp')) need.push('yt-dlp');
  if (spawnSync(py, ['-c', 'import edge_tts'], { stdio: 'ignore', shell: win }).status !== 0) need.push('edge-tts');
  if (need.length) {
    console.log(`📦 Instalando ${need.join(', ')}…`);
    runv(py, ['-m', 'pip', 'install', '-U', ...need]);
  }
  has('yt-dlp') ? ok('yt-dlp (descarga de videos)') : bad('yt-dlp: ejecuta  pip install -U yt-dlp');
  spawnSync(py, ['-c', 'import edge_tts'], { stdio: 'ignore', shell: win }).status === 0 ? ok('edge-tts (voz neural gratis)') : bad('edge-tts: ejecuta  pip install edge-tts');
}

const env = path.join(ROOT, '.env');
if (!fs.existsSync(env)) { fs.copyFileSync(path.join(ROOT, '.env.example'), env); ok('Creé el archivo .env (puedes poner tus claves ahí o desde Ajustes en la app)'); }

console.log('\n👉 Ahora ejecuta:  npm start   y abre  http://localhost:4321\n');
