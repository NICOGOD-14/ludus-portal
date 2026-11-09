// Chat con los agentes: Claude con herramientas reales, o modo básico por reglas si no hay API key.
import { db, now, save, emit, findClip, updateClip } from './db.js';
import { AGENTS, agentById, agentState, allAgents, setAgent } from './agents.js';
import { chatWithTools, llmAvailable } from './llm.js';
import { enqueue } from './jobs.js';
import { summary as analyticsSummary } from './integrations/analytics.js';
import { runAutomation } from './scheduler.js';

const clipBrief = (c) => ({ id: c.id, tipo: c.kind, estado: c.status, hook: c.hook, titulo: c.title, score: c.score, duracion: c.end != null ? Math.round(c.end - c.start) : Math.round(c.duration || 0), fuente: c.sourceTitle, riesgo: c.compliance?.risk });

const TOOLS = {
  create_clips_from_url: {
    description: 'Descarga un video (YouTube, TikTok, Twitch, Kick, X o MP4 directo) y crea clips verticales con los mejores momentos, hooks y subtítulos. Úsala cuando el usuario pase un link.',
    input_schema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' }, count: { type: 'integer', description: 'Cuántos clips (1-12). Por defecto 5.' }, seconds: { type: 'integer', description: 'Duración de cada clip en segundos (10-60). Por defecto 35.' } } },
    run: ({ url, count, seconds }) => { const j = enqueue('clips', { url, count: Math.min(12, Math.max(1, count || db.settings.clipCount)), seconds: Math.min(90, Math.max(8, seconds || db.settings.clipSeconds)) }, { by: 'chat' }); return { jobId: j.id, mensaje: 'Trabajo en cola. El equipo va a descargar, cortar y renderizar.' }; },
  },
  scout_videos: {
    description: 'Busca videos nuevos en YouTube sobre un tema (ej. "GTA 6 gameplay") y crea clips automáticamente de los que no se han procesado.',
    input_schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' }, max: { type: 'integer' }, creativeCommons: { type: 'boolean' } } },
    run: ({ query, max, creativeCommons }) => ({ jobId: enqueue('scout', { query, max: Math.min(5, max || 2), creativeCommons: Boolean(creativeCommons) }, { by: 'chat' }).id }),
  },
  research_topics: {
    description: 'Investiga datos curiosos/temas interesantes reales. Si autoStory > 0 también produce esa cantidad de videos con los mejores temas.',
    input_schema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string', description: 'Tema. Vacío = variados.' }, count: { type: 'integer' }, autoStory: { type: 'integer' } } },
    run: ({ query = '', count = 6, autoStory = 0 }) => ({ jobId: enqueue('research', { query, count: Math.min(10, count), autoStory: Math.min(5, autoStory) }, { by: 'chat' }).id }),
  },
  create_story: {
    description: 'Produce un video de dato curioso (guion con hook, voz, imágenes/renders IA, subtítulos, música) a partir de un tema investigado (topicId) o de un tema libre (topic).',
    input_schema: { type: 'object', additionalProperties: false, properties: { topicId: { type: 'string' }, topic: { type: 'string', description: 'Tema libre si no hay topicId' }, tone: { type: 'string', enum: ['misterio', 'épico', 'divertido', 'informativo'] } } },
    run: ({ topicId, topic, tone }) => {
      if (topicId && db.topics.find((t) => t.id === topicId)) return { jobId: enqueue('story', { topicId, tone }, { by: 'chat' }).id };
      return { jobId: enqueue('research', { query: topic || '', count: 3, autoStory: 1 }, { by: 'chat' }).id, nota: 'Primero Lucía investiga el tema y luego se produce el video del mejor dato.' };
    },
  },
  create_chat_story: {
    description: 'Crea una "historia en chat" ORIGINAL: una conversación de grupo animada mensaje a mensaje (estilo WhatsApp/Slack) con remate final, sin voces: sonidos de notificación y efectos de trama. Ideal para humor de oficina, amigos, familia, gamers o datos curiosos contados como chat. Es el formato más seguro para monetizar.',
    input_schema: { type: 'object', additionalProperties: false, properties: { premise: { type: 'string', description: 'Situación o idea de la historia' }, tone: { type: 'string', enum: ['divertido', 'misterio', 'drama', 'informativo'] }, theme: { type: 'string', enum: ['oscuro', 'whatsapp', 'imessage', 'ludus'] } } },
    run: ({ premise = '', tone, theme }) => ({ jobId: enqueue('chat', { premise, tone, theme }, { by: 'chat' }).id }),
  },
  list_clips: {
    description: 'Lista los clips y videos recientes con su estado.',
    input_schema: { type: 'object', additionalProperties: false, properties: { status: { type: 'string' }, limit: { type: 'integer' } } },
    run: ({ status, limit = 12 }) => db.clips.filter((c) => !status || c.status === status).slice(-limit).reverse().map(clipBrief),
  },
  update_clip: {
    description: 'Edita un clip: hook (texto en pantalla), título, descripción, inicio/fin (segundos de la fuente), estilo de subtítulos, layout, música. Después llama render_clip para aplicar.',
    input_schema: { type: 'object', additionalProperties: false, required: ['clipId'], properties: { clipId: { type: 'string' }, hook: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, captionStyle: { type: 'string', enum: ['karaoke', 'clean', 'boxed', 'none'] }, layout: { type: 'string', enum: ['blur', 'crop', 'zoom'] }, music: { type: 'string' }, commentary: { type: 'string' } } },
    run: ({ clipId, ...patch }) => { if (!findClip(clipId)) throw new Error('No existe ese clip'); return clipBrief(updateClip(clipId, patch)); },
  },
  render_clip: {
    description: 'Vuelve a renderizar un clip con sus ajustes actuales.',
    input_schema: { type: 'object', additionalProperties: false, required: ['clipId'], properties: { clipId: { type: 'string' } } },
    run: ({ clipId }) => ({ jobId: enqueue('render', { clipId }, { by: 'chat' }).id }),
  },
  publish_clip: {
    description: 'Sube un clip renderizado a YouTube. Solo si el usuario lo pide explícitamente. privacy por defecto "private".',
    input_schema: { type: 'object', additionalProperties: false, required: ['clipId'], properties: { clipId: { type: 'string' }, privacy: { type: 'string', enum: ['private', 'unlisted', 'public'] } } },
    run: ({ clipId, privacy = 'private' }) => ({ jobId: enqueue('publish', { clipId, privacy }, { by: 'chat' }).id }),
  },
  refresh_analytics: {
    description: 'Actualiza y devuelve las métricas de YouTube/TikTok/Instagram.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
    run: () => { enqueue('analytics', {}, { by: 'chat' }); const s = analyticsSummary(); return { produccion: s.production, plataformas: Object.fromEntries(Object.entries(s.platforms).map(([k, v]) => [k, { ultimo: v.last, delta24h: v.delta24h }])) }; },
  },
  set_automation: {
    description: 'Activa/desactiva o crea una automatización 24/7 (scout = cazar videos, research = datos curiosos, chat = historias en chat, analytics = métricas).',
    input_schema: { type: 'object', additionalProperties: false, required: ['type'], properties: { type: { type: 'string', enum: ['scout', 'research', 'chat', 'analytics'] }, enabled: { type: 'boolean' }, query: { type: 'string' }, intervalMin: { type: 'integer' }, runNow: { type: 'boolean' } } },
    run: ({ type, enabled = true, query, intervalMin, runNow }) => {
      let a = db.automations.find((x) => x.type === type && (!query || x.params?.query === query)) || db.automations.find((x) => x.type === type);
      if (!a) { a = { id: `auto_${Date.now()}`, name: `${type}: ${query || 'general'}`, type, intervalMin: intervalMin || 180, enabled, params: { query: query || '' }, runs: 0, createdAt: now() }; db.automations.push(a); }
      a.enabled = enabled;
      if (query != null) a.params = { ...(a.params || {}), query };
      if (intervalMin) a.intervalMin = Math.max(15, intervalMin);
      save();
      emit('automation', a);
      if (runNow) runAutomation(a, 'chat');
      return a;
    },
  },
  get_status: {
    description: 'Estado de la oficina: qué hace cada agente, trabajos en curso y producción.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
    run: () => ({
      agentes: allAgents().map((a) => ({ nombre: a.name, rol: a.role, estado: a.state.status, tarea: a.state.task })),
      trabajos: db.jobs.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => ({ tipo: j.label, estado: j.status, paso: j.step, progreso: j.progress })),
      ultimosErrores: db.jobs.filter((j) => j.status === 'error').slice(-3).map((j) => ({ tipo: j.label, error: j.error })),
      produccion: analyticsSummary().production,
      temasNuevos: db.topics.filter((t) => t.status === 'nuevo').slice(-8).map((t) => ({ id: t.id, titulo: t.title, score: t.viralScore })),
    }),
  },
};

