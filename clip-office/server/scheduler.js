// Automatizaciones 24/7: el equipo trabaja solo según las reglas que actives.
import { db, uid, now, save, emit } from './db.js';
import { enqueue } from './jobs.js';
import { log } from './agents.js';

export const AUTOMATION_TYPES = {
  scout: { label: 'Cazar videos y hacer clips', agent: 'diego', fields: ['query', 'max', 'clipsPerVideo', 'creativeCommons'] },
  research: { label: 'Investigar y producir datos curiosos', agent: 'lucia', fields: ['query', 'count', 'autoStory'] },
  analytics: { label: 'Actualizar métricas', agent: 'renata', fields: [] },
};

const SEED = [
  { name: 'GTA 6: gameplays nuevos', type: 'scout', intervalMin: 180, enabled: false, params: { query: 'GTA 6 gameplay', max: 2, clipsPerVideo: 3, creativeCommons: false } },
  { name: 'Datos curiosos del día', type: 'research', intervalMin: 720, enabled: true, params: { query: '', count: 5, autoStory: 1 } },
  { name: 'Métricas cada hora', type: 'analytics', intervalMin: 60, enabled: true, params: {} },
];

export function seedAutomations() {
  if (db.automations.length) return;
  db.automations = SEED.map((a) => ({ id: uid('auto_'), ...a, lastRun: null, runs: 0, createdAt: now() }));
  save();
}

export function runAutomation(a, by = 'automatización') {
  a.lastRun = now();
  a.runs = (a.runs || 0) + 1;
  save();
  emit('automation', a);
  const p = a.params || {};
  if (a.type === 'scout') return enqueue('scout', { query: p.query || 'GTA 6 gameplay', max: Number(p.max) || 2, clipsPerVideo: Number(p.clipsPerVideo) || 3, creativeCommons: Boolean(p.creativeCommons) }, { by });
  if (a.type === 'research') return enqueue('research', { query: p.query || '', count: Number(p.count) || 5, autoStory: Number(p.autoStory) || 0 }, { by });
  if (a.type === 'analytics') return enqueue('analytics', {}, { by });
  return null;
}

function tick() {
  const t = Date.now();
  for (const a of db.automations) {
    if (!a.enabled) continue;
    const last = a.lastRun ? new Date(a.lastRun).getTime() : 0;
    if (t - last >= Math.max(5, a.intervalMin) * 60000) {
      // no apila trabajos si el anterior de esta regla sigue pendiente
      const busy = db.jobs.some((j) => j.automationId === a.id && (j.status === 'queued' || j.status === 'running'));
      if (busy) continue;
      const job = runAutomation(a);
      if (job) { job.automationId = a.id; log(AUTOMATION_TYPES[a.type]?.agent || 'valeria', `⏰ Automatización "${a.name}" en marcha`); }
    }
  }
}

export function startScheduler() {
  seedAutomations();
  setTimeout(tick, 15000);
  return setInterval(tick, 60000);
}
