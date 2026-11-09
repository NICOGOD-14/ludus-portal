// Videos de "datos curiosos": guion con hook → voz → imágenes/renders IA → video con efecto Ken Burns.
import fs from 'node:fs';
import path from 'node:path';
import { BIN, DIRS, getSecret } from '../config.js';
import { db } from '../db.js';
import { askJson, llmAvailable } from '../llm.js';
import { run, download, fetchJson, clamp } from '../util.js';
import { buildAss } from './captions.js';
import { musicFile } from './music.js';
import { encodeArgs, overlayChain, makeThumb } from './render.js';

const SCRIPT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'hook', 'scenes', 'cta', 'description', 'hashtags', 'badge'],
  properties: {
    title: { type: 'string' }, hook: { type: 'string' }, cta: { type: 'string' }, badge: { type: 'string' },
    description: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } },
    scenes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'visual', 'query'], properties: { text: { type: 'string' }, visual: { type: 'string' }, query: { type: 'string' } } } },
  },
};

const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);

export function templateScript(topic) {
  let sentences = topic.summary.split(/(?<=[.!?;])\s+/).filter((x) => x.length > 8);
  // frases largas se parten en la coma más cercana a la mitad para tener más escenas/imágenes
  sentences = sentences.flatMap((x) => {
    if (x.length < 110) return [x];
    const mid = x.indexOf(', ', Math.floor(x.length / 2) - 20);
    return mid > 0 ? [x.slice(0, mid + 1), x.slice(mid + 2)] : [x];
  }).slice(0, 6);
  const t = topic.title.replace(/[.!]$/, '');
  return {
    title: `${t} 🤯`,
    hook: `¿Sabías que ${lc(t)}?`,
    badge: 'DATO CURIOSO',
    scenes: (sentences.length ? sentences : [topic.summary]).map((s) => ({ text: s, visual: `${t}. ${s}`, query: t })),
    cta: 'Síguenos para más datos que no te enseñaron en el colegio.',
    description: `${t}. ${topic.summary}\n\n📚 Fuente: ${topic.source || 'investigación propia'}\n\n#DatosCuriosos #SabíasQue #Shorts #Curiosidades`,
    hashtags: ['#DatosCuriosos', '#SabíasQue', '#Shorts', '#Curiosidades', `#${(topic.category || 'Ciencia').replace(/\s+/g, '')}`],
  };
}

export async function writeScript(topic, { tone = 'misterio', seconds = 45 } = {}) {
  if (!llmAvailable()) return templateScript(topic);
  try {
    const s = db.settings;
    return await askJson({
      system: `Eres guionista de Shorts de datos curiosos en español latino para "${s.channelName}". Estilo "novela IA": narración cercana, ritmo rápido, frases cortas, tensión y un giro. La PRIMERA frase (hook) debe atrapar en menos de 2 segundos y conectar con la audiencia (pregunta o afirmación imposible). Nada de datos inventados: usa solo lo que está en el resumen y su fuente.`,
      prompt: `Tema: ${topic.title}\nResumen y datos: ${topic.summary}\nFuente: ${topic.source}\nÁngulo sugerido: ${topic.angle || '-'}\nTono: ${tone}. Duración objetivo: ${seconds} segundos de narración (~${Math.round(seconds * 2.6)} palabras en total).\n\nDevuelve: title (YouTube, <70 caracteres), hook (1 frase), scenes (4-6 escenas; cada una con text = lo que dice el narrador, visual = prompt EN INGLÉS para generar una ilustración 3D cinematográfica vertical de esa escena, query = 2-3 palabras clave en inglés para buscar una foto real), cta (cierre que invite a seguir el canal o comentar), badge (etiqueta corta de 1-3 palabras en mayúsculas para la parte superior, ej. "DATO CURIOSO", "MISTERIO"), description (con la fuente) y hashtags.`,
      schema: SCRIPT_SCHEMA,
      effort: 'medium',
    });
  } catch (e) {
    console.warn('[script/claude]', e.message);
    return templateScript(topic);
  }
}

export function narrationText(script) {
  return [script.hook, ...script.scenes.map((s) => s.text), script.cta].map((x) => x.trim()).filter(Boolean).join(' ');
}

