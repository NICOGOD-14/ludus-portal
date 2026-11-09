// Arranque de la app + la Oficina 3D + chat con agentes.
import { store, api, toast, $, $$, esc, ago, agentOf, on, reload, connectEvents, go, fmt } from './core.js';
import { initStudio } from './studio.js';
import { initPages } from './pages.js';

let office = null;
let current = null; // agente abierto
let recog = null;

async function boot() {
  try { await reload(); } catch (e) { document.body.innerHTML = `<div class="empty">No pude conectar con el servidor: ${esc(e.message)}</div>`; return; }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
  initStudio();
  initPages();
  initOfficeUI();
  connectEvents();
  const tab = location.hash.slice(1);
  if (tab && document.getElementById(`tab-${tab}`)) go(tab);
  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (t && document.getElementById(`tab-${t}`)) go(t); });
  renderTop();
  $('#link-pill').addEventListener('click', async () => { try { await navigator.clipboard.writeText(store.state.capabilities.publicUrl); toast('🌐 Link copiado. Ábrelo desde tu celular.'); } catch { prompt('Tu link público:', store.state.capabilities.publicUrl); } });
  on((ev) => {
    if (['job', 'reload', 'analytics', 'clip', 'public_url'].includes(ev.type)) { renderTop(); updateKpi(); }
    if (ev.type === 'agent' || ev.type === 'reload') { renderTeam(); if (ev.type === 'agent') office?.updateAgent(ev.payload.id, ev.payload.state); if (current && ev.payload?.id === current) renderAgentHead(); }
    if (ev.type === 'log' || ev.type === 'reload') renderActivity();
    if (ev.type === 'log' && ev.payload.agentId === 'valeria' && /terminamos|falló/.test(ev.payload.text)) toast(ev.payload.text, /falló/.test(ev.payload.text));
    if (ev.type === 'job' && current && $('#ap-work:not(.hidden)')) renderWork();
  });
}

function renderTop() {
  const s = store.state;
  const pill = $('#mode-pill');
  pill.textContent = s.capabilities.llm ? '🧠 Claude activo' : '⚙️ modo básico';
  pill.classList.toggle('warn', !s.capabilities.llm);
  pill.title = s.capabilities.llm ? `Modelo: ${s.capabilities.model}` : 'Agrega ANTHROPIC_API_KEY en Ajustes para que los agentes piensen con Claude';
  const lp = $('#link-pill');
  lp.classList.toggle('hidden', !s.capabilities.publicUrl);
  lp.title = s.capabilities.publicUrl ? `Copiar: ${s.capabilities.publicUrl}` : '';
  const active = s.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  $('#jobs-pill').textContent = `${active} trabajo${active === 1 ? '' : 's'} activo${active === 1 ? '' : 's'}`;
}

function updateKpi() {
  if (!office) return;
  const s = store.state;
  const p = s.analytics.production;
  const plats = Object.values(s.analytics.platforms).map((x) => x.last).filter(Boolean);
  const sum = (k) => (plats.some((x) => x[k] != null) ? fmt(plats.reduce((a, x) => a + (x[k] || 0), 0)) : '—');
  office.drawKpi({ ...p, jobs: s.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length, followers: sum('followers'), views: sum('views'), likes: sum('likes') });
}

// ---------- Oficina ----------
async function initOfficeUI() {
  renderTeam();
  renderActivity();
  try {
    office = await import('./office3d.js');
    office.initOffice($('#office-3d'), store.state.agents, { onSelect: openAgent });
    updateKpi();
    setInterval(updateKpi, 60000);
  } catch (e) {
    console.error(e);
    $('#office-3d').innerHTML = `<div class="empty">Tu navegador no pudo cargar la vista 3D (${esc(e.message)}). Puedes usar la lista del equipo.</div>`;
  }
  $('#btn-overview').addEventListener('click', closeAgent);
  $('#agent-close').addEventListener('click', closeAgent);
  $$('.agent-tabs button').forEach((b) => b.addEventListener('click', () => apTab(b.dataset.ap)));
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); sendChat(); });
  $('#quick-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('#quick-input').value.trim();
    if (!text) return;
    $('#quick-input').value = '';
    openAgent('valeria');
    await sendChat(text);
  });
  setupMic();
}

