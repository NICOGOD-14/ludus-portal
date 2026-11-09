// "Historias en chat": conversaciones originales animadas mensaje a mensaje (estilo grupo de WhatsApp/Slack).
import fs from 'node:fs';
import path from 'node:path';
import { BIN, DIRS } from '../config.js';
import { db } from '../db.js';
import { askJson, llmAvailable } from '../llm.js';
import { run, clamp, ffPath } from '../util.js';
import { musicFile } from './music.js';
import { encodeArgs, makeThumb } from './render.js';

// ---------- temas visuales ----------
export const CHAT_THEMES = {
  oscuro: { label: 'Oscuro (estilo oficina)', bg: '0x101114', panel: '1d1e22', other: '2b2c31', me: '2b2c31', text: 'FFFFFF', meta: '9a9aa2', header: 'FFFFFF' },
  whatsapp: { label: 'WhatsApp', bg: '0x0b141a', panel: '0b141a', other: '202c33', me: '005c4b', text: 'E9EDEF', meta: '8696a0', header: 'FFFFFF' },
  imessage: { label: 'iMessage', bg: '0x000000', panel: '000000', other: '26252a', me: '0a84ff', text: 'FFFFFF', meta: '8e8e93', header: 'FFFFFF' },
  ludus: { label: 'Ludus (neón)', bg: '0x0a0a0a', panel: '121212', other: '1f1f1f', me: 'C6FF00', meText: '000000', text: 'FFFFFF', meta: '9a9a9a', header: 'C6FF00' },
};

const AVATAR_COLORS = ['ff6b3d', '4dd6ff', '9b5cff', 'ffb000', '00e5a8', 'ff3b8d', 'c0c0ff', 'ffd23f'];