// ---------- imágenes ----------
const STYLE = 'cinematic 3d render, dramatic volumetric lighting, ultra detailed, vibrant colors, vertical 9:16 composition, no text';

async function aiImage(prompt, file, seed) {
  const u = `https://image.pollinations.ai/prompt/${encodeURIComponent(`${prompt}, ${STYLE}`.slice(0, 900))}?width=1080&height=1920&nologo=true&seed=${seed}&model=flux`;
  const raw = file.replace(/\.jpg$/, '-raw.jpg');
  const r = await download(u, raw, { timeoutMs: 90000, minBytes: 5000 });
  if (!/image/.test(r.type)) throw new Error('respuesta no es imagen');
  // recorta la franja inferior donde el servicio gratuito pone su marca
  await run(BIN.ffmpeg, ['-y', '-v', 'error', '-i', raw, '-vf', 'crop=iw:ih*0.93:0:0', '-q:v', '2', file]);
  fs.rmSync(raw, { force: true });
  return { credit: 'Ilustración generada con IA (Pollinations)' };
}

async function commonsImage(query, file) {
  const j = await fetchJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1280&format=json`);
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info?.thumburl) continue;
    try {
      await download(info.thumburl, file, { minBytes: 5000 });
      const artist = (info.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').trim();
      const lic = info.extmetadata?.LicenseShortName?.value || '';
      return { credit: `Wikimedia Commons: ${artist || 'autor'} (${lic})` };
    } catch { /* siguiente */ }
  }
  throw new Error('sin resultados en Commons');
}

async function pexelsImage(query, file) {
  const key = getSecret('PEXELS_API_KEY');
  if (!key) throw new Error('sin PEXELS_API_KEY');
  const j = await fetchJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=3`, { headers: { Authorization: key } });
  const ph = j.photos?.[0];
  if (!ph) throw new Error('sin resultados en Pexels');
  await download(ph.src.large2x || ph.src.large, file);
  return { credit: `Foto de ${ph.photographer} en Pexels` };
}

async function cardImage(text, file, i) {
  const palettes = [['0x0b0b1f', '0x6a00ff'], ['0x001a14', '0x00c9a7'], ['0x1f0b00', '0xff6b3d'], ['0x0a0a0a', '0xc6ff00'], ['0x14001f', '0xff2e88']];
  const [c0, c1] = palettes[i % palettes.length];
  await run(BIN.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `gradients=s=1080x1920:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1080:y1=1920:d=1`, '-frames:v', '1', file]);
  return { credit: 'Fondo generado' };
}

export async function fetchSceneImage(scene, i, dir, { source = 'auto', topicImage } = {}) {
  const file = path.join(dir, `scene-${i}-${Date.now() % 100000}.jpg`);
  const order = source === 'ai' ? ['ai'] : source === 'photo' ? ['commons', 'pexels', 'ai'] : ['ai', 'commons', 'pexels'];
  if (i === 0 && topicImage && source === 'photo') order.unshift('topic');
  else if (i === 0 && topicImage) order.push('topic');
  for (const s of order) {
    try {
      let r;
      if (s === 'topic') { await download(topicImage, file, { minBytes: 5000 }); r = { credit: 'Wikipedia / Wikimedia Commons' }; } else if (s === 'ai') r = await aiImage(scene.visual || scene.text, file, 1000 + i * 17 + Math.floor(Math.random() * 999));
      else if (s === 'commons') r = await commonsImage(scene.query || scene.visual, file);
      else r = await pexelsImage(scene.query || scene.visual, file);
      return { image: file, credit: r.credit };
    } catch (e) { console.warn(`[imagen ${s}]`, e.message); }
  }
  const r = await cardImage(scene.text, file, i);
  return { image: file, credit: r.credit };
}

// ---------- render ----------
const TRANSITIONS = ['fade', 'smoothleft', 'circleopen', 'slideup', 'zoomin', 'dissolve', 'smoothup'];

