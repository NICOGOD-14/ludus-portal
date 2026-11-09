// Cola de trabajos: cada tarea pasa por los agentes de la oficina.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './config.js';
import { db, uid, now, save, emit, findClip, findSource, findTopic, updateClip } from './db.js';
import { agentWork, agentDone, agentError, setAgent, log } from './agents.js';
import { ingestUrl, searchVideos, youtubeId } from './pipeline/ingest.js';
import { transcribe, wordsIn } from './pipeline/transcript.js';
import { findHighlights } from './pipeline/highlights.js';
import { writeClipCopy, complianceCheck } from './pipeline/copywriter.js';
import { renderClip } from './pipeline/render.js';
import { researchTopics } from './pipeline/research.js';
import { writeScript, narrationText, fetchSceneImage, renderStory } from './pipeline/story.js';
import { synthesize } from './pipeline/tts.js';
import { writeChatScript, renderChat } from './pipeline/chatstory.js';
import { refreshAnalytics } from './integrations/analytics.js';
import { uploadToYoutube } from './integrations/youtube.js';

const LIGHT = new Set(['research', 'analytics', 'scout', 'publish']);
const running = { heavy: 0, light: 0 };
const LIMIT = { heavy: 1, light: 2 };

export const JOB_LABELS = {
  clips: 'Clips desde video', render: 'Render de clip', research: 'Investigación', story: 'Video de dato curioso',
  story_render: 'Render de dato curioso', chat: 'Historia en chat', chat_render: 'Render de historia en chat', scout: 'Búsqueda de videos', analytics: 'Estadísticas', publish: 'Publicación',
};

export function enqueue(type, payload = {}, { by = 'tú' } = {}) {
  const job = { id: uid('job_'), type, label: JOB_LABELS[type] || type, payload, status: 'queued', progress: 0, step: 'En cola', by, createdAt: now(), log: [] };
  db.jobs.push(job);
  if (db.jobs.length > 300) db.jobs.splice(0, db.jobs.length - 300);
  save();
  emit('job', job);
  setImmediate(pump);
  return job;
}

function pump() {
  for (const job of db.jobs) {
    if (job.status !== 'queued') continue;
    const lane = LIGHT.has(job.type) ? 'light' : 'heavy';
    if (running[lane] >= LIMIT[lane]) continue;
    running[lane]++;
    exec(job).finally(() => { running[lane]--; setImmediate(pump); });
  }
}

/** Al iniciar: los trabajos que quedaron a medias vuelven a la cola. */
export function resumeJobs() {
  db.jobs.forEach((j) => { if (j.status === 'running') { j.status = 'queued'; j.step = 'Reanudado'; } });
  save();
  pump();
}

function step(job, agentId, text, progress) {
  job.step = text;
  if (progress != null) job.progress = Math.round(progress);
  job.agent = agentId;
  job.log.push({ ts: now(), agentId, text });
  if (job.log.length > 80) job.log.shift();
  agentWork(agentId, text, progress ?? 0);
  save();
  emit('job', job);
}

async function exec(job) {
  job.status = 'running';
  job.startedAt = now();
  emit('job', job);
  try {
    const handler = HANDLERS[job.type];
    if (!handler) throw new Error(`Tipo de trabajo desconocido: ${job.type}`);
    job.result = await handler(job);
    job.status = 'done';
    job.progress = 100;
    job.step = 'Terminado';
  } catch (e) {
    console.error(`[job ${job.type}]`, e);
    job.status = 'error';
    job.error = e.message;
    job.step = 'Error';
    if (job.agent) agentError(job.agent, e.message.slice(0, 140));
    const c = job.payload?.clipId && findClip(job.payload.clipId);
    if (c && c.status === 'rendering') updateClip(c.id, { status: c.output ? 'ready' : 'draft' });
    log('valeria', `El trabajo "${job.label}" falló: ${e.message.slice(0, 160)}`);
  }
  job.finishedAt = now();
  if (job.agent && job.status === 'done') agentDone(job.agent, `Terminé: ${job.label}`);
  save();
  emit('job', job);
}

const fileUrl = (p) => (p ? '/media/' + path.relative(DIRS.data, p).split(path.sep).join('/') : '');

function newClipFromMoment(src, m, copy, words, i) {
  const s = db.settings;
  return {
    id: uid('clip_'), kind: 'gameplay', sourceId: src.id, sourceTitle: src.title, sourceUrl: src.url, index: i + 1,
    start: m.start, end: m.end, score: m.score, reason: m.reason,
    hook: copy.hook, title: copy.title, titleOptions: copy.titleOptions || [], description: copy.description, hashtags: copy.hashtags || [],
    commentary: copy.commentary || '', words, captionStyle: s.captionStyle, layout: s.layout, cropX: 0.5, zoom: null,
    music: s.musicMood, musicVolume: s.musicVolume, originalVolume: 1,
    status: 'draft', version: 0, createdAt: now(), updatedAt: now(),
  };
}

