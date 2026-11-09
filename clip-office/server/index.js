// Ludus Clip Office — servidor principal.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, DIRS, PORT, HOST, BIN, secretStatus, setSecrets, getSecret } from './config.js';
import { db, bus, save, flush, now, emit, findClip, updateClip, findTopic, uid } from './db.js';
import { allAgents, log } from './agents.js';
import { chat } from './brain.js';
import { enqueue, resumeJobs, fileUrl } from './jobs.js';
import { ingestFile } from './pipeline/ingest.js';
import { wordsIn } from './pipeline/transcript.js';
import { ensureMusic, listMusic, MUSIC_MOODS } from './pipeline/music.js';
import { LAYOUTS } from './pipeline/render.js';
import { CAPTION_STYLES } from './pipeline/captions.js';
import { CHAT_THEMES } from './pipeline/chatstory.js';
import { VOICES, useRecording } from './pipeline/tts.js';
import { fetchSceneImage } from './pipeline/story.js';
import { startScheduler, runAutomation, AUTOMATION_TYPES } from './scheduler.js';
import { summary as analyticsSummary, addManual } from './integrations/analytics.js';
import { youtubeAuthUrl, youtubeCallback, youtubeConnected } from './integrations/youtube.js';
import { llmAvailable, model } from './llm.js';
import { which, download } from './util.js';
import { authMiddleware, loginRoutes, getPublicUrl } from './auth.js';

const app = express();
app.disable('x-powered-by');
loginRoutes(app, express);
app.use(authMiddleware);
app.use(express.json({ limit: '2mb' }));

// ---------- archivos ----------
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));
for (const sub of ['sources', 'clips', 'stories', 'music', 'voice']) app.use(`/media/${sub}`, express.static(DIRS[sub]));
app.use('/fonts', express.static(DIRS.fonts));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(400).json({ error: e.message }); });

let caps = {};
async function detectCapabilities() {
  const [ffmpeg, ytdlp, python, edge] = await Promise.all([
    which(BIN.ffmpeg, ['-version']), which(BIN.ytdlp, ['--version']), which(BIN.python, ['--version']), which(BIN.python, ['-c', 'import edge_tts;print(edge_tts.__version__ if hasattr(edge_tts,"__version__") else "ok")']),
  ]);
  caps = { ffmpeg, ytdlp, python, edgeTts: edge };
  return caps;
}

function publicSource(s) {
  const { dir, path: p, subsPath, description, ...rest } = s;
  return { ...rest, videoUrl: fileUrl(p) };
}

function statePayload() {
  return {
    settings: db.settings,
    agents: allAgents(),
    jobs: db.jobs.slice(-60),
    clips: db.clips,
    sources: db.sources.map(publicSource),
    topics: db.topics.slice(-200),
    automations: db.automations,
    automationTypes: AUTOMATION_TYPES,
    agentLog: db.agentLog.slice(-80),
    analytics: analyticsSummary(),
    secrets: secretStatus(),
    capabilities: { ...caps, llm: llmAvailable(), model: model(), youtubeUpload: youtubeConnected(), publicUrl: getPublicUrl(), hasPassword: Boolean(getSecret('APP_PASSWORD')) },
    options: { music: listMusic(), moods: MUSIC_MOODS, voices: VOICES, layouts: LAYOUTS, captionStyles: CAPTION_STYLES, chatThemes: Object.fromEntries(Object.entries(CHAT_THEMES).map(([k, v]) => [k, v.label])) },
  };
}

app.get('/api/state', (req, res) => res.json(statePayload()));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  bus.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { bus.off('event', send); clearInterval(ping); });
});

// ---------- chat ----------
app.get('/api/chat/:agent', (req, res) => res.json(db.chats[req.params.agent] || []));
app.post('/api/chat/:agent', wrap(async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 4000);
  if (!text) throw new Error('Mensaje vacío');
  res.json(await chat(req.params.agent, text));
}));
app.delete('/api/chat/:agent', (req, res) => { db.chats[req.params.agent] = []; save(); res.json({ ok: true }); });