/** Divide las palabras narradas en segmentos visuales (hook+escena1, escena2..., escenaN+cta). */
export function segmentTimes(script, words, duration) {
  const parts = [script.hook, ...script.scenes.map((s) => s.text), script.cta];
  const counts = parts.map((p) => p.split(/\s+/).filter(Boolean).length);
  const starts = [];
  let wi = 0;
  counts.forEach((c) => { starts.push(words[Math.min(wi, words.length - 1)]?.start ?? 0); wi += c; });
  // segmento visual k = escena k; el hook se une a la escena 0 y el cta a la última
  const n = script.scenes.length;
  const seg = [];
  for (let k = 0; k < n; k++) {
    const s = k === 0 ? 0 : starts[k + 1];
    const e = k === n - 1 ? duration : starts[k + 2];
    seg.push({ start: s, dur: Math.max(1.2, e - s) });
  }
  const total = seg.reduce((a, b) => a + b.dur, 0);
  seg[seg.length - 1].dur += duration - total;
  return seg;
}

export async function renderStory(story, { onProgress } = {}) {
  const s = db.settings;
  const dir = path.join(DIRS.stories, story.id);
  const n = story.scenes.length;
  const duration = story.narration.duration + 0.8;
  const seg = segmentTimes(story.script, story.narration.words, duration);
  const X = 0.45;
  const args = ['-y', '-v', 'info'];
  story.scenes.forEach((sc) => args.push('-i', sc.image));
  args.push('-i', story.narration.audio);
  const music = musicFile(story.music ?? 'misterio');
  if (music) args.push('-stream_loop', '-1', '-i', music);

  const f = [];
  seg.forEach((g, k) => {
    const L = g.dur + (k < n - 1 ? X : 0);
    const frames = Math.ceil(L * 30);
    const zin = k % 2 === 0;
    const z = zin ? `min(1+0.13*on/${frames},1.13)` : `max(1.13-0.13*on/${frames},1.0)`;
    const px = ['iw/2-(iw/zoom/2)', `(iw-iw/zoom)*on/${frames}`, `(iw-iw/zoom)*(1-on/${frames})`][k % 3];
    f.push(`[${k}:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,setsar=1,zoompan=z='${z}':x='${px}':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,eq=saturation=1.12:contrast=1.04,trim=duration=${L.toFixed(3)},setpts=PTS-STARTPTS[s${k}]`);
  });
  let last = 's0';
  let acc = seg[0].dur;
  for (let k = 1; k < n; k++) {
    f.push(`[${last}][s${k}]xfade=transition=${TRANSITIONS[k % TRANSITIONS.length]}:duration=${X}:offset=${acc.toFixed(3)}[x${k}]`);
    last = `x${k}`;
    acc += seg[k].dur;
  }
  const assFile = path.join(dir, 'captions.ass');
  fs.writeFileSync(assFile, buildAss({ words: story.narration.words, hook: story.script.badge || 'DATO CURIOSO', handle: s.watermark ? s.handle : '', duration, style: story.captionStyle || s.captionStyle, captionY: story.captionY ?? 0.68 }));
  f.push(`[${last}]format=yuv420p,${overlayChain(assFile, duration)}[v]`);
  const ai = n;
  const mv = clamp(story.musicVolume ?? 0.1, 0, 1);
  if (music) f.push(`[${ai}:a]apad=pad_dur=1[nar];[${ai + 1}:a]atrim=0:${duration.toFixed(2)},volume=${mv}[m];[nar][m]amix=inputs=2:duration=longest:normalize=0,atrim=0:${duration.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11,afade=t=out:st=${(duration - 0.7).toFixed(2)}:d=0.7[a]`);
  else f.push(`[${ai}:a]apad=pad_dur=1,atrim=0:${duration.toFixed(2)},loudnorm=I=-14:TP=-1.5:LRA=11[a]`);

  const out = path.join(dir, 'story.mp4');
  const tmp = path.join(dir, 'story.tmp.mp4');
  args.push('-filter_complex', f.join(';'), '-map', '[v]', '-map', '[a]', '-t', duration.toFixed(3), ...encodeArgs(tmp));
  await run(BIN.ffmpeg, args, {
    timeoutMs: 40 * 60000,
    onLine: (l) => { const m = l.match(/time=(\d+):(\d+):([\d.]+)/); if (m) onProgress?.(clamp(((+m[1] * 3600 + +m[2] * 60 + +m[3]) / duration) * 100, 0, 99)); },
  });
  fs.renameSync(tmp, out);
  await makeThumb(out, path.join(dir, 'thumb.jpg'), 1.2);
  return { output: out, thumb: path.join(dir, 'thumb.jpg'), duration };
}
