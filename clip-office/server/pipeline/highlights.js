// Detección de los mejores momentos: energía del audio + cambios de escena + lo que se dice (+ Claude si hay key).
import { BIN } from '../config.js';
import { run, runBuffer, clamp } from '../util.js';
import { askJson, llmAvailable } from '../llm.js';
import { timedText } from './transcript.js';

const HYPE = /(no puede ser|wow|guau|incre[ií]ble|qu[eé] locura|locura|brutal|mira|miren|oh dios|dios m[ií]o|ja(ja)+|jaja|wtf|omg|what|insane|crazy|no way|holy|let'?s go|vamos|corre|cuidado|explot|persecuci|polic[ií]a|choque|secreto|nuevo|primera vez|nunca|jam[aá]s|mejor|peor|r[eé]cord|easter egg|gta ?(6|vi)|vice city|lucia|jason)/i;

/** RMS del audio por segundo (0..1 normalizado). */
export async function audioEnergy(file, duration) {
  const rate = 4000;
  const buf = await runBuffer(BIN.ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-']);
  const n = Math.floor(buf.length / 2);
  const secs = Math.max(1, Math.ceil(duration || n / rate));
  const e = new Array(secs).fill(0);
  for (let s = 0; s < secs; s++) {
    let sum = 0, cnt = 0;
    for (let i = s * rate; i < Math.min(n, (s + 1) * rate); i++) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; cnt++; }
    e[s] = cnt ? Math.sqrt(sum / cnt) : 0;
  }
  const sorted = [...e].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  return e.map((v) => clamp(v / (p95 || 1), 0, 1.2));
}

/** Tiempos (s) donde hay cambio de escena. */
export async function sceneChanges(file) {
  const times = [];
  try {
    await run(BIN.ffmpeg, ['-v', 'info', '-skip_frame', 'nokey', '-i', file, '-an', '-vf', "scale=160:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-'], {
      timeoutMs: 20 * 60000,
      onLine: (l) => { const m = l.match(/pts_time:([\d.]+)/); if (m) times.push(Number(m[1])); },
    });
  } catch (e) { console.warn('[scenes]', e.message); }
  return times;
}

function heuristic({ duration, energy, scenes, words, count, len }) {
  const secs = Math.floor(duration);
  const sceneAt = new Array(secs + 1).fill(0);
  scenes.forEach((t) => { if (t < secs) sceneAt[Math.floor(t)] += 1; });
  const talk = new Array(secs + 1).fill(0);
  const hype = new Array(secs + 1).fill(0);
  words.forEach((w) => { const s = Math.floor(w.start); if (s <= secs) { talk[s] += 1; if (HYPE.test(w.text)) hype[s] += 1; } });
  const mean = energy.reduce((a, b) => a + b, 0) / Math.max(1, energy.length);
  const cands = [];
  const step = 2;
  for (let s = Math.min(5, Math.max(0, secs - len)); s + len <= secs; s += step) {
    let en = 0, peak = 0, sc = 0, tk = 0, hy = 0;
    for (let k = s; k < s + len; k++) { en += energy[k] || 0; peak = Math.max(peak, energy[k] || 0); sc += sceneAt[k]; tk += talk[k]; hy += hype[k]; }
    en /= len;
    // gancho: energía en los primeros 3 s del clip
    const hook = ((energy[s] || 0) + (energy[s + 1] || 0) + (energy[s + 2] || 0)) / 3;
    const score = (en - mean) * 2.2 + peak * 0.8 + Math.min(sc / len * 6, 1.2) + Math.min(tk / len / 2.5, 1) * 0.6 + Math.min(hy, 6) * 0.35 + hook * 0.9;
    cands.push({ start: s, end: s + len, score });
  }
  if (!cands.length && duration > 3) cands.push({ start: 0, end: Math.min(duration, len), score: 1 });
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.length >= count) break;
    if (picked.some((p) => c.start < p.end + 3 && c.end > p.start - 3)) continue;
    picked.push(c);
  }
  const max = picked[0]?.score || 1;
  const min = Math.min(...picked.map((p) => p.score), 0);
  // ajusta inicio a un cambio de escena cercano para que arranque "en acción"
  return picked.map((p) => {
    const near = scenes.find((t) => t >= p.start - 1.5 && t <= p.start + 1.5);
    const start = near != null ? Math.max(0, near) : p.start;
    return { start: +start.toFixed(2), end: +Math.min(duration, start + len).toFixed(2), score: Math.round(55 + 44 * ((p.score - min) / Math.max(0.001, max - min))) };
  });
}

export async function findHighlights(src, words, { count = 5, len = 35, onProgress } = {}) {
  const duration = src.duration;
  len = clamp(Math.round(len), 8, 90);
  if (duration <= len + 2) return [{ start: 0, end: +duration.toFixed(2), score: 80, reason: 'Video corto: se usa completo' }];
  onProgress?.(10, 'Analizando energía del audio');
  const energy = src.hasAudio ? await audioEnergy(src.path, duration) : new Array(Math.ceil(duration)).fill(0.3);
  onProgress?.(35, 'Detectando cambios de escena');
  const scenes = await sceneChanges(src.path);
  onProgress?.(60, 'Puntuando momentos');
  const base = heuristic({ duration, energy, scenes, words, count: count * 2, len });

  if (llmAvailable() && words.length > 30) {
    onProgress?.(70, 'Claude está eligiendo los momentos más virales');
    try {
      const transcript = timedText(words).slice(0, 120000);
      const hints = base.slice(0, 10).map((b) => `${b.start}-${b.end}s (score ${b.score})`).join(', ');
      const r = await askJson({
        system: 'Eres editora de Shorts/TikTok/Reels de gaming y entretenimiento en español. Eliges momentos que funcionan solos, con un gancho en los primeros 2 segundos y un remate.',
        prompt: `Video: "${src.title}" (${Math.round(duration)} s).\nTranscripción con tiempos:\n${transcript}\n\nPicos de audio/acción detectados: ${hints}\n\nElige los ${count} mejores clips de ~${len} s (entre ${Math.max(8, len - 15)} y ${len + 15} s), sin solaparse. Para cada uno da start/end en segundos, una puntuación de viralidad 0-100 y la razón.`,
        schema: {
          type: 'object', additionalProperties: false, required: ['clips'],
          properties: { clips: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['start', 'end', 'score', 'reason'], properties: { start: { type: 'number' }, end: { type: 'number' }, score: { type: 'integer' }, reason: { type: 'string' } } } } },
        },
        effort: 'medium',
      });
      const clips = (r.clips || []).map((c) => ({ start: clamp(c.start, 0, duration - 3), end: clamp(c.end, c.start + 5, duration), score: clamp(c.score, 1, 100), reason: c.reason })).filter((c) => c.end - c.start >= 5);
      if (clips.length) return clips.slice(0, count);
    } catch (e) { console.warn('[highlights/claude]', e.message); }
  }
  return base.slice(0, count).map((b) => ({ ...b, reason: 'Pico de acción y audio detectado automáticamente' }));
}
