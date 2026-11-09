// Base de datos local en un archivo JSON (escritura atómica con debounce).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = () => ({
  version: 1,
  settings: {
    channelName: 'Mi Canal',
    handle: '@micanal',
    language: 'es',
    voice: 'es-PE-AlexNeural',
    musicMood: 'hype',
    musicVolume: 0.14,
    captionStyle: 'karaoke',
    layout: 'blur',
    clipCount: 5,
    clipSeconds: 35,
    imageSource: 'auto',
    requireCreativeCommons: false,
    watermark: true,
  },
  sources: [],
  clips: [],
  topics: [],
  jobs: [],
  chats: {},
  agentLog: [],
  automations: [],
  analytics: { accounts: { youtube: '', tiktok: '', instagram: '' }, snapshots: [], manual: [] },
  youtubeAuth: null,
});

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const def = DEFAULTS();
    return { ...def, ...raw, settings: { ...def.settings, ...(raw.settings || {}) }, analytics: { ...def.analytics, ...(raw.analytics || {}) } };
  } catch {
    return DEFAULTS();
  }
}

export const db = load();
export const bus = new EventEmitter();
bus.setMaxListeners(100);

let timer = null;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
export function flush() {
  clearTimeout(timer);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

export const uid = (prefix = '') => prefix + crypto.randomBytes(5).toString('hex');
export const now = () => new Date().toISOString();

export function emit(type, payload) {
  bus.emit('event', { type, payload, ts: Date.now() });
}

export function findClip(id) { return db.clips.find((c) => c.id === id); }
export function findSource(id) { return db.sources.find((s) => s.id === id); }
export function findTopic(id) { return db.topics.find((t) => t.id === id); }

export function updateClip(id, patch) {
  const c = findClip(id);
  if (!c) throw new Error(`Clip ${id} no existe`);
  Object.assign(c, patch, { updatedAt: now() });
  save();
  emit('clip', c);
  return c;
}
