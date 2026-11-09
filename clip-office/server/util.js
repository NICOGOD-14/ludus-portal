import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BIN } from './config.js';

/** Ejecuta un binario y devuelve stdout. onLine recibe cada línea de stderr/stdout (progreso). */
export function run(cmd, args, { cwd, onLine, timeoutMs = 0, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, windowsHide: true });
    let out = '';
    let err = '';
    let timer = null;
    if (timeoutMs) timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${path.basename(cmd)}: tiempo agotado`)); }, timeoutMs);
    const lines = (chunk, sink) => {
      const s = chunk.toString();
      if (sink === 'out') out += s; else err += s;
      if (err.length > 200000) err = err.slice(-100000);
      if (onLine) s.split(/\r|\n/).forEach((l) => l.trim() && onLine(l));
    };
    p.stdout.on('data', (c) => lines(c, 'out'));
    p.stderr.on('data', (c) => lines(c, 'err'));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`No se encontró "${cmd}". Ejecuta "npm run setup" para ver cómo instalarlo.`) : e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${path.basename(cmd)} falló (código ${code}): ${err.split('\n').filter(Boolean).slice(-4).join(' | ')}`));
    });
    if (input) { p.stdin.write(input); }
    p.stdin.end();
  });
}

/** Ejecuta y devuelve stdout como Buffer (para PCM). */
export function runBuffer(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const chunks = [];
    let err = '';
    p.stdout.on('data', (c) => chunks.push(c));
    p.stderr.on('data', (c) => { err += c; if (err.length > 50000) err = err.slice(-20000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${cmd} falló: ${err.slice(-400)}`))));
  });
}

export async function probe(file) {
  const out = await run(BIN.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format?.duration || v?.duration || a?.duration || 0),
    width: v?.width || 0,
    height: v?.height || 0,
    hasAudio: Boolean(a),
    hasVideo: Boolean(v),
  };
}

export async function which(cmd, args = ['--version']) {
  try { const out = await run(cmd, args, { timeoutMs: 15000 }); return out.split('\n')[0].trim() || 'ok'; } catch { return null; }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtTime = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };

export function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } }

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { 'User-Agent': 'LudusClipOffice/1.0 (contenido educativo)', Accept: 'application/json', ...(opts.headers || {}) }, signal: opts.signal || AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return res.json();
}

export async function download(url, dest, { timeoutMs = 120000, minBytes = 1000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'LudusClipOffice/1.0' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error('Archivo descargado vacío');
  fs.writeFileSync(dest, buf);
  return { bytes: buf.length, type: res.headers.get('content-type') || '' };
}

/** Escapa texto para ASS. */
export function assText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

/** Escapa una ruta para usarla dentro de un filtro de ffmpeg. */
export function ffPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
