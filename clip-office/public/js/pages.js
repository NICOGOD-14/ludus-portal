// Páginas: Datos Curiosos, Automatización, Analytics y Ajustes.
import { store, api, toast, $, $$, esc, on, fmt, ago, agentOf, go, reload } from './core.js';
import { openClip } from './studio.js';

export function initPages() {
  initStories();
  initAuto();
  renderAnalytics();
  renderSettings();
  on((ev) => {
    if (['topic', 'reload', 'clip'].includes(ev.type)) renderTopics();
    if (['automation', 'reload', 'job'].includes(ev.type)) { renderAutos(); renderJobs(); }
    if (['analytics', 'reload'].includes(ev.type)) renderAnalytics();
    if (ev.type === 'tab' && ev.payload === 'settings') renderSettings();
    if (ev.type === 'tab' && ev.payload === 'analytics') renderAnalytics();
  });
}

// ---------- Datos curiosos ----------
function initStories() {
  $('#research-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/jobs', { body: { type: 'research', payload: { query: f.get('query'), count: Number(f.get('count')) } } });
      toast('🔎 Lucía está investigando…');
    } catch (err) { toast(err.message, true); }
  });
  $('#chat-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/jobs', { body: { type: 'chat', payload: { premise: f.get('premise'), tone: f.get('tone'), theme: f.get('theme'), voices: f.get('voices') === 'on' } } });
      e.target.premise.value = '';
      toast('💬 Mateo está escribiendo la historia; aparecerá en el Estudio.');
    } catch (err) { toast(err.message, true); }
  });
  $('#topic-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api('/api/topics', { body: f }); e.target.reset(); toast('Tema guardado'); } catch (err) { toast(err.message, true); }
  });
  renderTopics();
}