function renderTeam() {
  const el = $('#team-list');
  if (!el) return;
  el.innerHTML = '<div class="hud-title">El equipo (clic para ir a su escritorio)</div>' + store.state.agents.map((a) => `
    <div class="team-row" data-id="${a.id}">
      <span class="dot ${a.state.status}"></span><span class="em">${a.emoji}</span>
      <div style="min-width:0"><div class="nm">${esc(a.name)}</div><div class="tk">${esc(a.role)} · ${esc(a.state.task)}</div></div>
    </div>`).join('');
  $$('.team-row', el).forEach((r) => r.addEventListener('click', () => openAgent(r.dataset.id)));
}

function renderActivity() {
  const el = $('#activity');
  if (!el) return;
  el.innerHTML = store.state.agentLog.slice(-40).reverse().map((l) => {
    const a = agentOf(l.agentId);
    return `<div class="act"><time>${ago(l.ts)}</time><b>${a ? a.emoji + ' ' + esc(a.name.split(' ')[0]) : ''}</b> ${esc(l.text)}</div>`;
  }).join('') || '<div class="tiny">Aún no hay actividad. Pásale un link a Valeria para empezar 🚀</div>';
}

function openAgent(id) {
  current = id;
  go('office');
  $('#agent-panel').classList.remove('hidden');
  $('#btn-overview').classList.remove('hidden');
  office?.focusAgent(id);
  renderAgentHead();
  renderProfile();
  apTab('chat');
  loadChat();
}

function closeAgent() {
  current = null;
  $('#agent-panel').classList.add('hidden');
  $('#btn-overview').classList.add('hidden');
  office?.overview();
}