function toolsFor(agent) {
  const names = agent.tools === '*' ? Object.keys(TOOLS) : agent.tools;
  return names.map((name) => ({ name, ...TOOLS[name] }));
}

function systemPrompt(agent) {
  const s = db.settings;
  const team = AGENTS.map((a) => `- ${a.name} (${a.role}): ${a.skills.join(', ')}`).join('\n');
  return `Eres ${agent.name}, ${agent.role} en "Ludus Clip Office", una oficina de agentes que produce Shorts, Reels y TikToks para el canal "${s.channelName}" (${s.handle}).
Tu personalidad: ${agent.bio}
Tus responsabilidades: ${agent.duties.join('; ')}.
El equipo:
${team}

Cómo trabajas:
- Hablas en español latino, cercano y con energía, en respuestas cortas (2-6 frases) como en un chat de oficina. Usa algún emoji, sin exagerar.
- Cuando el usuario pide algo que tus herramientas pueden hacer, hazlo de inmediato con la herramienta y luego cuéntale qué pusiste en marcha y quién del equipo lo hará. Si algo le toca a otro compañero y no tienes la herramienta, dile con quién hablar.
- Objetivo del canal: muchas vistas y monetización sostenible. Recomienda formatos que retienen (hook en 2 s, subtítulos grandes, 20-45 s, final que invita a repetir).
- Sé honesto sobre derechos: clips de gameplays de terceros pueden recibir reclamos o quedar como "contenido reutilizado" sin monetizar; lo más seguro es usar tu propio gameplay, videos con licencia Creative Commons o con permiso, y añadir comentario propio. La música de la oficina es original y libre.
- No inventes datos ni métricas: usa get_status, list_clips o refresh_analytics para responder sobre el estado.
- Hoy es ${new Date().toLocaleDateString('es')}.`;
}