function renderTopics() {
  const topics = store.state.topics.slice().reverse();
  const storyBy = Object.fromEntries(store.state.clips.filter((c) => c.kind === 'story').map((c) => [c.topicId, c]));
  $('#topic-list').innerHTML = topics.map((t) => {
    const st = storyBy[t.id];
    return `
    <div class="card topic">
      <div class="row" style="justify-content:space-between"><span class="chip">${esc(t.category)}</span><span class="score">🔥 ${t.viralScore}</span></div>
      <h4>${esc(t.title)}</h4>
      <p>${esc(t.summary)}</p>
      ${t.angle ? `<div class="tiny">💡 ${esc(t.angle)}</div>` : ''}
      <div class="tiny">${t.source ? `<a href="${esc(t.source)}" target="_blank" rel="noopener">Fuente</a> · ` : ''}${esc(t.method || '')} · ${ago(t.createdAt)}</div>
      <div class="row wrap">
        ${st ? `<button class="btn small" data-open="${st.id}">🎬 Ver video (${esc(st.status)})</button>` : `<select data-tone="${t.id}"><option value="misterio">Misterio</option><option value="épico">Épico</option><option value="divertido">Divertido</option><option value="informativo">Informativo</option></select><button class="btn small primary" data-make="${t.id}">🎬 Crear video</button>`}
        <button class="btn small danger" data-del="${t.id}">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<div class="tiny">Sin temas aún. Pídele a Lucía que investigue algo arriba ☝️</div>';
  $$('[data-make]').forEach((b) => b.addEventListener('click', async () => {
    try { await api(`/api/topics/${b.dataset.make}/story`, { body: { tone: $(`[data-tone="${b.dataset.make}"]`).value } }); toast('🎬 Mateo escribe el guion, Camila crea las imágenes y Nico pone la voz.'); b.disabled = true; } catch (e) { toast(e.message, true); }
  }));
  $$('[data-open]').forEach((b) => b.addEventListener('click', () => { go('studio'); openClip(b.dataset.open); }));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api(`/api/topics/${b.dataset.del}`, { method: 'DELETE' }); store.state.topics = store.state.topics.filter((t) => t.id !== b.dataset.del); renderTopics(); }));
}

// ---------- Automatización ----------
function initAuto() {
  $('#auto-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const params = f.type === 'scout' ? { query: f.query || 'GTA 6 gameplay', max: 2, clipsPerVideo: 3 } : f.type === 'research' ? { query: f.query, count: 5, autoStory: 1 } : f.type === 'chat' ? { query: f.query, theme: 'oscuro' } : {};
    try {
      const a = await api('/api/automations', { body: { type: f.type, name: f.name || undefined, intervalMin: Number(f.intervalMin), params } });
      store.state.automations.push(a);
      renderAutos();
      e.target.reset();
      toast('Regla creada ✓');
    } catch (err) { toast(err.message, true); }
  });
  renderAutos();
  renderJobs();
}

function renderAutos() {
  const types = store.state.automationTypes;
  $('#auto-list').innerHTML = store.state.automations.map((a) => {
    const ag = agentOf(types[a.type]?.agent);
    const p = a.params || {};
    return `
    <div class="card auto-item">
      <button class="switch ${a.enabled ? 'on' : ''}" data-toggle="${a.id}" aria-label="Activar"></button>
      <div>
        <div><b>${esc(a.name)}</b> <span class="tiny">· ${ag ? `${ag.emoji} ${esc(ag.name.split(' ')[0])}` : ''} · cada ${a.intervalMin} min · ${a.runs || 0} ejecuciones${a.lastRun ? ` · última hace ${ago(a.lastRun)}` : ''}</span></div>
        <div class="row wrap" style="margin-top:8px">
          ${a.type !== 'analytics' ? `<input data-q="${a.id}" value="${esc(p.query || '')}" placeholder="${a.type === 'scout' ? 'Búsqueda' : a.type === 'chat' ? 'Idea (vacío = sorpresa)' : 'Tema (vacío = variado)'}" style="width:220px">` : ''}
          ${a.type === 'scout' ? `<label>Videos <input type="number" data-max="${a.id}" value="${p.max || 2}" min="1" max="5"></label><label>Clips c/u <input type="number" data-cpv="${a.id}" value="${p.clipsPerVideo || 3}" min="1" max="8"></label><label><input type="checkbox" data-cc="${a.id}" ${p.creativeCommons ? 'checked' : ''}> Solo Creative Commons</label>` : ''}
          ${a.type === 'chat' ? `<select data-theme="${a.id}">${Object.entries(store.state.options.chatThemes || {}).map(([k, v]) => `<option value="${k}" ${p.theme === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><label><input type="checkbox" data-voices="${a.id}" ${p.voices ? 'checked' : ''}> Voces</label>` : ''}
          ${a.type === 'research' ? `<label>Temas <input type="number" data-count="${a.id}" value="${p.count || 5}" min="1" max="10"></label><label>Videos auto <input type="number" data-auto="${a.id}" value="${p.autoStory ?? 1}" min="0" max="5"></label>` : ''}
          <label>Cada <input type="number" data-int="${a.id}" value="${a.intervalMin}" min="15"> min</label>
          <button class="btn small" data-savea="${a.id}">Guardar</button>
        </div>
      </div>
      <div class="row"><button class="btn small primary" data-run="${a.id}">▶ Ejecutar ya</button><button class="btn small danger" data-dela="${a.id}">🗑️</button></div>
    </div>`;
  }).join('');
  const patch = async (id, body) => { const a = await api(`/api/automations/${id}`, { method: 'PATCH', body }); Object.assign(store.state.automations.find((x) => x.id === id), a); renderAutos(); };
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => { const a = store.state.automations.find((x) => x.id === b.dataset.toggle); patch(a.id, { enabled: !a.enabled }).then(() => toast(a.enabled ? '⏰ Activada' : 'Pausada')); }));
  $$('[data-savea]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.savea;
    const a = store.state.automations.find((x) => x.id === id);
    const params = { ...(a.params || {}) };
    const v = (sel) => $(`[${sel}="${id}"]`);
    if (v('data-q')) params.query = v('data-q').value;
    if (v('data-max')) params.max = Number(v('data-max').value);
    if (v('data-cpv')) params.clipsPerVideo = Number(v('data-cpv').value);
    if (v('data-cc')) params.creativeCommons = v('data-cc').checked;
    if (v('data-count')) params.count = Number(v('data-count').value);
    if (v('data-theme')) params.theme = v('data-theme').value;
    if (v('data-voices')) params.voices = v('data-voices').checked;
    if (v('data-auto')) params.autoStory = Number(v('data-auto').value);
    patch(id, { params, intervalMin: Number(v('data-int').value) }).then(() => toast('Guardado ✓')).catch((e) => toast(e.message, true));
  }));
  $$('[data-run]').forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/automations/${b.dataset.run}/run`, { body: {} }); toast('▶ En marcha'); } catch (e) { toast(e.message, true); } }));
  $$('[data-dela]').forEach((b) => b.addEventListener('click', async () => { if (!confirm('¿Eliminar esta regla?')) return; await api(`/api/automations/${b.dataset.dela}`, { method: 'DELETE' }); store.state.automations = store.state.automations.filter((a) => a.id !== b.dataset.dela); renderAutos(); }));
}

function renderJobs() {
  const el = $('#job-list');
  if (!el) return;
  el.innerHTML = store.state.jobs.slice().reverse().slice(0, 40).map((j) => {
    const ag = agentOf(j.agent);
    return `<div class="job">
      <div><b>${esc(j.label)}</b> <span class="tiny">· ${esc(j.by || '')} · ${ago(j.createdAt)}</span><div class="tiny">${ag ? ag.emoji + ' ' : ''}${esc(j.step)}</div>${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}</div>
      <div class="progress"><div style="width:${j.status === 'done' ? 100 : j.progress}%;${j.status === 'error' ? 'background:var(--red)' : ''}"></div></div>
      <div class="row">${j.status === 'error' ? `<button class="btn small" data-retry="${j.id}">↻ Reintentar</button>` : ''}${j.status === 'queued' ? `<button class="btn small" data-cancel="${j.id}">Cancelar</button>` : ''}<span class="tiny">${{ queued: 'en cola', running: 'trabajando', done: 'listo', error: 'error', cancelled: 'cancelado' }[j.status]}</span></div>
    </div>`;
  }).join('') || '<div class="tiny">Sin trabajos.</div>';
  $$('[data-retry]', el).forEach((b) => b.addEventListener('click', () => api(`/api/jobs/${b.dataset.retry}/retry`, { body: {} }).then(() => toast('Reintentando…')).catch((e) => toast(e.message, true))));
  $$('[data-cancel]', el).forEach((b) => b.addEventListener('click', () => api(`/api/jobs/${b.dataset.cancel}`, { method: 'DELETE' })));
}

// ---------- Analytics ----------
const PLAT = { youtube: { name: 'YouTube', icon: '▶️', color: '#ff3b3b' }, tiktok: { name: 'TikTok', icon: '🎵', color: '#25f4ee' }, instagram: { name: 'Instagram', icon: '📸', color: '#ff3d9a' } };

function lineChart(series, key, color) {
  const pts = series.filter((s) => s[key] != null);
  if (pts.length < 2) return `<div class="tiny" style="padding:30px 0;text-align:center">Se necesitan al menos 2 mediciones para dibujar la curva.</div>`;
  const W = 600, H = 200, P = 28;
  const xs = pts.map((p) => new Date(p.ts).getTime());
  const ys = pts.map((p) => p[key]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => P + ((x - x0) / Math.max(1, x1 - x0)) * (W - P * 2);
  const Y = (y) => H - P - ((y - y0) / Math.max(1, y1 - y0)) * (H - P * 2);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d} L${X(x1)},${H - P} L${X(x0)},${H - P} Z" fill="${color}22"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
    <text x="${P}" y="14" fill="#888" font-size="11">${fmt(y1)}</text><text x="${P}" y="${H - 8}" fill="#888" font-size="11">${fmt(y0)}</text>
  </svg>`;
}

