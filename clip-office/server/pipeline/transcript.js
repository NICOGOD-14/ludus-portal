// Transcripción palabra por palabra: subtítulos del video (VTT) o Whisper (opcional).
import fs from 'node:fs';
import path from 'node:path';
import { BIN, getSecret } from '../config.js';
import { run } from '../util.js';

const ts = (s) => {
  const m = s.trim().match(/(?:(\d+):)?(\d+):(\d+)[.,](\d+)/);
  if (!m) return 0;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0').slice(0, 3)) / 1000;
};

const clean = (w) => w.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\[(música|music|aplausos|applause|risas|laughter)\]/gi, '').trim();

/** Convierte un VTT (incluido el de subtítulos automáticos de YouTube) en palabras con tiempos. */
export function parseVtt(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  const cues = [];
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    cues.push({ start: ts(a), end: ts(z.trim().split(/\s+/)[0]), lines: lines.slice(i + 1).filter((l) => l.trim()) });
  }
  const tagged = cues.some((c) => c.lines.some((l) => /<\d\d:\d\d[:.]/.test(l)));
  const words = [];
  if (tagged) {
    for (const c of cues) {
      for (const line of c.lines) {
        if (!/<\d\d:\d\d[:.]/.test(line)) continue;
        const parts = line.split(/<(\d\d:\d\d:\d\d[.,]\d+|\d\d:\d\d[.,]\d+)>/);
        let t = c.start;
        for (let k = 0; k < parts.length; k++) {
          if (k % 2 === 1) { t = ts(parts[k]); continue; }
          const w = clean(parts[k]);
          if (!w) continue;
          for (const piece of w.split(/\s+/)) if (piece) words.push({ start: t, end: c.end, text: piece });
        }
      }
    }
  } else {
    let last = '';
    for (const c of cues) {
      const txt = clean(c.lines.join(' '));
      if (!txt || txt === last) continue;
      last = txt;
      const ws = txt.split(/\s+/).filter(Boolean);
      const d = (c.end - c.start) / Math.max(1, ws.length);
      ws.forEach((w, k) => words.push({ start: c.start + k * d, end: c.start + (k + 1) * d, text: w }));
    }
  }
  words.sort((x, y) => x.start - y.start);
  // quita duplicados y ajusta finales
  const out = [];
  for (const w of words) {
    const p = out[out.length - 1];
    if (p && p.text === w.text && Math.abs(p.start - w.start) < 0.05) continue;
    out.push({ ...w });
  }
  for (let k = 0; k < out.length; k++) {
    const next = out[k + 1];
    const cap = out[k].start + 1.2;
    out[k].end = Math.min(next ? next.start : out[k].end, cap, Math.max(out[k].end, out[k].start + 0.15));
    if (out[k].end <= out[k].start) out[k].end = out[k].start + 0.2;
  }
  return out;
}

export async function whisper(videoPath, workDir) {
  const key = getSecret('OPENAI_API_KEY');
  if (!key) return null;
  const audio = path.join(workDir, 'audio.mp3');
  await run(BIN.ffmpeg, ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-t', '5400', audio]);
  const form = new FormData();
  form.set('file', new Blob([fs.readFileSync(audio)], { type: 'audio/mpeg' }), 'audio.mp3');
  form.set('model', 'whisper-1');
  form.set('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(15 * 60000) });
  fs.rmSync(audio, { force: true });
  if (!res.ok) throw new Error(`Whisper ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.words || []).map((w) => ({ start: w.start, end: w.end, text: w.word }));
}

/** Obtiene la transcripción de una fuente (cacheada en words.json). */
export async function transcribe(src) {
  const cache = path.join(src.dir, 'words.json');
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  let words = [];
  let method = 'none';
  if (src.subsPath && fs.existsSync(src.subsPath)) {
    words = parseVtt(fs.readFileSync(src.subsPath, 'utf8'));
    method = 'subtitulos';
  }
  if (!words.length && src.hasAudio) {
    try { words = (await whisper(src.path, src.dir)) || []; if (words.length) method = 'whisper'; } catch (e) { console.warn('[whisper]', e.message); }
  }
  fs.writeFileSync(cache, JSON.stringify(words));
  src.transcriptMethod = method;
  src.wordCount = words.length;
  return words;
}

export function wordsIn(words, start, end) {
  return words.filter((w) => w.start >= start - 0.05 && w.start < end).map((w) => ({ start: +(w.start - start).toFixed(3), end: +(Math.min(w.end, end) - start).toFixed(3), text: w.text }));
}

/** Texto con marcas de tiempo cada ~8 s para que Claude elija momentos. */
export function timedText(words, every = 8) {
  const lines = [];
  let cur = null;
  for (const w of words) {
    if (!cur || w.start - cur.t >= every) { cur = { t: w.start, text: [] }; lines.push(cur); }
    cur.text.push(w.text);
  }
  return lines.map((l) => `[${Math.floor(l.t)}s] ${l.text.join(' ')}`).join('\n');
}