// ---------- historias originales para el modo sin Claude ----------
export const CHAT_BANK = [
  {
    title: 'Cuando GTA 6 "ya sale" 🎮',
    header: '"GTA 6 sale mañana"',
    characters: [{ name: 'Pedro', role: 'el que siempre sabe todo' }, { name: 'Ana', role: 'jugadora seria' }, { name: 'Luis', role: 'el del grupo' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Pedro', 'CHICOS'], ['Pedro', 'GTA 6 SALE MAÑANA'], ['Pedro', 'lo vi en un video'], ['Ana', '¿qué video?'],
      ['Pedro', 'uno con música épica y letras grandes'], ['Luis', 'ya pedí el día libre en el trabajo'], ['Ana', 'Pedro pásame el link'],
      ['Pedro', 'espera que lo busco'], ['Yo', '...'], ['Pedro', 'ok era un video de 2023'], ['Pedro', 'de alguien que "predecía" la fecha'],
      ['Luis', 'ya renuncié 😐'], ['Ana', 'LUIS'], ['Yo', 'tranquilos, mientras tanto aquí subimos los mejores clips 👀'],
    ],
  },
  {
    title: 'El jefe y el Excel 📊',
    header: '"Es solo un Excel"',
    characters: [{ name: 'Carla', role: 'Gerente' }, { name: 'Marco', role: 'Practicante' }, { name: 'Rosa', role: 'Contabilidad' }],
    messages: [
      ['Carla', 'Marco, ¿puedes pasarme el Excel de ventas?'], ['Marco', '¡claro! ¿cuál de todos?'], ['Carla', 'el FINAL'], ['Marco', 'tengo "final", "final2", "final_ahora_si" y "final_final_v3"'],
      ['Carla', 'el último'], ['Marco', 'el último que abrí o el último que guardé?'], ['Rosa', 'yo tengo uno que se llama "NO TOCAR"'], ['Carla', 'ese'],
      ['Rosa', 'ese lo toqué'], ['Marco', '¿y si usamos una sola carpeta compartida?'], ['Carla', 'Marco'], ['Carla', 'acabas de ser ascendido'],
    ],
  },
  {
    title: 'El dato que nadie esperaba 🐙',
    header: '"Un dato curioso"',
    characters: [{ name: 'Sofi', role: 'la de los datos' }, { name: 'Diego', role: 'escéptico' }, { name: 'Mamá', role: '' }],
    messages: [
      ['Sofi', 'dato del día: los pulpos tienen TRES corazones'], ['Diego', 'mentira'], ['Sofi', 'y la sangre AZUL'], ['Diego', 'ahora sí te inventaste todo'],
      ['Sofi', 'dos corazones bombean a las branquias y uno al resto del cuerpo'], ['Sofi', 'y es azul por el cobre de su sangre'], ['Diego', '...'],
      ['Diego', 'voy a necesitar una fuente'], ['Mamá', 'hijo es verdad, lo vi en la tele'], ['Diego', 'ok ahora sí te creo'], ['Sofi', 'gracias señora 🙏'],
      ['Sofi', 'síganme para más datos que nadie les enseñó en el colegio'],
    ],
  },
  {
    title: 'Mamá descubre los Shorts 📱',
    header: '"Mamá ya tiene TikTok"',
    characters: [{ name: 'Mamá', role: '' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Mamá', 'hijo ¿cómo se pone el sonido en estos videitos?'], ['Yo', 'toca la pantalla ma'], ['Mamá', 'ya, ahora se pausó'], ['Yo', 'tócala otra vez'],
      ['Mamá', 'ahora salió un señor vendiendo cuchillos'], ['Yo', 'desliza para arriba'], ['Mamá', 'ME GUSTA ESTO'], ['Mamá', 'llevo 3 horas'],
      ['Yo', 'ma son las 2 de la mañana'], ['Mamá', 'un videito más'], ['Mamá', 'ya sigo tu canal, ¿por qué tienes tan pocos likes?'], ['Yo', 'dale like ma 😭'],
    ],
  },
  {
    title: 'El primo que "sabe de computadoras" 💻',
    header: '"Mi primo sabe de computadoras"',
    characters: [{ name: 'Tía Rosa', role: '' }, { name: 'Kevin', role: 'el primo "experto"' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Tía Rosa', 'Kevin mi compu no prende'], ['Kevin', '¿la enchufó tía?'], ['Tía Rosa', 'claro hijo, no soy tonta'], ['Kevin', 'ok ¿y el botón de encender?'],
      ['Tía Rosa', 'ese no lo he tocado'], ['Kevin', 'tía ese es el que prende la compu'], ['Tía Rosa', 'AH'], ['Tía Rosa', 'ya prendió'],
      ['Tía Rosa', 'eres un genio Kevin'], ['Tía Rosa', 'le voy a decir a todos que arreglas computadoras'], ['Kevin', 'no tía por favor'], ['Yo', 'Kevin ya tienes 14 clientes en el grupo familiar'],
    ],
  },
  {
    title: 'El gamer y la mamá a la hora de comer 🎮',
    header: '"Un ratito más"',
    characters: [{ name: 'Mamá', role: '' }, { name: 'Leo', role: 'gamer', me: true }],
    messages: [
      ['Mamá', 'Leo a comer'], ['Leo', '5 minutos ma, estoy en una partida'], ['Mamá', 'hace 5 minutos dijiste 5 minutos'], ['Leo', 'es que no se puede pausar'],
      ['Mamá', '¿no se puede pausar?'], ['Leo', 'es online ma'], ['Mamá', 'ok'], ['Mamá', 'el wifi tampoco se puede pausar?'],
      ['Leo', '...'], ['Leo', 'ya voy'], ['Mamá', 'qué rápido se pausa todo cuando quieres'],
    ],
  },
  {
    title: 'La reunión que pudo ser un correo 📧',
    header: '"Reunión rápida de 5 minutos"',
    characters: [{ name: 'Jefe', role: 'Gerente' }, { name: 'Lucía', role: 'Diseño' }, { name: 'Andrés', role: 'Ventas' }],
    messages: [
      ['Jefe', 'equipo, reunión rápida de 5 minutos a las 3'], ['Lucía', 'ok'], ['Andrés', 'ok'], ['Jefe', 'ya vamos 1 hora, ¿alguna pregunta?'],
      ['Andrés', 'sí, ¿de qué era la reunión?'], ['Jefe', 'para decidir cuándo hacemos la reunión del proyecto'], ['Lucía', '¿y cuándo es?'],
      ['Jefe', 'lo vemos en la próxima reunión'], ['Andrés', '¿puede ser un correo?'], ['Jefe', 'excelente idea Andrés'], ['Jefe', 'agendemos una reunión para hablar de eso'],
    ],
  },
  {
    title: 'Le pregunté a mi abuelo por la IA 🤖',
    header: '"Abuelo, ¿sabes qué es la IA?"',
    characters: [{ name: 'Abuelo', role: '' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Yo', 'abuelo ¿sabes qué es la inteligencia artificial?'], ['Abuelo', 'claro, la usé ayer'], ['Yo', '¿en serio? ¿para qué?'], ['Abuelo', 'le pregunté a la tele qué tiempo hacía'],
      ['Yo', 'abuelo eso era el noticiero'], ['Abuelo', 'pues me respondió'], ['Yo', 'jajaja'], ['Abuelo', 'y me dijo que lloverá el jueves'],
      ['Abuelo', 'si llueve el jueves, es inteligente'], ['Yo', 'buen punto la verdad'],
    ],
  },
  {
    title: 'El amigo que nunca paga 💸',
    header: '"Te pago el lunes"',
    characters: [{ name: 'Beto', role: 'el que nunca paga' }, { name: 'Caro', role: '' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Yo', 'Beto, ¿y los 20 soles de la pizza?'], ['Beto', 'te pago el lunes'], ['Yo', 'eso dijiste hace 3 lunes'], ['Beto', 'nunca dije cuál lunes'],
      ['Caro', 'JAJAJA'], ['Yo', 'Beto'], ['Beto', 'ok ok te pago hoy'], ['Beto', 'te mandé algo'], ['Yo', 'me mandaste un sticker de un billete'],
      ['Beto', 'cuenta como pago simbólico'], ['Caro', 'aprendan, eso es un genio financiero'],
    ],
  },
  {
    title: 'El dato de la miel que no se malogra 🍯',
    header: '"La miel nunca se malogra"',
    characters: [{ name: 'Profe', role: 'Ciencias' }, { name: 'Mati', role: 'alumno' }, { name: 'Vale', role: 'alumna' }],
    messages: [
      ['Profe', 'dato para el examen: la miel prácticamente no se malogra'], ['Mati', '¿ni en mil años?'], ['Profe', 'encontraron miel en tumbas egipcias de miles de años'],
      ['Vale', '¿y se podía comer?'], ['Profe', 'tiene muy poca agua y es ácida, así que las bacterias no crecen'], ['Mati', 'entonces la miel de mi abuela del 2009 está bien'],
      ['Profe', 'probablemente sí'], ['Mati', 'ok'], ['Mati', 'el pan de al lado no tanto'], ['Vale', 'Mati bota ese pan'],
    ],
  },
  {
    title: 'La llamada de soporte técnico 🛠️',
    header: '"Soporte técnico, ¿en qué le ayudo?"',
    characters: [{ name: 'Soporte', role: 'Mesa de ayuda' }, { name: 'Señor', role: 'cliente' }],
    messages: [
      ['Señor', 'mi internet no funciona'], ['Soporte', 'entiendo, ¿qué luces ve en el router?'], ['Señor', 'ninguna'], ['Soporte', '¿está enchufado?'],
      ['Señor', 'no sé, está oscuro'], ['Soporte', '¿puede prender la luz?'], ['Señor', 'no hay luz en todo el barrio'], ['Soporte', '...'],
      ['Soporte', 'señor, ¿cómo me está escribiendo?'], ['Señor', 'con los datos del celular'], ['Soporte', 'entonces su internet sí funciona'], ['Señor', 'GRACIAS, problema resuelto ⭐⭐⭐⭐⭐'],
    ],
  },
  {
    title: 'Cuando por fin sale el tráiler 🎬',
    header: '"SALIÓ EL TRÁILER"',
    characters: [{ name: 'Nico', role: 'fan número 1' }, { name: 'Sami', role: '' }, { name: 'Yo', role: '', me: true }],
    messages: [
      ['Nico', 'SALIÓ EL TRÁILER'], ['Nico', 'SALIÓ'], ['Nico', 'EL'], ['Nico', 'TRÁILER'], ['Sami', '¿de qué juego?'],
      ['Nico', 'no importa, ¡SALIÓ!'], ['Yo', 'Nico es el tráiler de una película de 2019'], ['Nico', 'para mí es nuevo'], ['Sami', 'respeto eso'],
      ['Nico', 'igual voy a analizar cada frame'], ['Yo', 'ya lo analizaste hace 5 años'], ['Nico', 'y encontré cosas nuevas 👀'],
    ],
  },
];

export function normalizeChat(s) {
  const characters = (s.characters || []).slice(0, 6).map((c, i) => ({ name: String(c.name || `Persona ${i + 1}`).slice(0, 24), role: String(c.role || '').slice(0, 40), me: Boolean(c.me), color: c.color || AVATAR_COLORS[i % AVATAR_COLORS.length] }));
  const names = new Set(characters.map((c) => c.name));
  const messages = (s.messages || []).map((m) => (Array.isArray(m) ? { from: m[0], text: m[1] } : { from: m.from, text: m.text }))
    .filter((m) => m.text && names.has(m.from)).slice(0, 40).map((m) => ({ from: m.from, text: String(m.text).slice(0, 220) }));
  return {
    title: s.title || 'Historia en chat', header: s.header || '', characters, messages,
    description: s.description || `${s.title || ''}\n\n¿Te ha pasado algo así? Cuéntalo en los comentarios 👇\n\n#Shorts #Humor #HistoriasEnChat`,
    hashtags: s.hashtags || ['#Shorts', '#Humor', '#HistoriasEnChat', '#ParaTi'],
  };
}

export function templateChat(premise = '') {
  const q = premise.toLowerCase();
  const used = new Set(db.clips.filter((c) => c.kind === 'chat').map((c) => c.title));
  const pick = CHAT_BANK.find((b) => q && (b.title + b.header).toLowerCase().split(/\W+/).some((w) => w.length > 3 && q.includes(w)))
    || CHAT_BANK.find((b) => !used.has(b.title)) || CHAT_BANK[Math.floor(Math.random() * CHAT_BANK.length)];
  return normalizeChat(pick);
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'header', 'characters', 'messages', 'description', 'hashtags'],
  properties: {
    title: { type: 'string' }, header: { type: 'string' }, description: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
    characters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'role', 'me'], properties: { name: { type: 'string' }, role: { type: 'string' }, me: { type: 'boolean' } } } },
    messages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'text'], properties: { from: { type: 'string' }, text: { type: 'string' } } } },
  },
};