// ---------- modo básico sin API key ----------
const URL_RE = /(https?:\/\/[^\s]+)/i;
function basicReply(agent, text) {
  const t = text.toLowerCase();
  const url = text.match(URL_RE)?.[1];
  const n = Number((t.match(/(\d+)\s*(clips?|videos?|temas?|datos?)/) || [])[1]) || undefined;
  const secs = Number((t.match(/(\d+)\s*(s\b|seg|segundos)/) || [])[1]) || undefined;
  if (url) {
    TOOLS.create_clips_from_url.run({ url, count: n, seconds: secs });
    return `¡Va! 🎬 Diego ya está descargando el video, Bruno lo transcribe y Sofía corta los ${n || db.settings.clipCount} mejores momentos${secs ? ` de ~${secs} s` : ''}. Te aviso en el Estudio cuando estén listos.`;
  }
  if (/(historia|chat|conversaci)/.test(t) && !/(investiga)/.test(t)) {
    const premise = text.replace(/.*?(sobre|de|acerca de)\s+/i, '').replace(/[?.!¿¡]/g, '').trim();
    const theme = /whatsapp/.test(t) ? 'whatsapp' : /imessage|iphone/.test(t) ? 'imessage' : 'oscuro';
    TOOLS.create_chat_story.run({ premise: /(sobre|acerca de)/i.test(text) ? premise : '', theme });
    return `💬 ¡Me encanta! Mateo está escribiendo la historia en chat y Sofía la anima mensaje por mensaje, con sonidos de notificación y efectos que acompañan la trama. La verás en el Estudio.`;
  }
  if (/(investiga|dato|curios|tema)/.test(t)) {
    const q = text.replace(/.*?(sobre|acerca de)\s+/i, '').replace(/\s+y\s+(haz|hazme|crea|produce|genera|arma|luego).*$/i, '').replace(/[?.!¿¡]/g, '').trim();
    const query = /(sobre|acerca de)/i.test(text) ? q : '';
    const make = /(video|haz|crea|produc)/.test(t) ? 1 : 0;
    TOOLS.research_topics.run({ query, count: n || 6, autoStory: make });
    return `🔎 Lucía está investigando ${query ? `"${query}"` : 'datos curiosos virales'}${make ? ' y en cuanto tenga el mejor, Mateo, Camila y Nico producen el video' : ''}. Revisa la pestaña Datos Curiosos.`;
  }
  if (/(busca|scout|caza|nuevo).*(gta|video|gameplay)|gta ?6|gta ?vi/.test(t)) {
    const q = /gta/.test(t) ? 'GTA 6 gameplay' : text;
    TOOLS.scout_videos.run({ query: q, max: n || 2 });
    return `📡 Diego está buscando videos nuevos de "${q}". Los que no hayamos procesado pasan directo a la mesa de Sofía.`;
  }
  if (/(métric|metric|views|vistas|seguidores|likes|stats|estadíst)/.test(t)) {
    const s = analyticsSummary();
    const p = Object.entries(s.platforms).filter(([, v]) => v.last).map(([k, v]) => `${k}: ${v.last.followers ?? '—'} seguidores, ${v.last.views ?? '—'} views`).join(' · ');
    enqueue('analytics', {}, { by: 'chat' });
    return `📈 ${p || 'Aún no hay cuentas conectadas (configúralas en Analytics).'} Producción: ${s.production.clips} clips, ${s.production.stories} datos curiosos, ${s.production.published} publicados.`;
  }
  if (/(estado|qué haces|que haces|cómo va|como va|status)/.test(t)) {
    const st = agentState(agent.id);
    const jobs = db.jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    return `${agent.emoji} Ahora: ${st.task}. ${jobs.length ? `Hay ${jobs.length} trabajos en curso: ${jobs.map((j) => `${j.label} (${j.progress}%)`).join(', ')}.` : 'No hay trabajos en cola.'}`;
  }
  return `${agent.emoji} Soy ${agent.name}, ${agent.role}. Puedo ayudarte con: ${agent.skills.join(', ')}. Pásame un link para hacer clips, pídeme "investiga datos curiosos sobre el espacio", o "busca gameplays nuevos de GTA 6". (Modo básico: agrega tu ANTHROPIC_API_KEY en Ajustes para que pueda conversar de verdad.)`;
}

