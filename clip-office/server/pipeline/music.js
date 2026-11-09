// Música 100% original compuesta por código (sin copyright). Además puedes poner tus propias pistas libres en data/music/.
import fs from 'node:fs';
import path from 'node:path';
import { BIN, DIRS } from '../config.js';
import { run } from '../util.js';

const SR = 44100;
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Progresiones (notas MIDI de acordes) y estilo por mood
const MOODS = {
  hype: { label: 'Hype / Trap (gaming)', bpm: 140, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [33, 29, 36, 31], drums: 'trap', lead: 'pluck', gain: 0.9 },
  chill: { label: 'Lo-fi Chill', bpm: 82, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]], bass: [36, 33, 29, 31], drums: 'lofi', lead: 'keys', gain: 0.8 },
  misterio: { label: 'Misterio / Datos curiosos', bpm: 92, chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]], bass: [33, 29, 26, 28], drums: 'pulse', lead: 'arp', gain: 0.85 },
  epic: { label: 'Épico / Cinemático', bpm: 120, chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]], bass: [26, 22, 24, 21], drums: 'epic', lead: 'pad', gain: 0.9 },
};

export const MUSIC_MOODS = Object.fromEntries(Object.entries(MOODS).map(([k, v]) => [k, v.label]));

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function compose(mood, seconds = 64) {
  const m = MOODS[mood];
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  const beat = 60 / m.bpm;
  const bar = beat * 4;
  const rand = rng(mood.length * 7919);
  const add = (t0, dur, fn, amp) => {
    const a = Math.floor(t0 * SR), b = Math.min(n, Math.floor((t0 + dur) * SR));
    for (let i = Math.max(0, a); i < b; i++) out[i] += fn((i - a) / SR, dur) * amp;
  };
  const env = (t, d, atk = 0.005, rel = 0.1) => Math.min(1, t / atk) * Math.min(1, Math.max(0, (d - t) / rel));
  const saw = (f, t) => { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; return v * 0.55; };

  const bars = Math.floor(seconds / bar);
  for (let b = 0; b < bars; b++) {
    const ci = b % m.chords.length;
    const t0 = b * bar;
    const chord = m.chords[ci];
    const section = Math.floor(b / 4) % 4; // intro, build, drop, break
    // pad / acordes
    for (const note of chord) {
      const f = midi(note);
      if (m.lead === 'pad' || m.lead === 'keys' || m.drums === 'pulse') {
        add(t0, bar, (t, d) => (m.lead === 'keys' ? Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 1.4) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 3) : saw(f, t) * 0.5 + Math.sin(2 * Math.PI * f * 1.003 * t) * 0.5) * env(t, d, m.lead === 'keys' ? 0.01 : 0.4, 0.5), m.lead === 'keys' ? 0.07 : 0.045);
      } else {
        add(t0, bar, (t, d) => Math.sin(2 * Math.PI * f * t) * env(t, d, 0.3, 0.4), 0.035);
      }
    }
    // bajo
    const bf = midi(m.bass[ci]);
    if (m.drums === 'trap') {
      [0, 1.5, 2.5, 3.25].forEach((p, k) => { if (section === 0 && k > 0) return; add(t0 + p * beat, beat * (k === 0 ? 1.4 : 0.7), (t, d) => Math.sin(2 * Math.PI * bf * (1 + 1.5 * Math.exp(-t * 30)) * t) * Math.exp(-t * 1.6) * env(t, d, 0.003, 0.08), 0.42); });
    } else {
      for (let q = 0; q < 4; q++) add(t0 + q * beat, beat * 0.95, (t, d) => (Math.sin(2 * Math.PI * bf * t) + 0.3 * Math.sin(4 * Math.PI * bf * t)) * env(t, d, 0.01, 0.1), m.drums === 'lofi' ? 0.2 : 0.26);
    }
    // melodía / arpegio
    const scale = [...chord, chord[0] + 12, chord[1] + 12];
    const steps = m.lead === 'arp' ? 8 : m.lead === 'pluck' ? 8 : 4;
    if (section !== 0 || m.lead === 'arp') {
      for (let s = 0; s < steps; s++) {
        if (m.lead === 'pluck' && rand() < 0.35) continue;
        const note = scale[(s * (m.lead === 'arp' ? 1 : 2) + b) % scale.length] + 12;
        const f = midi(note);
        const st = bar / steps;
        add(t0 + s * st, st * 1.5, (t, d) => (m.lead === 'pad' ? saw(f, t) * 0.4 : Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t)) * Math.exp(-t * (m.lead === 'pad' ? 1 : 7)) * env(t, d, 0.004, 0.05), m.lead === 'keys' ? 0.04 : 0.055);
      }
    }
    // batería
    for (let q = 0; q < 16; q++) {
      const t = t0 + q * beat / 4;
      const kick = (tt, d) => Math.sin(2 * Math.PI * (45 + 110 * Math.exp(-tt * 35)) * tt) * Math.exp(-tt * 9) * env(tt, d);
      const noise = (decay, tone = 0) => (tt, d) => ((rand() * 2 - 1) * (1 - tone) + tone * Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt * decay) * env(tt, d, 0.001, 0.02);
      if (m.drums === 'trap') {
        if (section === 0 && q % 4 !== 0) continue;
        if (q === 0 || q === 10) add(t, 0.4, kick, 0.55);
        if (q === 4 || q === 12) add(t, 0.25, noise(18, 0.35), 0.32);
        if (section >= 1) add(t, 0.05, noise(90), q % 2 ? 0.05 : 0.08);
        if (section === 2 && (q === 14 || q === 15)) add(t + beat / 8, 0.04, noise(90), 0.06);
      } else if (m.drums === 'lofi') {
        if (q === 0 || q === 7 || q === 10) add(t + 0.012, 0.35, kick, 0.38);
        if (q === 4 || q === 12) add(t + 0.02, 0.2, noise(22, 0.2), 0.18);
        if (q % 2 === 0) add(t + (q % 4 ? 0.03 : 0), 0.05, noise(70), 0.04);
      } else if (m.drums === 'pulse') {
        if (q % 4 === 0 && section >= 1) add(t, 0.35, kick, 0.3);
        if (q % 2 === 1 && section >= 2) add(t, 0.04, noise(100), 0.03);
      } else if (m.drums === 'epic') {
        if (q === 0 || q === 6 || q === 8) add(t, 0.5, kick, 0.5);
        if (q === 4 || q === 12) add(t, 0.4, (tt, d) => Math.sin(2 * Math.PI * (90 + 60 * Math.exp(-tt * 20)) * tt) * Math.exp(-tt * 6) * env(tt, d), 0.35);
        if (section >= 2 && q % 2 === 0) add(t, 0.06, noise(60), 0.05);
      }
    }
  }
  // normaliza + soft clip + fade del loop
  let peak = 0;
  for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * 1.3); peak = Math.max(peak, Math.abs(out[i])); }
  const g = (m.gain * 0.95) / (peak || 1);
  const fade = SR * 0.05;
  for (let i = 0; i < n; i++) out[i] *= g * Math.min(1, i / fade, (n - i) / fade);
  return out;
}

