// Subtítulos animados (ASS) para videos verticales 1080x1920.
import { assText as rawAss } from '../util.js';

// Anton no tiene emojis: se quitan para que no salgan cuadritos.
const assText = (s) => rawAss(String(s ?? '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim());

const t = (s) => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
};

export const CAPTION_STYLES = {
  karaoke: 'Karaoke (palabra activa en color)',
  clean: 'Limpio (blanco con borde)',
  boxed: 'Caja (texto sobre fondo)',
  none: 'Sin subtítulos',
};

/** Agrupa palabras en frases cortas de 1-3 palabras, cortando en puntuación o pausas. */
export function chunkWords(words, maxWords = 3, maxChars = 18) {
  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= maxWords || cur.map((x) => x.text).join(' ').length + w.text.length > maxChars || (prev && w.start - prev.end > 0.6))) flush();
    cur.push(w);
    if (/[.!?¡¿,;:]$/.test(w.text)) flush();
  });
  flush();
  return chunks;
}

export function buildAss({ words = [], hook = '', commentary = '', handle = '', duration, style = 'karaoke', accent = '#C6FF00', captionY = 0.7 }) {
  const hex = accent.replace('#', '');
  const acc = `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`.toUpperCase();
  const capMargin = Math.round(1920 * (1 - captionY));
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Anton,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,7,3,2,60,60,${capMargin},1
Style: Box,Anton,92,&H00FFFFFF,&H00FFFFFF,&HC8000000,&H00000000,0,0,0,0,100,100,1,0,3,16,0,2,60,60,${capMargin},1
Style: Hook,Anton,84,&H00000000,&H00000000,${acc},&H64000000,0,0,0,0,100,100,1,0,3,20,0,8,70,70,190,1
Style: Comment,Anton,50,&H00FFFFFF,&H00FFFFFF,&HB4000000,&H00000000,0,0,0,0,100,100,1,0,3,14,0,8,90,90,420,1
Style: Handle,Anton,40,&H50FFFFFF,&H50FFFFFF,&H96000000,&H00000000,0,0,0,0,100,100,2,0,1,2,0,2,40,40,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const ev = [];
  if (hook) ev.push(`Dialogue: 5,${t(0)},${t(duration)},Hook,,0,0,0,,{\\fad(120,0)\\t(0,180,\\fscx106\\fscy106)\\t(180,320,\\fscx100\\fscy100)}${assText(hook.toUpperCase())}`);
  if (commentary && duration > 6) ev.push(`Dialogue: 4,${t(Math.min(3.5, duration * 0.15))},${t(Math.min(duration - 0.5, 10))},Comment,,0,0,0,,{\\fad(200,200)}${assText(commentary)}`);
  if (handle) ev.push(`Dialogue: 1,${t(0)},${t(duration)},Handle,,0,0,0,,${assText(handle)}`);

  if (style !== 'none' && words.length) {
    const chunks = chunkWords(words.filter((w) => w.start < duration));
    chunks.forEach((chunk, ci) => {
      const cStart = chunk[0].start;
      const next = chunks[ci + 1];
      const cEnd = Math.min(duration, Math.max(chunk[chunk.length - 1].end, cStart + 0.35), next ? next[0].start : duration);
      const up = chunk.map((w) => assText(w.text.toUpperCase()));
      if (style === 'karaoke') {
        chunk.forEach((w, wi) => {
          const s = wi === 0 ? cStart : w.start;
          const e = wi < chunk.length - 1 ? chunk[wi + 1].start : cEnd;
          if (e - s < 0.02) return;
          const pop = wi === 0 ? '{\\fscx85\\fscy85\\t(0,90,\\fscx100\\fscy100)}' : '';
          const txt = up.map((x, k) => (k === wi ? `{\\c${acc}&\\fscx112\\fscy112}${x}{\\c&H00FFFFFF&\\fscx100\\fscy100}` : x)).join(' ');
          ev.push(`Dialogue: 2,${t(s)},${t(e)},Cap,,0,0,0,,${pop}${txt}`);
        });
      } else {
        ev.push(`Dialogue: 2,${t(cStart)},${t(cEnd)},${style === 'boxed' ? 'Box' : 'Cap'},,0,0,0,,{\\fscx90\\fscy90\\t(0,90,\\fscx100\\fscy100)}${up.join(' ')}`);
      }
    });
  }
  return head + ev.join('\n') + '\n';
}