// ---------- trabajos ----------
const ALLOWED_JOBS = new Set(['clips', 'render', 'research', 'story', 'story_render', 'chat', 'chat_render', 'scout', 'analytics', 'publish']);
app.post('/api/jobs', wrap(async (req, res) => {
  const { type, payload } = req.body;
  if (!ALLOWED_JOBS.has(type)) throw new Error('Tipo de trabajo no válido');
  if (type === 'clips' && !payload?.url && !payload?.sourceId) throw new Error('Falta el link del video');
  res.json(enqueue(type, payload || {}));
}));
app.post('/api/jobs/:id/retry', wrap(async (req, res) => {
  const j = db.jobs.find((x) => x.id === req.params.id);
  if (!j) throw new Error('No existe');
  res.json(enqueue(j.type, j.payload, { by: 'reintento' }));
}));
app.delete('/api/jobs/:id', (req, res) => {
  const j = db.jobs.find((x) => x.id === req.params.id);
  if (j && j.status === 'queued') { j.status = 'cancelled'; j.step = 'Cancelado'; save(); emit('job', j); }
  res.json({ ok: true });
});

app.post('/api/upload', express.raw({ type: '*/*', limit: '4gb' }), wrap(async (req, res) => {
  const name = decodeURIComponent(req.get('x-filename') || 'video.mp4').replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_');
  if (!req.body?.length) throw new Error('Archivo vacío');
  const tmp = path.join(DIRS.tmp, `up-${Date.now()}${path.extname(name) || '.mp4'}`);
  fs.writeFileSync(tmp, req.body);
  const src = await ingestFile(tmp, name);
  const job = enqueue('clips', { sourceId: src.id, count: Number(req.get('x-count')) || db.settings.clipCount, seconds: Number(req.get('x-seconds')) || db.settings.clipSeconds });
  res.json({ source: publicSource(src), job });
}));

// ---------- clips ----------
const EDITABLE = ['hook', 'title', 'description', 'hashtags', 'start', 'end', 'captionStyle', 'layout', 'cropX', 'zoom', 'music', 'musicVolume', 'originalVolume', 'commentary', 'showCommentary', 'words', 'captionY', 'voice', 'scenes', 'status', 'notes', 'theme', 'voices'];
app.patch('/api/clips/:id', wrap(async (req, res) => {
  const c = findClip(req.params.id);
  if (!c) throw new Error('No existe');
  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => EDITABLE.includes(k)));
  if (patch.scenes && c.kind === 'story') {
    patch.scenes = patch.scenes.map((s, i) => ({ ...(c.scenes[i] || {}), text: s.text, visual: s.visual ?? c.scenes[i]?.visual, query: s.query ?? c.scenes[i]?.query }));
  }
  if (c.kind === 'gameplay' && ('start' in patch || 'end' in patch) && !('words' in patch)) {
    const src = db.sources.find((s) => s.id === c.sourceId);
    const wf = src && path.join(src.dir, 'words.json');
    if (wf && fs.existsSync(wf)) patch.words = wordsIn(JSON.parse(fs.readFileSync(wf, 'utf8')), Number(patch.start ?? c.start), Number(patch.end ?? c.end));
  }
  if (c.kind === 'chat' && req.body.chat) {
    const { normalizeChat } = await import('./pipeline/chatstory.js');
    patch.chat = normalizeChat({ ...c.chat, ...req.body.chat, title: patch.title ?? c.title });
    patch.hook = patch.chat.header;
  }
  if (c.kind === 'story' && (patch.hook != null)) c.script.hook = patch.hook;
  if (c.kind === 'story' && req.body.cta != null) c.script.cta = String(req.body.cta);
  res.json(updateClip(c.id, patch));
}));
app.post('/api/clips/:id/render', wrap(async (req, res) => {
  const c = findClip(req.params.id);
  if (!c) throw new Error('No existe');
  res.json(enqueue(c.kind === 'story' ? 'story_render' : c.kind === 'chat' ? 'chat_render' : 'render', { clipId: c.id, ...(req.body || {}) }));
}));
app.post('/api/clips/:id/approve', wrap(async (req, res) => {
  const c = updateClip(req.params.id, { status: 'approved', approvedAt: now() });
  log('valeria', `Aprobaste "${c.title}". Andrés lo deja listo para publicar.`);
  res.json(c);
}));
app.post('/api/clips/:id/publish', wrap(async (req, res) => res.json(enqueue('publish', { clipId: req.params.id, privacy: req.body?.privacy || 'private' }))));
app.post('/api/clips/:id/posted', wrap(async (req, res) => {
  const c = findClip(req.params.id);
  const posted = { ...(c.posted || {}), [req.body.platform]: { url: req.body.url || '', ts: now() } };
  res.json(updateClip(c.id, { posted, status: c.status === 'published' ? c.status : 'published' }));
}));
app.delete('/api/clips/:id', (req, res) => {
  const i = db.clips.findIndex((c) => c.id === req.params.id);
  if (i >= 0) {
    const [c] = db.clips.splice(i, 1);
    fs.rmSync(path.join(c.kind === 'gameplay' ? DIRS.clips : DIRS.stories, c.id), { recursive: true, force: true });
    save();
    emit('clip_deleted', { id: c.id });
  }
  res.json({ ok: true });
});
app.get('/api/clips/:id/download', (req, res) => {
  const c = findClip(req.params.id);
  if (!c?.output || !fs.existsSync(c.output)) return res.status(404).send('Aún no está renderizado');
  const safe = (c.title || c.hook || c.id).replace(/[^\w áéíóúñÁÉÍÓÚÑ-]/g, '').trim().slice(0, 60) || c.id;
  res.download(c.output, `${safe}.mp4`);
});