function wav(samples) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

/** Genera las pistas originales si no existen. */
export async function ensureMusic() {
  for (const mood of Object.keys(MOODS)) {
    const file = path.join(DIRS.music, `ludus-${mood}.m4a`);
    if (fs.existsSync(file)) continue;
    const tmp = path.join(DIRS.tmp, `music-${mood}.wav`);
    fs.writeFileSync(tmp, wav(compose(mood)));
    await run(BIN.ffmpeg, ['-y', '-v', 'error', '-i', tmp, '-c:a', 'aac', '-b:a', '160k', file]);
    fs.rmSync(tmp, { force: true });
  }
}

/** Lista de pistas disponibles: originales + las que pongas en data/music/. */
export function listMusic() {
  return fs.readdirSync(DIRS.music).filter((f) => /\.(mp3|m4a|wav|ogg|aac)$/i.test(f)).map((f) => {
    const m = f.match(/^ludus-(\w+)\./);
    return { id: f, label: m ? `🎼 ${MOODS[m[1]]?.label || m[1]} (original)` : `🎵 ${f}`, mood: m?.[1] || 'custom', original: Boolean(m) };
  });
}

export function musicFile(idOrMood) {
  if (!idOrMood || idOrMood === 'none') return null;
  const direct = path.join(DIRS.music, path.basename(idOrMood));
  if (fs.existsSync(direct)) return direct;
  const byMood = path.join(DIRS.music, `ludus-${idOrMood}.m4a`);
  return fs.existsSync(byMood) ? byMood : null;
}