export async function chat(agentId, text) {
  const agent = agentById[agentId] || agentById.valeria;
  const hist = (db.chats[agent.id] ||= []);
  hist.push({ role: 'user', text, ts: now() });
  const prev = agentState(agent.id);
  const prevState = { status: prev.status, task: prev.task };
  setAgent(agent.id, { status: 'talking', task: 'Hablando contigo' });
  let reply;
  let actions = [];
  try {
    if (llmAvailable()) {
      const history = hist.slice(-16).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
      while (history.length && history[0].role !== 'user') history.shift();
      const r = await chatWithTools({ system: systemPrompt(agent), history, tools: toolsFor(agent) });
      reply = r.text || 'Listo 👍';
      actions = r.actions;
    } else {
      reply = basicReply(agent, text);
    }
  } catch (e) {
    console.error('[chat]', e);
    reply = `Uy, tuve un problema para pensar (${e.message.slice(0, 120)}). Te respondo en modo básico: ${basicReply(agent, text)}`;
  }
  hist.push({ role: 'agent', text: reply, ts: now(), actions });
  if (hist.length > 200) hist.splice(0, hist.length - 200);
  save();
  if (agentState(agent.id).status === 'talking') setAgent(agent.id, prevState.status === 'talking' ? { status: 'idle', task: 'Esperando trabajo' } : prevState);
  return { reply, actions, mode: llmAvailable() ? 'claude' : 'básico' };
}
