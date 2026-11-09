// Estado compartido, API y utilidades de la interfaz.
export const store = { state: null, listeners: new Set(), selectedClip: null };

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.raw ? opts.headers : { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.raw ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || data || `Error ${res.status}`);
  return data;
}

export function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), err ? 7000 : 4000);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = (n) => (n == null ? '—' : Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
export const tsec = (s) => { s = Math.max(0, Number(s) || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
export const ago = (iso) => { const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return 'ahora'; if (d < 3600) return `${Math.floor(d / 60)} min`; if (d < 86400) return `${Math.floor(d / 3600)} h`; return `${Math.floor(d / 86400)} d`; };
export const agentOf = (id) => store.state?.agents.find((a) => a.id === id);

export function on(fn) { store.listeners.add(fn); return () => store.listeners.delete(fn); }
export function notify(ev) { store.listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error(e); } }); }

export async function reload() {
  store.state = await api('/api/state');
  notify({ type: 'reload' });
}

/** Aplica eventos SSE al estado local. */
export function applyEvent(ev) {
  const s = store.state;
  if (!s) return;
  const p = ev.payload;
  const upsert = (arr, item) => { const i = arr.findIndex((x) => x.id === item.id); if (i >= 0) arr[i] = { ...arr[i], ...item }; else arr.push(item); };
  switch (ev.type) {
    case 'agent': { const a = s.agents.find((x) => x.id === p.id); if (a) a.state = p.state; break; }
    case 'job': upsert(s.jobs, p); break;
    case 'clip': upsert(s.clips, p); break;
    case 'clip_deleted': s.clips = s.clips.filter((c) => c.id !== p.id); break;
    case 'topic': upsert(s.topics, p); break;
    case 'automation': upsert(s.automations, p); break;
    case 'source': upsert(s.sources, p); break;
    case 'log': s.agentLog.push(p); if (s.agentLog.length > 120) s.agentLog.shift(); break;
    case 'analytics': s.analytics = p; break;
    case 'settings': s.settings = p; break;
    case 'options': Object.assign(s.options, p); break;
    default: break;
  }
  notify(ev);
}

export function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = (m) => { try { applyEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  es.onerror = () => { es.close(); setTimeout(() => { reload().catch(() => {}); connectEvents(); }, 3000); };
}

export function badge(status) {
  const map = { draft: 'borrador', rendering: 'renderizando', ready: 'listo', approved: 'aprobado', published: 'publicado', error: 'error' };
  return `<span class="badge ${status}">${map[status] || status}</span>`;
}

export function go(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${tab}`));
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  notify({ type: 'tab', payload: tab });
}