// imagen de una escena (videos de datos curiosos)
app.post('/api/clips/:id/scenes/:i/image', wrap(async (req, res) => {
  const c = findClip(req.params.id);
  const i = Number(req.params.i);
  if (!c || c.kind !== 'story' || !c.scenes[i]) throw new Error('Escena no encontrada');
  const dir = path.join(DIRS.stories, c.id);
  const sc = c.scenes[i];
  if (req.body.visual) sc.visual = req.body.visual;
  if (req.body.query) sc.query = req.body.query;
  let r;
  if (req.body.url) {
    const file = path.join(dir, `scene-${i}-${Date.now() % 100000}.jpg`);
    await download(req.body.url, file, { minBytes: 2000 });
    r = { image: file, credit: req.body.credit || 'Imagen aportada por ti' };
  } else {
    r = await fetchSceneImage(sc, i, dir, { source: req.body.mode || 'ai' });
  }
  Object.assign(sc, { image: r.image, imageUrl: fileUrl(r.image) + `?v=${Date.now()}`, credit: r.credit });
  res.json(updateClip(c.id, { scenes: c.scenes }));
}));

// tu voz grabada desde el navegador
app.post('/api/clips/:id/voice', express.raw({ type: '*/*', limit: '200mb' }), wrap(async (req, res) => {
  const c = findClip(req.params.id);
  if (!c || c.kind !== 'story') throw new Error('Solo para videos de datos curiosos');
  const dir = path.join(DIRS.stories, c.id);
  const tmp = path.join(dir, `rec-${Date.now()}.webm`);
  fs.writeFileSync(tmp, req.body);
  const { narrationText } = await import('./pipeline/story.js');
  const text = narrationText(c.script);
  const n = await useRecording(tmp, text, dir);
  fs.rmSync(tmp, { force: true });
  log('nico', 'Usé tu voz grabada para la narración 🎙️. Dale a "Renderizar" para montar el video.');
  res.json(updateClip(c.id, { narration: { ...n, text, url: fileUrl(n.audio) + `?v=${Date.now()}` }, customVoice: true, words: n.words }));
}));