async function doRenderClip(job, clip, base = 0, span = 100) {
  const src = findSource(clip.sourceId);
  if (!src || !fs.existsSync(src.path)) throw new Error('La fuente de este clip ya no existe');
  updateClip(clip.id, { status: 'rendering' });
  step(job, 'sofia', `Renderizando clip ${clip.index ?? ''}: "${clip.hook}"`, base);
  const r = await renderClip(clip, src, { onProgress: (p) => { job.progress = Math.round(base + (p / 100) * span); setAgent('sofia', { progress: p }); emit('job', job); } });
  const compliance = complianceCheck(clip, src);
  updateClip(clip.id, { status: 'ready', output: r.output, video: fileUrl(r.output) + `?v=${Date.now()}`, thumb: fileUrl(r.thumb) + `?v=${Date.now()}`, duration: r.duration, version: (clip.version || 0) + 1, compliance, renderedAt: now() });
}

const HANDLERS = {
  async clips(job) {
    const { url, sourceId, count = db.settings.clipCount, seconds = db.settings.clipSeconds, autoRender = true } = job.payload;
    let src;
    if (sourceId) src = findSource(sourceId);
    else {
      step(job, 'diego', `Descargando ${url}`, 2);
      src = await ingestUrl(url, { onProgress: (p, t) => { job.progress = Math.round(p * 0.25); setAgent('diego', { progress: p, task: t }); emit('job', job); } });
    }
    if (!src) throw new Error('Fuente no encontrada');
    log('diego', `Fuente lista: "${src.title}" (${Math.round(src.duration)} s)`);
    step(job, 'bruno', 'Transcribiendo el audio palabra por palabra', 26);
    const words = await transcribe(src);
    save();
    log('bruno', words.length ? `Transcripción lista: ${words.length} palabras (${src.transcriptMethod})` : 'Este video no trae subtítulos: los clips irán sin texto hablado (puedes escribirlo en el Estudio o agregar OPENAI_API_KEY para Whisper).');
    step(job, 'sofia', 'Buscando los momentos más épicos', 32);
    const moments = await findHighlights(src, words, { count, len: seconds, onProgress: (p, t) => { job.progress = Math.round(32 + p * 0.13); setAgent('sofia', { progress: p, task: t }); emit('job', job); } });
    const wordsBy = moments.map((m) => wordsIn(words, m.start, m.end));
    step(job, 'mateo', `Escribiendo hooks y títulos para ${moments.length} clips`, 46);
    const copies = await writeClipCopy(src, moments, wordsBy);
    const clips = moments.map((m, i) => newClipFromMoment(src, m, copies[i], wordsBy[i], i));
    clips.forEach((c) => { c.compliance = complianceCheck(c, src); });
    db.clips.push(...clips);
    save();
    clips.forEach((c) => emit('clip', c));
    step(job, 'tomas', 'Revisando derechos y monetización', 50);
    log('tomas', `Riesgo de copyright: ${clips[0]?.compliance.risk || 'n/a'}. ${clips[0]?.compliance.notes[0] || ''}`);
    if (autoRender) {
      for (let i = 0; i < clips.length; i++) await doRenderClip(job, findClip(clips[i].id), 50 + (i / clips.length) * 48, 48 / clips.length);
    }
    step(job, 'andres', `¡${clips.length} clips listos para revisar en el Estudio!`, 99);
    log('valeria', `Equipo: terminamos ${clips.length} clips de "${src.title.slice(0, 60)}". Están en el Estudio para que los revises.`);
    return { sourceId: src.id, clipIds: clips.map((c) => c.id) };
  },

  async render(job) {
    const clip = findClip(job.payload.clipId);
    if (!clip) throw new Error('Clip no encontrado');
    if (clip.kind === 'story') return HANDLERS.story_render(job);
    step(job, 'bruno', 'Preparando subtítulos', 3);
    await doRenderClip(job, clip, 5, 94);
    return { clipId: clip.id };
  },

  async research(job) {
    const { query = '', count = 6, autoStory = 0 } = job.payload;
    step(job, 'lucia', query ? `Investigando: ${query}` : 'Buscando datos curiosos virales', 10);
    const topics = await researchTopics(query, count, { onProgress: (p, t) => step(job, 'lucia', t, p) });
    log('lucia', `Encontré ${topics.length} temas: ${topics.slice(0, 3).map((t) => `"${t.title}"`).join(', ')}…`);
    const best = [...topics].sort((a, b) => b.viralScore - a.viralScore).slice(0, autoStory);
    best.forEach((t) => enqueue('story', { topicId: t.id, autoRender: true }, { by: 'automatización' }));
    return { topicIds: topics.map((t) => t.id) };
  },

  async story(job) {
    const { topicId, tone = 'misterio', autoRender = true, voice } = job.payload;
    const topic = findTopic(topicId);
    if (!topic) throw new Error('Tema no encontrado');
    topic.status = 'en producción';
    step(job, 'mateo', `Escribiendo guion: "${topic.title}"`, 5);
    const script = await writeScript(topic, { tone });
    const id = uid('story_');
    const dir = path.join(DIRS.stories, id);
    fs.mkdirSync(dir, { recursive: true });
    const clip = {
      id, kind: 'story', topicId, sourceTitle: topic.title, sourceUrl: topic.source, title: script.title, hook: script.hook,
      description: script.description, hashtags: script.hashtags, script, scenes: script.scenes.map((s) => ({ ...s })),
      voice: voice || db.settings.voice, music: 'misterio', musicVolume: 0.1, captionStyle: db.settings.captionStyle,
      status: 'draft', score: topic.viralScore, version: 0, createdAt: now(), updatedAt: now(),
    };
    db.clips.push(clip);
    save();
    emit('clip', clip);
    await produceStory(job, clip, { images: true, voice: true, render: autoRender });
    topic.status = 'producido';
    save();
    return { clipId: id };
  },

  async chat(job) {
    const { premise = '', tone = 'divertido', theme = 'oscuro', autoRender = true } = job.payload;
    step(job, 'mateo', `Escribiendo la historia en chat${premise ? `: "${premise.slice(0, 50)}"` : ''}`, 5);
    const chat = await writeChatScript(premise, { tone });
    const clip = {
      id: uid('chat_'), kind: 'chat', sourceTitle: premise || 'Historia original', title: chat.title, hook: chat.header,
      description: chat.description, hashtags: chat.hashtags, chat, theme, music: 'chill', musicVolume: 0.18,
      status: 'draft', score: 80, version: 0, createdAt: now(), updatedAt: now(),
      compliance: { risk: 'bajo', notes: ['✅ Historia, personajes y música originales: el formato más seguro para monetizar.', '💡 Si usas nombres de personas o marcas reales, cámbialos antes de publicar.'] },
    };
    db.clips.push(clip);
    save();
    emit('clip', clip);
    log('mateo', `Escribí "${chat.title}" (${chat.messages.length} mensajes). Sofía lo anima.`);
    if (autoRender) await doRenderChat(job, clip);
    return { clipId: clip.id };
  },

  async chat_render(job) {
    const clip = findClip(job.payload.clipId);
    if (!clip) throw new Error('Historia no encontrada');
    await doRenderChat(job, clip);
    return { clipId: clip.id };
  },

  async story_render(job) {
    const clip = findClip(job.payload.clipId);
    if (!clip) throw new Error('Video no encontrado');
    await produceStory(job, clip, { images: job.payload.images ?? false, voice: job.payload.voice ?? !clip.narration, render: true });
    return { clipId: clip.id };
  },

  async scout(job) {
    const { query = 'GTA 6 gameplay', max = 5, creativeCommons = db.settings.requireCreativeCommons, clipsPerVideo = 3, seconds = db.settings.clipSeconds } = job.payload;
    step(job, 'diego', `Buscando videos nuevos: "${query}"`, 10);
    const found = await searchVideos(query, { max: Math.max(max * 3, 10), creativeCommons });
    const done = new Set(db.sources.map((s) => s.videoId).filter(Boolean));
    db.jobs.filter((j) => j.type === 'clips' && j.payload.url).forEach((j) => { const v = youtubeId(j.payload.url); if (v) done.add(v); });
    const fresh = found.filter((v) => v.id && !done.has(v.id)).slice(0, max);
    log('diego', fresh.length ? `Encontré ${fresh.length} videos nuevos para "${query}": ${fresh.map((v) => v.title.slice(0, 40)).join(' · ')}` : `Nada nuevo para "${query}" por ahora.`);
    fresh.forEach((v) => enqueue('clips', { url: v.url, count: clipsPerVideo, seconds, autoRender: true }, { by: 'Diego (scout)' }));
    return { found: found.length, queued: fresh.length, videos: fresh };
  },

  async analytics(job) {
    step(job, 'renata', 'Actualizando métricas de YouTube, TikTok e Instagram', 20);
    const r = await refreshAnalytics();
    log('renata', r.summary);
    return r;
  },

  async publish(job) {
    const clip = findClip(job.payload.clipId);
    if (!clip?.output) throw new Error('Primero renderiza el clip');
    step(job, 'tomas', 'Última revisión de derechos antes de publicar', 5);
    step(job, 'andres', `Subiendo a YouTube: "${clip.title}"`, 15);
    const r = await uploadToYoutube(clip, { privacy: job.payload.privacy || 'private', onProgress: (p) => { job.progress = Math.round(15 + p * 0.84); emit('job', job); } });
    updateClip(clip.id, { status: 'published', youtubeId: r.id, youtubeUrl: `https://youtube.com/shorts/${r.id}`, publishedAt: now() });
    log('andres', `Publicado en YouTube (${job.payload.privacy || 'private'}): https://youtube.com/shorts/${r.id}`);
    return r;
  },
};

