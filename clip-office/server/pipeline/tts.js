// Voz en off: voz neural gratuita (edge-tts) o TU voz grabada desde el navegador.
import fs from 'node:fs';
import path from 'node:path';
import { BIN, ROOT } from '../config.js';
import { run, probe } from '../util.js';
import { whisper } from './transcript.js';

export const VOICES = {
  'es-PE-AlexNeural': 'Alex (Perú, masculina)',
  'es-PE-CamilaNeural': 'Camila (Perú, femenina)',
  'es-MX-JorgeNeural': 'Jorge (México, masculina)',
  'es-MX-DaliaNeural': 'Dalia (México, femenina)',
  'es-CO-GonzaloNeural': 'Gonzalo (Colombia, masculina)',
  'es-AR-TomasNeural': 'Tomás (Argentina, masculina)',
  'es-ES-AlvaroNeural': 'Álvaro (España, masculina)',
  'es-US-PalomaNeural': 'Paloma (EE. UU. latino, femenina)',
  'en-US-AndrewMultilingualNeural': 'Andrew (inglés, masculina)',
};

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]/g, '');

/** Devuelve la puntuación original (¿?¡!,.) a las palabras de edge-tts. */
export function restorePunctuation(words, text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let ti = 0;
  return words.map((w) => {
    const target = norm(w.text);
    for (let k = ti; k < Math.min(tokens.length, ti + 6); k++) {
      if (norm(tokens[k]) === target || (target && norm(tokens[k]).startsWith(target))) { ti = k + 1; return { ...w, text: tokens[k] }; }
    }
    return w;
  });
}

/** Reparte tiempos estimados si no hay tiempos reales (por ejemplo voz grabada sin Whisper). */
export function estimateWords(text, duration, offset = 0.15) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => Math.max(2, t.length) + (/[.!?]$/.test(t) ? 6 : /[,;:]$/.test(t) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0.5, duration - offset - 0.2);
  let t = offset;
  return tokens.map((tok, i) => { const d = (weights[i] / total) * span; const w = { start: +t.toFixed(3), end: +(t + d * 0.9).toFixed(3), text: tok }; t += d; return w; });
}

export async function synthesize(text, { voice = 'es-PE-AlexNeural', rate = '+8%', dir }) {
  fs.mkdirSync(dir, { recursive: true });
  const txt = path.join(dir, 'narration.txt');
  const mp3 = path.join(dir, 'narration.mp3');
  const json = path.join(dir, 'narration.json');
  fs.writeFileSync(txt, text);
  await run(BIN.python, [path.join(ROOT, 'scripts', 'tts.py'), voice, rate, txt, mp3, json], { timeoutMs: 180000 });
  const { duration } = await probe(mp3);
  let words = JSON.parse(fs.readFileSync(json, 'utf8'));
  words = restorePunctuation(words, text);
  if (!words.length) words = estimateWords(text, duration);
  return { audio: mp3, words, duration };
}

/** Usa una grabación del usuario como narración. */
export async function useRecording(file, text, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'narration-voz.m4a');
  await run(BIN.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vn', '-af', 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5', '-c:a', 'aac', '-b:a', '160k', out]);
  const { duration } = await probe(out);
  let words = null;
  try { words = await whisper(out, dir); } catch (e) { console.warn('[whisper voz]', e.message); }
  if (!words?.length) words = estimateWords(text, duration);
  return { audio: out, words, duration };
}