export async function writeChatScript(premise, { tone = 'divertido' } = {}) {
  if (!llmAvailable()) return templateChat(premise);
  try {
    const s = db.settings;
    const r = await askJson({
      system: `Escribes "historias en chat" ORIGINALES para Shorts/Reels/TikTok del canal "${s.channelName}", en español latino. Formato: una conversación de grupo (2-4 personajes) con mensajes cortos, ritmo rápido, malentendidos y un REMATE final que sorprenda o haga reír. Humor sano y cercano (oficina, amigos, familia, gamers, datos curiosos). Nada de marcas reales en mal plan, personas reales, insultos ni contenido para adultos. Si incluyes un dato curioso, debe ser real.`,
      prompt: `Premisa: ${premise || 'elige una situación cotidiana muy identificable'}\nTono: ${tone}\n\nEscribe: title (<70 caracteres), header (frase corta entre comillas que resume el chiste, va arriba del chat), characters (2-4; name corto, role opcional tipo "Gerente", me=true solo para quien envía desde la derecha, máximo 1), messages (12-20 mensajes de máximo 90 caracteres; varios seguidos del mismo personaje están bien; el último debe ser el remate), description (con pregunta para comentarios) y hashtags (5-7).`,
      schema: SCHEMA,
      effort: 'low',
    });
    const out = normalizeChat(r);
    if (out.messages.length >= 4) return out;
  } catch (e) { console.warn('[chat/claude]', e.message); }
  return templateChat(premise);
}