async function doRenderChat(job, clip) {
  updateClip(clip.id, { status: 'rendering' });
  step(job, 'nico', 'Poniendo sonidos de mensaje y efectos de trama', 10);
  step(job, 'sofia', 'Animando el chat mensaje por mensaje', 15);
  const r = await renderChat(clip, { onProgress: (p) => { job.progress = Math.round(15 + p * 0.83); setAgent('sofia', { progress: p }); emit('job', job); } });
  updateClip(clip.id, { status: 'ready', output: r.output, video: fileUrl(r.output) + `?v=${Date.now()}`, thumb: fileUrl(r.thumb) + `?v=${Date.now()}`, duration: r.duration, version: (clip.version || 0) + 1, renderedAt: now() });
  step(job, 'tomas', 'Revisión: contenido 100% original ✅', 99);
}

async function produceStory(job, clip, { images, voice, render }) {
  const dir = path.join(DIRS.stories, clip.id);
  fs.mkdirSync(dir, { recursive: true });
  const topic = findTopic(clip.topicId);
  if (images || clip.scenes.some((s) => !s.image || !fs.existsSync(s.image))) {
    for (let i = 0; i < clip.scenes.length; i++) {
      const sc = clip.scenes[i];
      if (!images && sc.image && fs.existsSync(sc.image)) continue;
      step(job, 'camila', `Creando imagen ${i + 1}/${clip.scenes.length}: ${sc.text.slice(0, 50)}…`, 10 + (i / clip.scenes.length) * 30);
      const r = await fetchSceneImage(sc, i, dir, { source: db.settings.imageSource, topicImage: topic?.image });
      sc.image = r.image;
      sc.imageUrl = fileUrl(r.image);
      sc.credit = r.credit;
      updateClip(clip.id, { scenes: clip.scenes });
    }
  }
  clip.script.scenes = clip.scenes.map(({ text, visual, query }) => ({ text, visual, query }));
  const text = narrationText(clip.script);
  const voiceChanged = !clip.customVoice && clip.narration && clip.narration.voice !== clip.voice;
  if (voice || voiceChanged || !clip.narration || clip.narration.text !== text) {
    if (clip.customVoice && clip.narration?.text === text) { /* conserva tu voz grabada */ } else {
      step(job, 'nico', `Grabando la voz (${clip.voice})`, 45);
      const n = await synthesize(text, { voice: clip.voice, dir });
      updateClip(clip.id, { narration: { ...n, text, voice: clip.voice, url: fileUrl(n.audio) + `?v=${Date.now()}` }, customVoice: false });
    }
  }
  const credits = [...new Set(clip.scenes.map((s) => s.credit).filter(Boolean))];
  if (credits.length && !/Imágenes:/.test(clip.description || '')) clip.description = `${clip.description}\n\n🖼️ Imágenes: ${credits.join('; ')}`;
  updateClip(clip.id, { words: clip.narration.words, duration: clip.narration.duration + 0.8 });
  if (!render) { updateClip(clip.id, { status: 'draft' }); return; }
  updateClip(clip.id, { status: 'rendering' });
  step(job, 'sofia', 'Montando el video con efectos y subtítulos', 60);
  const r = await renderStory(clip, { onProgress: (p) => { job.progress = Math.round(60 + p * 0.38); setAgent('sofia', { progress: p }); emit('job', job); } });
  updateClip(clip.id, {
    status: 'ready', output: r.output, video: fileUrl(r.output) + `?v=${Date.now()}`, thumb: fileUrl(r.thumb) + `?v=${Date.now()}`, duration: r.duration, version: (clip.version || 0) + 1, renderedAt: now(),
    compliance: { risk: 'bajo', notes: ['✅ Guion, voz y música originales.', `🖼️ Créditos de imágenes incluidos en la descripción.`, '📚 Verifica la fuente antes de publicar: ' + (clip.sourceUrl || 'sin fuente')] },
  });
  step(job, 'tomas', 'Revisión final: contenido original ✅', 99);
}

export { fileUrl };
