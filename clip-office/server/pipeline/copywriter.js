// Títulos, hooks, descripciones y hashtags (Claude o plantillas).
import { askJson, llmAvailable } from '../llm.js';
import { db } from '../db.js';

const GTA = /gta|grand theft|vice city|rockstar/i;

const HOOKS_GAMING = [
  'NADIE esperaba que pasara esto 😳',
  'Esto en GTA 6 es de otro nivel 🔥',
  'Mira lo que pasa al final… 👀',
  'No puedo creer que esto sea real',
  'El detalle que nadie notó 🤯',
  'Así se ve la nueva física 😱',
  'Esto cambia TODO',
  'Espera al final…',
];
const HOOKS_GENERAL = ['Espera al final… 👀', 'Esto es increíble 🤯', 'Nadie habla de esto', 'Mira bien este detalle', 'No lo vas a creer 😳'];

function pick(arr, i) { return arr[i % arr.length]; }

export function templateCopy(src, i = 0) {
  const gta = GTA.test(src.title || '');
  const hook = pick(gta ? HOOKS_GAMING : HOOKS_GENERAL, i + Math.floor(Math.random() * 3));
  const tags = gta ? ['#GTA6', '#GTAVI', '#ViceCity', '#Gaming', '#Shorts', '#GTA'] : ['#Shorts', '#Viral', '#Reels', '#ParaTi', '#fyp'];
  const credit = src.channel && src.license !== 'own' ? `\n\n🎥 Fuente: ${src.channel}${src.url ? ` — ${src.url}` : ''}` : '';
  return {
    title: `${hook.replace(/[😳🔥👀🤯😱]/gu, '').trim()} ${gta ? '| GTA 6' : ''}`.trim().slice(0, 95),
    hook,
    description: `${hook}\n\nSíguenos para más clips todos los días 🔔${credit}\n\n${tags.join(' ')}`,
    hashtags: tags,
    titleOptions: [],
  };
}

export async function writeClipCopy(src, moments, wordsByMoment) {
  const s = db.settings;
  if (!llmAvailable()) return moments.map((_, i) => templateCopy(src, i));
  try {
    const r = await askJson({
      system: `Eres guionista de Shorts virales en español latino para el canal "${s.channelName}" (${s.handle}). Escribes hooks de máximo 7 palabras que generan curiosidad sin mentir ni hacer clickbait engañoso. Títulos de máximo 70 caracteres. Hashtags relevantes (5-8). La descripción incluye el crédito a la fuente original si existe, y un CTA para seguir el canal.`,
      prompt: `Video fuente: "${src.title}" de ${src.channel || 'desconocido'} (${src.url || 'archivo propio'}).\nPara cada clip escribe: hook (texto grande en pantalla al inicio), title (YouTube Shorts), titleOptions (3 variantes), description, hashtags, y commentary (1 frase de comentario propio que aporte valor/contexto, para que el clip sea transformativo).\n\n${moments.map((m, i) => `CLIP ${i + 1} (${Math.round(m.end - m.start)} s): ${(wordsByMoment[i] || []).map((w) => w.text).join(' ').slice(0, 1500) || '(sin diálogo, solo gameplay)'}`).join('\n\n')}`,
      schema: {
        type: 'object', additionalProperties: false, required: ['clips'],
        properties: { clips: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['hook', 'title', 'titleOptions', 'description', 'hashtags', 'commentary'], properties: { hook: { type: 'string' }, title: { type: 'string' }, titleOptions: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, commentary: { type: 'string' } } } } },
      },
      effort: 'low',
    });
    return moments.map((_, i) => ({ ...templateCopy(src, i), ...(r.clips?.[i] || {}) }));
  } catch (e) {
    console.warn('[copy/claude]', e.message);
    return moments.map((_, i) => templateCopy(src, i));
  }
}

/** Revisión de copyright/monetización (Tomás). Devuelve nivel y recomendaciones. */
export function complianceCheck(clip, src) {
  const notes = [];
  let risk = 'bajo';
  if (src?.license === 'own') notes.push('✅ Fuente propia: sin problemas de derechos.');
  else if (/creative ?common/i.test(src?.license || '')) notes.push('✅ Licencia Creative Commons: da crédito al autor (ya está en la descripción).');
  else {
    risk = 'medio';
    notes.push('⚠️ Video de terceros: pide permiso al creador o usa tu propio gameplay para monetizar sin riesgo.');
    notes.push('💡 Agrega comentario propio (voz o texto) para que sea contenido transformativo y no "contenido reutilizado".');
  }
  if (clip.end - clip.start > 60) { notes.push('⏱️ Dura más de 60 s: en YouTube no contará como Short, recórtalo.'); risk = risk === 'bajo' ? 'medio' : risk; }
  if (!clip.music || clip.music === 'none') notes.push('🎵 Sin música añadida: solo audio original.');
  else notes.push('🎵 Música original generada por la oficina: libre de derechos.');
  if (src?.hasAudio && src?.license !== 'own') notes.push('🔊 El audio original puede tener música con Content ID (radios del juego). Baja su volumen si recibes reclamos.');
  if (!clip.commentary && src?.license !== 'own') { notes.push('✍️ Falta comentario propio en el clip.'); if (risk === 'medio') risk = 'alto'; }
  return { risk, notes };
}