// ---------- temas ----------
// ---------- usar tu Claude (claude.ai) sin API key: pegar el JSON que te dio ----------
function parseLooseJson(text) {
  const t = String(text || '').replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), z = t.lastIndexOf('}');
  if (a < 0 || z <= a) throw new Error('No encontré un JSON en lo que pegaste. Copia la respuesta completa de Claude.');
  try { return JSON.parse(t.slice(a, z + 1)); } catch (e) { throw new Error(`El JSON tiene un error: ${e.message}`); }
}
app.post('/api/import', wrap(async (req, res) => {
  const { type, text, theme = 'oscuro', voices = false } = req.body;
  const j = parseLooseJson(text);
  if (type === 'chat') {
    const { normalizeChat } = await import('./pipeline/chatstory.js');
    const chat = normalizeChat(j);
    if (chat.messages.length < 3) throw new Error('La historia necesita al menos 3 mensajes con personajes que existan en "characters".');
    const clip = { id: uid('chat_'), kind: 'chat', sourceTitle: 'Escrita con tu Claude', title: chat.title, hook: chat.header, description: chat.description, hashtags: chat.hashtags, chat, theme, voices: Boolean(voices), music: 'chill', musicVolume: 0.18, status: 'draft', score: 85, version: 0, createdAt: now(), updatedAt: now(), compliance: { risk: 'bajo', notes: ['✅ Historia original escrita con tu Claude.'] } };
    db.clips.push(clip); save(); emit('clip', clip);
    log('mateo', `Recibí tu guion "${chat.title}" escrito con Claude. Sofía lo anima ya.`);
    return res.json({ clip, job: enqueue('chat_render', { clipId: clip.id }) });
  }
  if (type === 'story') {
    const scenes = (j.scenes || []).filter((x) => x?.text).slice(0, 8).map((x) => ({ text: String(x.text), visual: String(x.visual || x.text), query: String(x.query || '') }));
    if (!j.hook || scenes.length < 2) throw new Error('El guion necesita "hook" y al menos 2 "scenes".');
    const topic = { id: uid('top_'), title: String(j.title || j.hook).slice(0, 140), summary: scenes.map((x) => x.text).join(' ').slice(0, 800), source: String(j.source || ''), category: String(j.category || 'General'), viralScore: 85, method: 'tu Claude', status: 'en producción', createdAt: now() };
    db.topics.push(topic);
    const script = { title: topic.title, hook: String(j.hook), scenes, cta: String(j.cta || 'Síguenos para más datos que no te enseñaron en el colegio.'), badge: String(j.badge || 'DATO CURIOSO').toUpperCase().slice(0, 24), description: String(j.description || `${topic.title}\n\n📚 Fuente: ${topic.source || '—'}`), hashtags: Array.isArray(j.hashtags) ? j.hashtags : ['#DatosCuriosos', '#Shorts'] };
    const clip = { id: uid('story_'), kind: 'story', topicId: topic.id, sourceTitle: topic.title, sourceUrl: topic.source, title: script.title, hook: script.hook, description: script.description, hashtags: script.hashtags, script, scenes: scenes.map((x) => ({ ...x })), voice: db.settings.voice, music: 'misterio', musicVolume: 0.1, captionStyle: db.settings.captionStyle, status: 'draft', score: 85, version: 0, createdAt: now(), updatedAt: now() };
    db.clips.push(clip); save(); emit('clip', clip); emit('topic', topic);
    log('mateo', `Recibí tu guion "${script.title}" escrito con Claude. Camila hace las imágenes y Nico la voz.`);
    return res.json({ clip, job: enqueue('story_render', { clipId: clip.id, images: true, voice: true }) });
  }
  throw new Error('Tipo no válido');
}));

app.post('/api/topics', wrap(async (req, res) => {
  const { title, summary = '', source = '', category = 'General' } = req.body;
  if (!title) throw new Error('Falta el título');
  const t = { id: uid('top_'), title, summary: summary || title, source, category, viralScore: 70, method: 'manual', status: 'nuevo', createdAt: now() };
  db.topics.push(t);
  save();
  emit('topic', t);
  res.json(t);
}));
app.delete('/api/topics/:id', (req, res) => { db.topics = db.topics.filter((t) => t.id !== req.params.id); save(); res.json({ ok: true }); });
app.post('/api/topics/:id/story', wrap(async (req, res) => {
  if (!findTopic(req.params.id)) throw new Error('Tema no encontrado');
  res.json(enqueue('story', { topicId: req.params.id, tone: req.body?.tone, voice: req.body?.voice }));
}));