// ---------- maquetado ----------
const W = 1080;
const CHAT_TOP = 470;
const CHAT_BOTTOM = 1720;
const FONT = 50;
const LINE_H = 60;
const PAD_X = 30;
const PAD_Y = 22;
const NAME_H = 44;
const GAP_SAME = 12;
const GAP_NEW = 34;
const MAX_CHARS = 24;
const AVATAR = 76;

/** Corta el texto en líneas de ~MAX_CHARS caracteres. */
export function wrap(text, max = MAX_CHARS) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) { if (cur) { lines.push(cur); cur = ''; } lines.push(w.slice(0, max)); w = w.slice(max); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const textWidth = (s) => Math.round([...s].reduce((a, ch) => a + (/[MWmw@]/.test(ch) ? 0.82 : /[A-ZÁÉÍÓÚÑ]/.test(ch) ? 0.68 : /[ilj.,;:'!|¡]/.test(ch) ? 0.28 : ch === ' ' ? 0.3 : 0.56), 0) * FONT);

/** Calcula posición y tamaño de cada burbuja en un lienzo virtual. */
export function layoutMessages(script) {
  const chars = Object.fromEntries(script.characters.map((c) => [c.name, c]));
  const out = [];
  let y = 0;
  script.messages.forEach((m, i) => {
    const c = chars[m.from] || { name: m.from, color: 'aaaaaa' };
    const prev = script.messages[i - 1];
    const first = !prev || prev.from !== m.from;
    const lines = wrap(m.text);
    const showName = first && !c.me;
    const tw = Math.max(...lines.map(textWidth), showName ? textWidth(`${c.name}${c.role ? ` - ${c.role}` : ''}`) * 0.62 : 0);
    const w = Math.min(820, tw + PAD_X * 2);
    const h = lines.length * LINE_H + PAD_Y * 2 - 10 + (showName ? NAME_H : 0);
    y += i === 0 ? 0 : first ? GAP_NEW : GAP_SAME;
    const x = c.me ? W - 60 - w : 60 + AVATAR + 22;
    out.push({ i, from: m.from, char: c, lines, x, y, w, h, first, showName, me: c.me });
    y += h;
  });
  return out;
}

/** Duración de lectura de cada mensaje. */
export function readTime(text) { return clamp(0.85 + text.length * 0.045, 1.1, 4.2); }

function rr(w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  return `m ${r} 0 l ${w - r} 0 b ${w} 0 ${w} 0 ${w} ${r} l ${w} ${h - r} b ${w} ${h} ${w} ${h} ${w - r} ${h} l ${r} ${h} b 0 ${h} 0 ${h} 0 ${h - r} l 0 ${r} b 0 0 0 0 ${r} 0`;
}
function circle(d) { const r = d / 2, k = r * 0.5523; return `m 0 ${r} b 0 ${r - k} ${r - k} 0 ${r} 0 b ${r + k} 0 ${d} ${r - k} ${d} ${r} b ${d} ${r + k} ${r + k} ${d} ${r} ${d} b ${r - k} ${d} 0 ${r + k} 0 ${r}`; }
const col = (hex) => `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`.toUpperCase();
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').trim();
const tt = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}:${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

/** Línea de tiempo: cuándo aparece cada mensaje. durations opcional (voces). */
export function timeline(script, durations = null) {
  const times = [];
  let t = 1.4; // el título se lee primero
  script.messages.forEach((m, i) => {
    const typing = m.from === script.messages[i - 1]?.from ? 0.35 : 0.75;
    t += typing;
    const d = durations?.[i] != null ? Math.max(0.7, durations[i] + 0.25) : readTime(m.text);
    times.push({ start: t, typing, dur: d });
    t += d;
  });
  return { times, total: t + 1.8 };
}

export function buildChatAss(script, { theme = 'oscuro', times, total, handle = '' }) {
  const T = CHAT_THEMES[theme] || CHAT_THEMES.oscuro;
  const L = layoutMessages(script);
  const ev = [];
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Header,Montserrat,78,${col(T.header)},${col(T.header)},&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,80,80,190,1
Style: Msg,Montserrat,${FONT},${col(T.text)},${col(T.text)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Meta,Montserrat,34,${col(T.meta)},${col(T.meta)},&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Shape,Montserrat,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Avatar,Montserrat,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Handle,Montserrat,34,&H60FFFFFF,&H60FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,0,2,40,40,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  // panel de fondo del chat
  ev.push(`Dialogue: 0,${tt(0)},${tt(total)},Shape,,0,0,0,,{\\pos(0,${CHAT_TOP - 50})\\c${col(T.panel)}\\p1}${rr(W, CHAT_BOTTOM - CHAT_TOP + 100, 0)}{\\p0}`);
  if (script.header) ev.push(`Dialogue: 9,${tt(0)},${tt(total)},Header,,0,0,0,,{\\fad(300,0)}${esc(script.header)}`);
  if (handle) ev.push(`Dialogue: 9,${tt(0)},${tt(total)},Handle,,0,0,0,,${esc(handle)}`);

  const span = CHAT_BOTTOM - CHAT_TOP - 96; // deja sitio abajo para el indicador "escribiendo…"
  const offsetAt = (k) => Math.max(0, L[k].y + L[k].h - span);
  const clip = `\\clip(0,${CHAT_TOP - 40},${W},${CHAT_BOTTOM + 40})`;
  const drawMsg = (m, start, end, offFrom, offTo, isNew) => {
    const y0 = CHAT_TOP + m.y - offFrom, y1 = CHAT_TOP + m.y - offTo;
    const mv = (x, dy = 0) => (offFrom !== offTo ? `\\move(${x},${y0 + dy},${x},${y1 + dy},0,220)` : `\\pos(${x},${y1 + dy})`);
    const pop = isNew ? '\\fad(80,0)' : '';
    const bubbleCol = m.me ? T.me : T.other;
    const textCol = m.me && T.meText ? T.meText : T.text;
    ev.push(`Dialogue: 2,${tt(start)},${tt(end)},Shape,,0,0,0,,{${mv(m.x)}${clip}${pop}\\c${col(bubbleCol)}\\p1}${rr(m.w, m.h, 26)}{\\p0}`);
    let ty = PAD_Y - 4;
    if (m.showName) {
      ev.push(`Dialogue: 3,${tt(start)},${tt(end)},Meta,,0,0,0,,{${mv(m.x + PAD_X, PAD_Y - 6)}${clip}${pop}}${esc(m.char.name)}${m.char.role ? ` - ${esc(m.char.role)}` : ''}`);
      ty += NAME_H;
    }
    ev.push(`Dialogue: 3,${tt(start)},${tt(end)},Msg,,0,0,0,,{${mv(m.x + PAD_X, ty)}${clip}${pop}\\c${col(textCol)}}${m.lines.map(esc).join('\\N')}`);
    if (m.first && !m.me) {
      ev.push(`Dialogue: 2,${tt(start)},${tt(end)},Shape,,0,0,0,,{${mv(60)}${clip}${pop}\\c${col(m.char.color)}\\p1}${circle(AVATAR)}{\\p0}`);
      ev.push(`Dialogue: 3,${tt(start)},${tt(end)},Avatar,,0,0,0,,{${mv(60 + AVATAR / 2, AVATAR / 2)}${clip}${pop}}${esc(m.char.name.charAt(0).toUpperCase())}`);
    }
  };

  L.forEach((_, k) => {
    const start = times[k].start;
    const end = k + 1 < L.length ? times[k + 1].start : total;
    const offPrev = k ? offsetAt(k - 1) : 0;
    const off = offsetAt(k);
    for (let i = 0; i <= k; i++) drawMsg(L[i], start, end, i === k ? off : offPrev, off, i === k);
    // indicador "escribiendo…" antes del siguiente mensaje
    const nx = L[k + 1];
    if (nx) {
      const ts = times[k + 1].start - times[k + 1].typing;
      const yy = CHAT_TOP + L[k].y + L[k].h - off + (nx.first ? GAP_NEW : GAP_SAME);
      const x = nx.me ? W - 60 - 130 : 60 + AVATAR + 22;
      ev.push(`Dialogue: 4,${tt(ts)},${tt(times[k + 1].start)},Shape,,0,0,0,,{\\pos(${x},${yy})\\c${col(nx.me ? T.me : T.other)}\\p1}${rr(130, 64, 32)}{\\p0}`);
      [0, 1, 2].forEach((d) => ev.push(`Dialogue: 5,${tt(ts)},${tt(times[k + 1].start)},Shape,,0,0,0,,{\\pos(${x + 32 + d * 30},${yy + 24})\\c${col(T.meta)}\\alpha&H00&\\t(${d * 120},${d * 120 + 200},\\alpha&H90&)\\t(${d * 120 + 200},${d * 120 + 400},\\alpha&H00&)\\p1}${circle(16)}{\\p0}`));
    }
  });
  return head + ev.join('\n') + '\n';
}

// ---------- audio: solo el sonido de "mensaje enviado" (sin voces ni efectos) ----------
async function messageSound() {
  const dir = path.join(DIRS.music, '.sfx');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'enviado.wav');
  if (!fs.existsSync(f)) await run(BIN.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='0.4*sin(2*PI*(600+2600*t/0.14)*t)*exp(-t*18)':s=44100:d=0.16", f]);
  return f;
}

// ---------- render ----------
export async function renderChat(clip, { onProgress } = {}) {
  const s = db.settings;
  const dir = path.join(DIRS.stories, clip.id);
  fs.mkdirSync(dir, { recursive: true });
  const script = clip.chat;
  const { times, total } = timeline(script);
  const ass = path.join(dir, 'chat.ass');
  fs.writeFileSync(ass, buildChatAss(script, { theme: clip.theme, times, total, handle: s.watermark ? s.handle : '' }));
  const T = CHAT_THEMES[clip.theme] || CHAT_THEMES.oscuro;
  const snd = await messageSound();
  const music = clip.music && clip.music !== 'none' ? musicFile(clip.music) : null; // música opcional (por defecto ninguna)
  const args = ['-y', '-v', 'info', '-f', 'lavfi', '-i', `color=c=${T.bg}:s=1080x1920:r=30:d=${total.toFixed(2)}`, '-i', snd];
  if (music) args.push('-stream_loop', '-1', '-i', music);
  const n = times.length;
  const f = [`[0:v]ass=filename='${ffPath(ass)}':fontsdir='${ffPath(DIRS.fonts)}',drawbox=x=0:y=ih-12:w=iw*t/${total.toFixed(2)}:h=12:color=0xC6FF00@0.9:t=fill[v]`];
  f.push(`[1:a]asplit=${n}${times.map((_, i) => `[p${i}]`).join('')}`);
  const mix = [];
  times.forEach((x, i) => { const ms = Math.round(x.start * 1000); f.push(`[p${i}]volume=0.8,adelay=${ms}|${ms}[pd${i}]`); mix.push(`[pd${i}]`); });
  if (music) { f.push(`[2:a]atrim=0:${total.toFixed(2)},volume=${clamp(clip.musicVolume ?? 0.15, 0, 1)}[m]`); mix.push('[m]'); }
  // silencio de base para que el audio dure todo el video
  f.push(`anullsrc=r=44100:cl=stereo,atrim=0:${total.toFixed(2)}[sil]`);
  mix.push('[sil]');
  f.push(`${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0,atrim=0:${total.toFixed(2)},volume=2.2,alimiter=limit=0.9[a]`);
  const out = path.join(dir, 'chat.mp4');
  const tmp = path.join(dir, 'chat.tmp.mp4');
  args.push('-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]', '-t', total.toFixed(3), ...encodeArgs(tmp));
  await run(BIN.ffmpeg, args, { timeoutMs: 20 * 60000, onLine: (l) => { const m = l.match(/time=(\d+):(\d+):([\d.]+)/); if (m) onProgress?.(clamp(10 + ((+m[1] * 3600 + +m[2] * 60 + +m[3]) / total) * 88, 0, 99), 'Animando el chat'); } });
  fs.renameSync(tmp, out);
  await makeThumb(out, path.join(dir, 'thumb.jpg'), Math.min(total - 0.5, times[Math.min(3, n - 1)].start + 0.6));
  return { output: out, thumb: path.join(dir, 'thumb.jpg'), duration: total, times };
}