function apTab(name) {
  $$('.agent-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.ap === name));
  ['chat', 'profile', 'work'].forEach((n) => $(`#ap-${n}`).classList.toggle('hidden', n !== name));
  if (name === 'work') renderWork();
  if (name === 'chat') setTimeout(() => $('#chat-input').focus(), 50);
}

function renderAgentHead() {
  const a = agentOf(current);
  if (!a) return;
  $('#ap-avatar').textContent = a.emoji;
  $('#ap-avatar').style.background = a.color + '22';
  $('#ap-avatar').style.border = `1px solid ${a.color}`;
  $('#ap-name').textContent = a.name;
  $('#ap-role').textContent = a.role;
  const st = { idle: 'En espera', working: 'Trabajando', talking: 'Hablando contigo', error: 'Necesita atención' }[a.state.status] || a.state.status;
  $('#ap-status').innerHTML = `<span class="dot ${a.state.status}"></span> ${st} — ${esc(a.state.task)}${a.state.status === 'working' ? ` (${a.state.progress || 0}%)` : ''}`;
}

const SUGGEST = {
  valeria: ['¿Qué está haciendo el equipo?', 'Haz 5 clips de este link: ', 'Activa la búsqueda automática de GTA 6', 'Dame ideas para crecer el canal'],
  diego: ['Busca gameplays nuevos de GTA 6', 'Solo videos Creative Commons de GTA 6', '¿Qué videos procesaste hoy?'],
  lucia: ['Investiga datos curiosos sobre el espacio', 'Investiga misterios del Perú y haz un video', '5 datos de animales raros'],
  mateo: ['Escribe 3 hooks mejores para mi último clip', 'Haz un video del mejor tema investigado', '¿Qué hace un buen hook?'],
  sofia: ['¿Qué clips están listos?', 'Vuelve a renderizar el último clip', 'Hazlo con zoom y sin música'],
  bruno: ['Cambia los subtítulos del último clip a estilo caja', '¿Qué clips no tienen subtítulos?'],
  camila: ['¿Qué estilo de imágenes usamos?', 'Haz un video de un dato curioso con renders'],
  nico: ['¿Qué música es libre de derechos?', '¿Puedo usar mi voz?'],
  andres: ['Publica en YouTube el último clip como privado', '¿Cuál es la mejor hora para subir?', 'Mejora la descripción del último clip'],
  renata: ['¿Cómo van mis métricas?', 'Actualiza las estadísticas', '¿Qué formato está funcionando mejor?'],
  tomas: ['¿Puedo monetizar clips de gameplays de otros?', 'Revisa los riesgos de mis clips', '¿Cómo evito el contenido reutilizado?'],
};

function renderProfile() {
  const a = agentOf(current);
  $('#ap-profile').innerHTML = `
    <div class="profile-sec"><p>${esc(a.bio)}</p></div>
    <div class="profile-sec"><h4>Habilidades</h4><div class="chips">${a.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div></div>
    <div class="profile-sec"><h4>Qué hace</h4><ul>${a.duties.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>
    <div class="profile-sec"><h4>Herramientas que puede usar</h4><div class="chips">${(a.tools === '*' ? ['todas'] : a.tools).map((t) => `<span class="chip" style="font-family:var(--mono)">${esc(t)}</span>`).join('')}</div></div>
    <div class="profile-sec"><h4>Pídele algo</h4><div class="chips">${(SUGGEST[a.id] || []).map((s) => `<span class="chip btnchip">${esc(s)}</span>`).join('')}</div></div>`;
  $$('#ap-profile .btnchip').forEach((c) => c.addEventListener('click', () => { apTab('chat'); $('#chat-input').value = c.textContent; $('#chat-input').focus(); }));
}

function renderWork() {
  const a = agentOf(current);
  const logs = store.state.agentLog.filter((l) => l.agentId === current).slice(-25).reverse();
  const jobs = store.state.jobs.filter((j) => j.agent === current || (j.log || []).some((l) => l.agentId === current)).slice(-8).reverse();
  $('#ap-work').innerHTML = `
    <div class="profile-sec"><h4>Ahora mismo</h4><p>${esc(a.state.task)}</p>${a.state.status === 'working' ? `<div class="progress"><div style="width:${a.state.progress || 0}%"></div></div>` : ''}</div>
    <div class="profile-sec"><h4>Trabajos en los que participó</h4>${jobs.map((j) => `<div class="job"><div>${esc(j.label)}<div class="tiny">${esc(j.step)}</div></div><div class="progress"><div style="width:${j.progress}%"></div></div><span class="tiny">${j.status}</span></div>`).join('') || '<div class="tiny">Ninguno todavía.</div>'}</div>
    <div class="profile-sec"><h4>Bitácora</h4>${logs.map((l) => `<div class="act"><time>${ago(l.ts)}</time> ${esc(l.text)}</div>`).join('') || '<div class="tiny">Sin registros.</div>'}</div>`;
}

async function loadChat() {
  const log = $('#chat-log');
  const a = agentOf(current);
  const msgs = await api(`/api/chat/${current}`);
  log.innerHTML = '';
  if (!msgs.length) addMsg('agent', `¡Hola! Soy ${a.name.split(' ')[0]} ${a.emoji}, ${a.role.toLowerCase()}. ${a.bio}`);
  msgs.forEach((m) => addMsg(m.role, m.text, m.actions));
}

function addMsg(role, text, actions) {
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  if (actions?.length) {
    const acts = document.createElement('div');
    acts.className = 'acts';
    acts.innerHTML = actions.map((x) => `<span>${x.ok ? '✓' : '✗'} ${esc(x.tool)}</span>`).join('');
    el.appendChild(acts);
  }
  $('#chat-log').appendChild(el);
  $('#chat-log').scrollTop = 1e9;
  return el;
}

async function sendChat(preset) {
  const input = $('#chat-input');
  const text = (preset ?? input.value).trim();
  if (!text || !current) return;
  input.value = '';
  addMsg('user', text);
  const who = current;
  const typing = addMsg('agent typing', `${agentOf(who).name.split(' ')[0]} está escribiendo…`);
  try {
    const r = await api(`/api/chat/${who}`, { body: { text } });
    typing.remove();
    if (current === who) addMsg('agent', r.reply, r.actions);
    if ($('#speak-replies').checked) speak(r.reply);
  } catch (e) {
    typing.remove();
    addMsg('agent', `⚠️ ${e.message}`);
  }
}

// ---------- voz ----------
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[\p{Extended_Pictographic}]/gu, ''));
  u.lang = 'es-419';
  const v = speechSynthesis.getVoices().find((x) => /^es/.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#mic');
  if (!SR) { btn.title = 'Tu navegador no soporta dictado por voz (usa Chrome o Edge)'; btn.disabled = true; return; }
  btn.addEventListener('click', () => {
    if (recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = 'es-PE';
    recog.interimResults = true;
    recog.onresult = (e) => { $('#chat-input').value = [...e.results].map((r) => r[0].transcript).join(' '); };
    recog.onend = () => { btn.classList.remove('rec'); recog = null; if ($('#chat-input').value.trim()) sendChat(); };
    recog.onerror = (e) => toast(`Micrófono: ${e.error}`, true);
    btn.classList.add('rec');
    recog.start();
  });
}

boot();