// ---------- automatizaciones ----------
app.post('/api/automations', wrap(async (req, res) => {
  const { name, type, intervalMin = 180, enabled = true, params = {} } = req.body;
  if (!AUTOMATION_TYPES[type]) throw new Error('Tipo no válido');
  const a = { id: uid('auto_'), name: name || AUTOMATION_TYPES[type].label, type, intervalMin: Math.max(15, Number(intervalMin)), enabled, params, runs: 0, lastRun: null, createdAt: now() };
  db.automations.push(a);
  save();
  res.json(a);
}));
app.patch('/api/automations/:id', wrap(async (req, res) => {
  const a = db.automations.find((x) => x.id === req.params.id);
  if (!a) throw new Error('No existe');
  for (const k of ['name', 'enabled', 'params']) if (k in req.body) a[k] = req.body[k];
  if ('intervalMin' in req.body) a.intervalMin = Math.max(15, Number(req.body.intervalMin) || 60);
  save();
  emit('automation', a);
  res.json(a);
}));
app.post('/api/automations/:id/run', wrap(async (req, res) => {
  const a = db.automations.find((x) => x.id === req.params.id);
  if (!a) throw new Error('No existe');
  const job = runAutomation(a, 'tú');
  if (job) job.automationId = a.id;
  res.json(job);
}));
app.delete('/api/automations/:id', (req, res) => { db.automations = db.automations.filter((a) => a.id !== req.params.id); save(); res.json({ ok: true }); });

// ---------- analytics ----------
app.get('/api/analytics', (req, res) => res.json(analyticsSummary()));
app.put('/api/analytics/accounts', wrap(async (req, res) => {
  for (const k of ['youtube', 'tiktok', 'instagram']) if (k in req.body) db.analytics.accounts[k] = String(req.body[k] || '').trim();
  save();
  res.json(db.analytics.accounts);
}));
app.post('/api/analytics/manual', wrap(async (req, res) => {
  if (!['youtube', 'tiktok', 'instagram'].includes(req.body.platform)) throw new Error('Plataforma no válida');
  addManual(req.body);
  res.json(analyticsSummary());
}));
app.post('/api/analytics/refresh', wrap(async (req, res) => res.json(enqueue('analytics', {}))));

// ---------- ajustes ----------
const SETTINGS_KEYS = Object.keys(db.settings);
app.put('/api/settings', wrap(async (req, res) => {
  for (const [k, v] of Object.entries(req.body)) if (SETTINGS_KEYS.includes(k)) db.settings[k] = v;
  save();
  emit('settings', db.settings);
  res.json(db.settings);
}));
app.put('/api/secrets', wrap(async (req, res) => { setSecrets(req.body || {}); res.json(secretStatus()); }));
app.get('/api/capabilities', wrap(async (req, res) => res.json({ ...(await detectCapabilities()), llm: llmAvailable() })));

// ---------- YouTube OAuth ----------
app.get('/api/youtube/auth', wrap(async (req, res) => res.redirect(youtubeAuthUrl())));
app.get('/api/youtube/callback', wrap(async (req, res) => {
  await youtubeCallback(String(req.query.code || ''));
  log('andres', '✅ Canal de YouTube conectado. Ya puedo publicar tus Shorts.');
  res.redirect('/#analytics');
}));

// ---------- arranque ----------
const server = app.listen(PORT, HOST, async () => {
  console.log(`\n🏢 Ludus Clip Office corriendo en http://localhost:${PORT}\n`);
  await detectCapabilities();
  const missing = Object.entries(caps).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) console.warn(`⚠️  Falta instalar: ${missing.join(', ')} → ejecuta "npm run setup"`);
  if (!llmAvailable()) console.warn('ℹ️  Sin ANTHROPIC_API_KEY: los agentes funcionan en modo básico. Agrégala en Ajustes.');
  if (caps.ffmpeg) ensureMusic().then(() => emit('options', { music: listMusic() })).catch((e) => console.warn('[music]', e.message));
  resumeJobs();
  startScheduler();
});

const shutdown = () => { flush(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