function renderAnalytics() {
  const s = store.state;
  const a = s.analytics;
  const caps = s.capabilities;
  const el = $('#analytics');
  if (!el) return;
  const kpi = (p) => {
    const d = a.platforms[p];
    const last = d.last;
    const delta = d.delta24h;
    return `<div class="card kpi">
      <div class="plat"><span>${PLAT[p].icon} ${PLAT[p].name}</span><span class="tiny">${last ? ago(last.ts) : 'sin datos'}</span></div>
      <div class="big">${fmt(last?.followers)}</div><div class="tiny">seguidores</div>
      ${delta ? `<div class="delta ${delta.followers < 0 ? 'neg' : ''}">${delta.followers >= 0 ? '+' : ''}${fmt(delta.followers)} seguidores · ${delta.views >= 0 ? '+' : ''}${fmt(delta.views)} views (24 h)</div>` : ''}
      <div class="sub"><span>👁️ ${fmt(last?.views)} views</span><span>❤️ ${fmt(last?.likes)}</span><span>🎬 ${fmt(last?.posts)}</span></div>
    </div>`;
  };
  el.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2>📈 Renata: crecimiento del canal</h2><button class="btn primary" id="an-refresh">↻ Actualizar ahora</button></div>
    <div class="tiny">${a.lastRefresh ? `Última actualización: ${ago(a.lastRefresh)}` : 'Aún no se han leído métricas.'} ${a.lastErrors?.length ? `<span class="bad">· ${esc(a.lastErrors.join(' | '))}</span>` : ''}</div>
    <div class="kpis">${['youtube', 'tiktok', 'instagram'].map(kpi).join('')}
      <div class="card kpi"><div class="plat"><span>🏭 Producción de la oficina</span></div><div class="big">${a.production.clips + a.production.stories}</div><div class="tiny">videos creados</div><div class="sub"><span>🎮 ${a.production.clips} clips</span><span>🔎 ${a.production.stories} datos</span><span>✅ ${a.production.ready} listos</span><span>🚀 ${a.production.published} publicados</span></div></div>
    </div>
    <div class="kpis">${['youtube', 'tiktok', 'instagram'].map((p) => `<div class="card"><h3>${PLAT[p].icon} Seguidores en ${PLAT[p].name}</h3>${lineChart(a.platforms[p].series, 'followers', PLAT[p].color)}</div>`).join('')}</div>
    ${a.youtubeVideos?.length ? `<div class="card"><h3>▶️ Últimos videos de YouTube</h3><table><tr><th>Video</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comentarios</th><th>Publicado</th></tr>${a.youtubeVideos.map((v) => `<tr><td><a href="https://youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">${esc(v.title)}</a></td><td class="num">${fmt(v.views)}</td><td class="num">${fmt(v.likes)}</td><td class="num">${fmt(v.comments)}</td><td class="tiny">${ago(v.publishedAt)}</td></tr>`).join('')}</table></div>` : ''}
    <div class="card">
      <h3>🔌 Conectar cuentas</h3>
      <div class="stack">
        <div class="row wrap"><label>YouTube (handle @ o ID del canal) <input id="acc-yt" value="${esc(a.accounts.youtube)}" placeholder="@tucanal" style="width:200px"></label>
          <span class="tiny">${caps && s.secrets.YOUTUBE_API_KEY.set ? '<span class="ok">API key ✓</span>' : '<span class="bad">falta YOUTUBE_API_KEY (Ajustes)</span>'}</span></div>
        <div class="row wrap"><a class="btn" href="/api/youtube/auth">🔗 Conectar YouTube para publicar</a><span class="tiny">${caps.youtubeUpload ? '<span class="ok">✓ Canal conectado: Andrés puede subir videos</span>' : 'Requiere YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET (ver README)'}</span></div>
        <div class="tiny">TikTok: ${s.secrets.TIKTOK_ACCESS_TOKEN.set ? '<span class="ok">token ✓</span>' : 'sin token'} · Instagram: ${s.secrets.INSTAGRAM_ACCESS_TOKEN.set ? '<span class="ok">token ✓</span>' : 'sin token'} — configúralos en Ajustes, o anota tus números a mano aquí abajo. Alternativa recomendada para publicar y medir en las 3 redes a la vez: Metricool o Buffer.</div>
        <button class="btn" id="acc-save" style="align-self:flex-start">Guardar cuentas</button>
      </div>
    </div>
    <div class="card">
      <h3>✍️ Registrar métricas a mano</h3>
      <form id="manual-form" class="row wrap">
        <select name="platform"><option value="tiktok">TikTok</option><option value="instagram">Instagram</option><option value="youtube">YouTube</option></select>
        <label>Seguidores <input name="followers" type="number" style="width:110px"></label>
        <label>Views <input name="views" type="number" style="width:120px"></label>
        <label>Likes <input name="likes" type="number" style="width:110px"></label>
        <label>Videos <input name="posts" type="number" style="width:80px"></label>
        <button class="btn primary">Guardar</button>
      </form>
    </div>`;
  $('#an-refresh').addEventListener('click', () => api('/api/analytics/refresh', { body: {} }).then(() => toast('📈 Renata está actualizando…')).catch((e) => toast(e.message, true)));
  $('#acc-save').addEventListener('click', () => api('/api/analytics/accounts', { method: 'PUT', body: { youtube: $('#acc-yt').value } }).then((r) => { a.accounts = r; toast('Guardado ✓'); }).catch((e) => toast(e.message, true)));
  $('#manual-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { store.state.analytics = await api('/api/analytics/manual', { body: Object.fromEntries(new FormData(e.target)) }); renderAnalytics(); toast('Métricas guardadas ✓'); } catch (err) { toast(err.message, true); }
  });
}

// ---------- Ajustes ----------
function renderSettings() {
  const s = store.state;
  const st = s.settings;
  const o = s.options;
  const caps = s.capabilities;
  const el = $('#settings');
  if (!el) return;
  const optH = (obj, val) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const capRow = (k, label, help) => `<div class="secret-row"><div class="k">${label}</div><div>${caps[k] ? `<span class="ok">✓ ${esc(String(caps[k]).slice(0, 60))}</span>` : `<span class="bad">✗ no encontrado</span> <span class="tiny">${help}</span>`}</div></div>`;
  el.innerHTML = `
    <div class="card"><h3>📺 Tu canal</h3>
      <form id="set-form" class="ed-grid">
        <label class="field"><span>Nombre del canal</span><input name="channelName" value="${esc(st.channelName)}"></label>
        <label class="field"><span>Handle (marca de agua)</span><input name="handle" value="${esc(st.handle)}"></label>
        <label class="field"><span>Voz por defecto</span><select name="voice">${optH(o.voices, st.voice)}</select></label>
        <label class="field"><span>Música por defecto</span><select name="musicMood">${optH(o.moods, st.musicMood)}<option value="none" ${st.musicMood === 'none' ? 'selected' : ''}>Sin música</option></select></label>
        <label class="field"><span>Subtítulos</span><select name="captionStyle">${optH(o.captionStyles, st.captionStyle)}</select></label>
        <label class="field"><span>Encuadre</span><select name="layout">${optH(o.layouts, st.layout)}</select></label>
        <label class="field"><span>Clips por video</span><input name="clipCount" type="number" min="1" max="12" value="${st.clipCount}"></label>
        <label class="field"><span>Segundos por clip</span><input name="clipSeconds" type="number" min="8" max="90" value="${st.clipSeconds}"></label>
        <label class="field"><span>Imágenes de datos curiosos</span><select name="imageSource">${optH({ auto: 'Renders IA y si falla fotos libres', ai: 'Solo renders IA', photo: 'Fotos reales libres (Wikimedia/Pexels)' }, st.imageSource)}</select></label>
        <label class="field"><span>Volumen de música</span><input name="musicVolume" type="range" min="0" max="0.5" step="0.01" value="${st.musicVolume}"></label>
        <label><input type="checkbox" name="watermark" ${st.watermark ? 'checked' : ''}> Mostrar @handle en los videos</label>
        <label><input type="checkbox" name="requireCreativeCommons" ${st.requireCreativeCommons ? 'checked' : ''}> El scout solo usa videos Creative Commons</label>
      </form>
      <button class="btn primary" id="set-save" style="margin-top:12px">Guardar ajustes</button>
    </div>
    <div class="card"><h3>🔑 Claves y conectores (se guardan solo en tu PC)</h3>
      <div class="tiny" style="margin-bottom:8px">Deja en blanco para no cambiar. Escribe «-» para borrar una clave.</div>
      ${Object.entries(s.secrets).map(([k, v]) => `<div class="secret-row"><div><div class="k">${k} ${v.set ? '<span class="ok">✓</span>' : ''}</div><div class="d">${esc(v.desc)}</div></div><input data-secret="${k}" type="${/MODEL|FILE|USER_ID/.test(k) ? 'text' : 'password'}" placeholder="${esc(v.preview || 'no configurada')}" autocomplete="off"></div>`).join('')}
      <button class="btn primary" id="sec-save" style="margin-top:12px">Guardar claves</button>
    </div>
    <div class="card"><h3>🧰 Herramientas del sistema</h3>
      ${capRow('ffmpeg', 'FFmpeg (edición de video)', 'Instálalo: https://ffmpeg.org/download.html')}
      ${capRow('ytdlp', 'yt-dlp (descargar videos)', 'pip install -U yt-dlp')}
      ${capRow('python', 'Python', 'https://python.org')}
      ${capRow('edgeTts', 'edge-tts (voz neural gratis)', 'pip install edge-tts')}
      <div class="secret-row"><div class="k">Claude (cerebro de los agentes)</div><div>${caps.llm ? `<span class="ok">✓ ${esc(caps.model)}</span>` : '<span class="bad">✗ falta ANTHROPIC_API_KEY</span> <span class="tiny">Consíguela en console.anthropic.com</span>'}</div></div>
    </div>`;
  $('#set-save').addEventListener('click', async () => {
    const f = $('#set-form');
    const body = {};
    $$('input, select', f).forEach((i) => { body[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'number' || i.type === 'range' ? Number(i.value) : i.value; });
    try { store.state.settings = await api('/api/settings', { method: 'PUT', body }); toast('Ajustes guardados ✓'); } catch (e) { toast(e.message, true); }
  });
  $('#sec-save').addEventListener('click', async () => {
    const body = {};
    $$('[data-secret]').forEach((i) => { if (i.value.trim()) body[i.dataset.secret] = i.value.trim() === '-' ? null : i.value.trim(); });
    if (!Object.keys(body).length) return toast('No escribiste ninguna clave nueva');
    try { await api('/api/secrets', { method: 'PUT', body }); await reload(); renderSettings(); toast('🔑 Claves guardadas'); } catch (e) { toast(e.message, true); }
  });
}
