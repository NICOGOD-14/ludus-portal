// El equipo de la oficina: identidad, habilidades y estado en vivo de cada agente.
import { db, emit, now, save } from './db.js';

export const AGENTS = [
  {
    id: 'valeria', name: 'Valeria Ríos', role: 'Directora Creativa', emoji: '🎬',
    color: '#C6FF00', hair: '#2b1b12', skin: '#e0ac8a', shirt: '#1f1f1f',
    desk: { x: 0, z: -7.5, rot: 0, boss: true },
    bio: 'Dirige la oficina. Le hablas a ella y reparte el trabajo al equipo. Decide qué clips valen la pena y cuida que todo salga con calidad de canal grande.',
    skills: ['Estrategia de contenido', 'Delegar tareas', 'Control de calidad', 'Calendario de publicación'],
    duties: ['Recibe tus pedidos y los convierte en tareas', 'Revisa cada clip antes de aprobarlo', 'Prioriza lo que más views puede traer'],
    tools: '*',
  },
  {
    id: 'diego', name: 'Diego "Radar" Salas', role: 'Cazador de Tendencias', emoji: '📡',
    color: '#ff3b8d', hair: '#111111', skin: '#c68863', shirt: '#ff3b8d',
    desk: { x: -6, z: -2.5, rot: Math.PI / 2 },
    bio: 'Vive pegado a YouTube y TikTok. Encuentra gameplays nuevos de GTA 6 y videos virales, y los descarga para que el equipo los corte.',
    skills: ['Búsqueda en YouTube', 'Detección de virales', 'Descarga de video (yt-dlp)', 'Filtro Creative Commons'],
    duties: ['Busca videos nuevos según tus automatizaciones', 'Descarga la fuente y sus subtítulos', 'Evita repetir videos ya procesados'],
    tools: ['create_clips_from_url', 'scout_videos', 'set_automation', 'get_status'],
  },
  {
    id: 'lucia', name: 'Lucía Paredes', role: 'Investigadora', emoji: '🔎',
    color: '#4dd6ff', hair: '#6b3a1e', skin: '#f1c7a5', shirt: '#2a6f97',
    desk: { x: -6, z: 1.5, rot: Math.PI / 2 },
    bio: 'Busca datos curiosos verificables que enganchan: historia, ciencia, espacio, animales, misterios. Siempre guarda la fuente.',
    skills: ['Investigación web', 'Verificación de datos', 'Wikipedia y fuentes abiertas', 'Detección de temas virales'],
    duties: ['Arma listas de temas con potencial viral', 'Resume cada tema con su fuente', 'Propone ángulos para el guion'],
    tools: ['research_topics', 'create_story', 'get_status'],
  },
  {
    id: 'mateo', name: 'Mateo Quispe', role: 'Guionista y Hooks', emoji: '✍️',
    color: '#ffb000', hair: '#0d0d0d', skin: '#b97a56', shirt: '#ffb000',
    desk: { x: -2, z: -2.5, rot: 0 },
    bio: 'Escribe la frase de los primeros 2 segundos que hace que la gente NO deslice. Títulos, guiones y llamadas a la acción.',
    skills: ['Hooks de 2 segundos', 'Guiones de 30–60 s', 'Títulos con curiosidad', 'Storytelling estilo novela IA'],
    duties: ['Escribe el hook de cada clip', 'Redacta los guiones de datos curiosos', 'Propone 3 variantes de título'],
    tools: ['create_story', 'update_clip', 'list_clips', 'get_status'],
  },
  {
    id: 'sofia', name: 'Sofía Valdivia', role: 'Editora de Video', emoji: '✂️',
    color: '#9b5cff', hair: '#3a1f5c', skin: '#e8b996', shirt: '#9b5cff',
    desk: { x: 2, z: -2.5, rot: 0 },
    bio: 'Corta los mejores momentos, los pasa a vertical 9:16, sube el ritmo y exporta en calidad para Shorts, Reels y TikTok.',
    skills: ['Detección de momentos épicos', 'Reencuadre vertical 9:16', 'Ritmo y cortes', 'Render FFmpeg 1080×1920'],
    duties: ['Elige los mejores segmentos', 'Renderiza cada clip', 'Aplica tus correcciones del Estudio'],
    tools: ['create_clips_from_url', 'render_clip', 'update_clip', 'list_clips', 'get_status'],
  },
  {
    id: 'bruno', name: 'Bruno Takahashi', role: 'Subtítulos y Transcripción', emoji: '💬',
    color: '#00e5a8', hair: '#1a1a1a', skin: '#f0c9a0', shirt: '#00a37a',
    desk: { x: 6, z: -2.5, rot: -Math.PI / 2 },
    bio: 'Transcribe el audio y pone subtítulos grandes palabra por palabra (estilo karaoke), que retienen muchísimo más.',
    skills: ['Transcripción', 'Subtítulos karaoke', 'Corrección de texto', 'Sincronía palabra a palabra'],
    duties: ['Saca la transcripción de cada fuente', 'Genera subtítulos animados', 'Corrige errores que le marques'],
    tools: ['update_clip', 'list_clips', 'get_status'],
  },
  {
    id: 'camila', name: 'Camila Torres', role: 'Directora de Arte', emoji: '🎨',
    color: '#ff6b3d', hair: '#a8432a', skin: '#f3cfb3', shirt: '#ff6b3d',
    desk: { x: 6, z: 1.5, rot: -Math.PI / 2 },
    bio: 'Consigue imágenes libres de derechos y genera ilustraciones con IA para los videos de datos curiosos. También cuida las miniaturas.',
    skills: ['Ilustraciones con IA', 'Imágenes libres (Wikimedia, Pexels)', 'Miniaturas', 'Estética de marca'],
    duties: ['Busca o genera una imagen por escena', 'Mantiene el estilo visual del canal', 'Crea la portada de cada video'],
    tools: ['create_story', 'list_clips', 'get_status'],
  },
  {
    id: 'nico', name: 'Nico Fernández', role: 'Voz y Música', emoji: '🎧',
    color: '#ffd23f', hair: '#4a3020', skin: '#d9a07a', shirt: '#3d3d3d',
    desk: { x: -2, z: 1.5, rot: Math.PI },
    bio: 'Pone la voz en off (voz neural gratis o TU propia voz grabada) y música 100% libre de derechos compuesta aquí mismo.',
    skills: ['Voz neural en español', 'Grabación de tu voz', 'Música original sin copyright', 'Mezcla y volumen (-14 LUFS)'],
    duties: ['Narra los guiones', 'Elige la música según el mood', 'Deja el audio listo para cada plataforma'],
    tools: ['list_clips', 'get_status'],
  },
  {
    id: 'andres', name: 'Andrés Castillo', role: 'Community y Publicación', emoji: '🚀',
    color: '#ff2e2e', hair: '#222222', skin: '#c99272', shirt: '#b81d1d',
    desk: { x: 2, z: 1.5, rot: Math.PI },
    bio: 'Escribe descripciones y hashtags, decide la mejor hora para subir y publica en YouTube. Prepara los paquetes para TikTok e Instagram.',
    skills: ['SEO para Shorts', 'Hashtags', 'Mejores horarios', 'Subida a YouTube'],
    duties: ['Prepara descripción y hashtags', 'Publica en YouTube cuando apruebas', 'Arma el paquete para Reels y TikTok'],
    tools: ['update_clip', 'publish_clip', 'list_clips', 'get_status'],
  },
  {
    id: 'renata', name: 'Renata Vega', role: 'Analista de Datos', emoji: '📈',
    color: '#3dffb5', hair: '#111111', skin: '#e5b48f', shirt: '#145c4a',
    desk: { x: -3.2, z: 5.6, rot: Math.PI },
    bio: 'Mide views, likes y seguidores en cada red y te dice qué formato está funcionando para hacer más de eso.',
    skills: ['Métricas de YouTube', 'Métricas de TikTok e Instagram', 'Crecimiento diario', 'Recomendaciones basadas en datos'],
    duties: ['Actualiza las estadísticas cada hora', 'Detecta qué clips despegan', 'Te da un reporte cuando se lo pidas'],
    tools: ['refresh_analytics', 'get_status'],
  },
  {
    id: 'tomas', name: 'Tomás León', role: 'Copyright y Monetización', emoji: '⚖️',
    color: '#c0c0ff', hair: '#5a5a5a', skin: '#efc4a4', shirt: '#33335c',
    desk: { x: 3.2, z: 5.6, rot: Math.PI },
    bio: 'Protege tu monetización: revisa licencias, música, créditos y que cada clip aporte valor propio (no "contenido reutilizado").',
    skills: ['Políticas de monetización de YouTube', 'Licencias y créditos', 'Content ID', 'Contenido transformativo'],
    duties: ['Revisa cada clip antes de publicar', 'Marca riesgos de copyright', 'Te sugiere cómo hacerlo más original'],
    tools: ['list_clips', 'get_status'],
  },
];

export const agentById = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

/** Estado en vivo (en memoria + último estado guardado). */
const state = Object.fromEntries(AGENTS.map((a) => [a.id, { status: 'idle', task: 'Esperando trabajo', progress: 0, updatedAt: now() }]));

export function agentState(id) { return state[id]; }
export function allAgents() {
  return AGENTS.map((a) => ({ ...a, state: state[a.id] }));
}

export function setAgent(id, patch) {
  if (!state[id]) return;
  Object.assign(state[id], patch, { updatedAt: now() });
  emit('agent', { id, state: state[id] });
}

export function agentWork(id, task, progress = 0) { setAgent(id, { status: 'working', task, progress }); log(id, task); }
export function agentDone(id, task = 'Esperando trabajo') { setAgent(id, { status: 'idle', task, progress: 0 }); }
export function agentError(id, msg) { setAgent(id, { status: 'error', task: msg, progress: 0 }); log(id, `⚠️ ${msg}`); }

export function log(agentId, text) {
  const entry = { agentId, text, ts: now() };
  db.agentLog.push(entry);
  if (db.agentLog.length > 400) db.agentLog.splice(0, db.agentLog.length - 400);
  save();
  emit('log', entry);
}
