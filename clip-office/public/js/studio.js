// Estudio: lista de clips, vista previa en vivo tipo celular y editor.
import { store, api, toast, $, $$, esc, on, badge, tsec, ago } from './core.js';

let sel = null;        // id del clip abierto
let draft = null;      // copia editable
let raf = 0;
let mediaRec = null;

export function initStudio() {
  $('#new-clips').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const url = String(f.get('url') || '').trim();
    if (!/^https?:\/\//.test(url)) return toast('Pega un link válido (https://…)', true);
    try {
      await api('/api/jobs', { body: { type: 'clips', payload: { url, count: Number(f.get('count')), seconds: Number(f.get('seconds')) } } });
      e.target.url.value = '';
      toast('🎬 ¡En marcha! Diego descarga, Sofía corta y Mateo escribe los hooks.');
    } catch (err) { toast(err.message, true); }
  });
  const dz = $('#dropzone');
  const fi = $('#file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  fi.addEventListener('change', () => fi.files[0] && upload(fi.files[0]));
  $('#clip-filter').addEventListener('change', renderList);
  on((ev) => {
    if (['clip', 'clip_deleted', 'reload'].includes(ev.type)) {
      renderList();
      if (sel && ev.payload?.id === sel && ev.type === 'clip') refreshEditorFromServer(ev.payload);
      if (ev.type === 'clip_deleted' && ev.payload.id === sel) { sel = null; $('#editor').innerHTML = '<div class="empty">Clip eliminado.</div>'; }
    }
    if (ev.type === 'job' && sel) updateJobBar();
  });
  renderList();
}

function upload(file) {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
  xhr.setRequestHeader('x-count', $('#new-clips').count.value);
  xhr.setRequestHeader('x-seconds', $('#new-clips').seconds.value);
  xhr.upload.onprogress = (e) => { $('#upload-progress').textContent = `Subiendo ${Math.round((e.loaded / e.total) * 100)}%…`; };
  xhr.onload = () => {
    $('#upload-progress').textContent = '';
    if (xhr.status === 200) toast('📁 Video subido. El equipo ya está buscando los mejores momentos.');
    else toast(`Error al subir: ${xhr.responseText}`, true);
  };
  xhr.onerror = () => toast('No se pudo subir el video', true);
  xhr.send(file);
}

function renderList() {
  const f = $('#clip-filter').value;
  const clips = store.state.clips.filter((c) => !f || c.kind === f || c.status === f).slice().reverse();
  $('#clip-count').textContent = `${clips.length} elementos`;
  $('#clip-list').innerHTML = clips.map((c) => `
    <div class="clip-item ${c.id === sel ? 'sel' : ''}" data-id="${c.id}">
      <div class="th" style="${c.thumb ? `background-image:url('${c.thumb}')` : ''}">${c.thumb ? '' : c.kind === 'story' ? '🔎' : c.kind === 'chat' ? '💬' : '🎮'}</div>
      <div style="min-width:0">
        <div class="t">${esc(c.title || c.hook)}</div>
        <div class="tiny" style="margin-top:3px">${c.kind === 'story' ? '🔎 Dato curioso' : c.kind === 'chat' ? '💬 Historia en chat' : `🎮 ${esc((c.sourceTitle || '').slice(0, 34))}`}</div>
        <div class="meta">${badge(c.status)}<span class="badge">⭐ ${c.score ?? '—'}</span>${c.compliance ? `<span class="badge risk-${c.compliance.risk}">© ${c.compliance.risk}</span>` : ''}<span class="badge">${Math.round(c.duration || (c.end - c.start) || 0)} s</span></div>
      </div>
    </div>`).join('') || '<div class="tiny">Aún no hay clips. Pega un link arriba o pídeselo a Valeria en la Oficina.</div>';
  $$('.clip-item').forEach((el) => el.addEventListener('click', () => openClip(el.dataset.id)));
}

export function openClip(id) {
  sel = id;
  const c = store.state.clips.find((x) => x.id === id);
  if (!c) return;
  draft = structuredClone(c);
  renderList();
  cancelAnimationFrame(raf);
  if (c.kind === 'story') renderStoryEditor(); else if (c.kind === 'chat') renderChatEditor(); else renderClipEditor();
}

function refreshEditorFromServer(c) {
  // mantiene lo que el usuario está escribiendo, pero actualiza estado/render
  if (!draft) return;
  Object.assign(draft, { status: c.status, video: c.video, thumb: c.thumb, compliance: c.compliance, narration: c.narration, scenes: c.kind === 'story' ? c.scenes.map((s, i) => ({ ...s, text: draft.scenes?.[i]?.text ?? s.text })) : draft.scenes, version: c.version, youtubeUrl: c.youtubeUrl });
  const st = $('#ed-status');
  if (st) st.innerHTML = statusLine();
  const fin = $('#final-video');
  if (fin && c.video && fin.dataset.src !== c.video) { fin.src = c.video; fin.dataset.src = c.video; }
  if (c.kind === 'story') renderScenes();
  updateJobBar();
}

function statusLine() {
  const c = draft;
  return `${badge(c.status)} <span class="tiny">v${c.version || 0}${c.renderedAt ? ` · render ${ago(c.renderedAt)}` : ''}${c.youtubeUrl ? ` · <a href="${c.youtubeUrl}" target="_blank" rel="noopener">ver en YouTube</a>` : ''}</span>`;
}

function updateJobBar() {
  const el = $('#ed-job');
  if (!el) return;
  const j = store.state.jobs.slice().reverse().find((x) => (x.payload?.clipId === sel || x.result?.clipId === sel) && (x.status === 'running' || x.status === 'queued'));
  el.innerHTML = j ? `<div class="tiny">${esc(j.step)} — ${j.progress}%</div><div class="progress"><div style="width:${j.progress}%"></div></div>` : '';
}

const opt = (obj, val) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v)}</option>`).join('');
const musicOpts = (val) => `<option value="none" ${val === 'none' ? 'selected' : ''}>Sin música</option>` + store.state.options.music.map((m) => `<option value="${m.id}" ${m.id === val || m.mood === val ? 'selected' : ''}>${esc(m.label)}</option>`).join('');

function commonActions() {
  return `
    <div class="ed-actions">
      <button class="btn" data-act="save">💾 Guardar</button>
      <button class="btn primary" data-act="render">🎞️ Guardar y renderizar</button>
      <button class="btn" data-act="approve">✅ Aprobar</button>
      <a class="btn" href="/api/clips/${draft.id}/download">⬇️ Descargar MP4</a>
      <select id="yt-privacy"><option value="private">Privado</option><option value="unlisted">No listado</option><option value="public">Público</option></select>
      <button class="btn" data-act="publish">▶️ Subir a YouTube</button>
      <button class="btn" data-act="copy">📋 Copiar descripción</button>
      <button class="btn" data-act="posted-tiktok">✔ Subido a TikTok</button>
      <button class="btn" data-act="posted-instagram">✔ Subido a Reels</button>
      <button class="btn danger" data-act="delete">🗑️ Eliminar</button>
    </div>`;
}

function bindActions(collect) {
  $$('.ed-actions [data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    try {
      if (act === 'save' || act === 'render') {
        await api(`/api/clips/${draft.id}`, { method: 'PATCH', body: collect() });
        if (act === 'render') { await api(`/api/clips/${draft.id}/render`, { body: {} }); toast('🎞️ Sofía está renderizando tu versión.'); } else toast('Guardado ✓');
      } else if (act === 'approve') { await api(`/api/clips/${draft.id}`, { method: 'PATCH', body: collect() }); await api(`/api/clips/${draft.id}/approve`, { body: {} }); toast('✅ Aprobado'); }
      else if (act === 'publish') {
        if (!draft.video) return toast('Primero renderiza el clip', true);
        if (!store.state.capabilities.youtubeUpload) return toast('Conecta tu canal en Analytics → «Conectar YouTube para publicar».', true);
        await api(`/api/clips/${draft.id}/publish`, { body: { privacy: $('#yt-privacy').value } });
        toast('🚀 Andrés está subiendo el video a YouTube');
      } else if (act === 'copy') {
        const d = collect();
        await navigator.clipboard.writeText(`${d.title}\n\n${d.description}`);
        toast('Título y descripción copiados 📋');
      } else if (act.startsWith('posted-')) {
        const url = prompt('Link de la publicación (opcional):') ?? '';
        await api(`/api/clips/${draft.id}/posted`, { body: { platform: act.slice(7), url } });
        toast('Marcado como publicado ✓');
      } else if (act === 'delete') {
        if (!confirm('¿Eliminar este clip y su video?')) return;
        await api(`/api/clips/${draft.id}`, { method: 'DELETE' });
      }
    } catch (e) { toast(e.message, true); }
  }));
}

function complianceBox(c) {
  if (!c.compliance) return '';
  return `<div class="compliance ${c.compliance.risk}"><b>⚖️ Tomás (copyright): riesgo ${c.compliance.risk}</b><br>${c.compliance.notes.map(esc).join('<br>')}</div>`;
}

// ================= CLIP DE GAMEPLAY =================
function renderClipEditor() {
  const c = draft;
  const src = store.state.sources.find((s) => s.id === c.sourceId);
  const o = store.state.options;
  $('#editor').innerHTML = `
  <div class="editor">
    <div class="phone-wrap">
      <div class="prev-tabs"><button class="btn small active" data-pv="live">👁️ Vista previa en vivo</button><button class="btn small" data-pv="final">🎞️ Render final</button></div>
      <div id="pv-live">
        <div class="phone ${c.layout === 'crop' ? 'crop' : ''}" id="phone">
          <video class="bgv" id="v-bg" muted playsinline preload="auto" src="${src?.videoUrl || ''}"></video>
          <video class="fgv" id="v-fg" playsinline preload="auto" src="${src?.videoUrl || ''}"></video>
          <div class="ov-hook" id="ov-hook"></div>
          <div class="ov-cap" id="ov-cap"></div>
          <div class="ov-handle">${esc(store.state.settings.watermark ? store.state.settings.handle : '')}</div>
          <div class="ov-bar" id="ov-bar"></div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn small" id="pv-play">▶ Play</button>
          <button class="btn small" id="set-in">⇤ Inicio aquí</button>
          <button class="btn small" id="set-out">Fin aquí ⇥</button>
          <span class="tiny mono" id="pv-time"></span>
        </div>
        <div class="timeline" id="tl"><div class="sel" id="tl-sel"></div><div class="h" id="h-in"></div><div class="h" id="h-out"></div><div class="head" id="tl-head"></div></div>
        <div class="tiny">Arrastra los bordes verdes para recortar. Fuente: ${esc(src?.title || '—')} (${tsec(src?.duration)})</div>
      </div>
      <div id="pv-final" class="hidden">
        ${c.video ? `<div class="phone"><video id="final-video" data-src="${c.video}" src="${c.video}" controls playsinline style="width:100%;height:100%"></video></div>` : '<div class="phone"><div class="empty">Aún no está renderizado</div></div>'}
      </div>
    </div>
    <div class="ed-form">
      <div class="row" style="justify-content:space-between"><div id="ed-status">${statusLine()}</div><span class="tiny">⭐ viralidad ${c.score ?? '—'}</span></div>
      <div id="ed-job"></div>
      ${c.reason ? `<div class="tiny">✂️ Sofía: ${esc(c.reason)}</div>` : ''}
      <label class="field"><span>Hook (texto grande en pantalla)</span><input id="f-hook" value="${esc(c.hook)}"></label>
      <label class="field"><span>Título para YouTube / TikTok</span><input id="f-title" value="${esc(c.title)}"></label>
      ${c.titleOptions?.length ? `<div class="chips">${c.titleOptions.map((t) => `<span class="chip btnchip" data-title="${esc(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
      <label class="field"><span>Comentario propio (hace el clip transformativo)</span><input id="f-comm" value="${esc(c.commentary || '')}" placeholder="Ej: Fíjate cómo reacciona la policía en GTA 6 comparado con GTA 5"></label>
      <div class="ed-grid">
        <label class="field"><span>Encuadre</span><select id="f-layout">${opt(o.layouts, c.layout)}</select></label>
        <label class="field"><span>Posición horizontal</span><input type="range" id="f-cropx" min="0" max="1" step="0.01" value="${c.cropX ?? 0.5}"></label>
        <label class="field"><span>Zoom</span><input type="range" id="f-zoom" min="0.8" max="2.6" step="0.02" value="${c.zoom || (c.layout === 'zoom' ? 1.9 : 1.22)}"></label>
        <label class="field"><span>Subtítulos</span><select id="f-cap">${opt(o.captionStyles, c.captionStyle)}</select></label>
        <label class="field"><span>Altura subtítulos</span><input type="range" id="f-capy" min="0.45" max="0.88" step="0.01" value="${c.captionY ?? 0.72}"></label>
        <label class="field"><span>Música (libre de derechos)</span><select id="f-music">${musicOpts(c.music)}</select></label>
        <label class="field"><span>Volumen música</span><input type="range" id="f-mvol" min="0" max="0.6" step="0.01" value="${c.musicVolume ?? 0.14}"></label>
        <label class="field"><span>Volumen original</span><input type="range" id="f-ovol" min="0" max="1.5" step="0.05" value="${c.originalVolume ?? 1}"></label>
      </div>
      <div class="row"><label class="field grow"><span>Inicio (s)</span><input id="f-start" type="number" step="0.1" value="${c.start}" style="width:100%"></label><label class="field grow"><span>Fin (s)</span><input id="f-end" type="number" step="0.1" value="${c.end}" style="width:100%"></label></div>
      <div class="field"><span>Subtítulos palabra por palabra (corrige el texto aquí)</span><div class="words-edit" id="words">${(c.words || []).map((w, i) => `<input data-i="${i}" value="${esc(w.text)}" size="${Math.max(2, w.text.length)}">`).join('') || '<span class="tiny">Sin transcripción. Agrega OPENAI_API_KEY para Whisper, o usa videos con subtítulos.</span>'}</div></div>
      <label class="field"><span>Descripción</span><textarea id="f-desc" rows="5">${esc(c.description || '')}</textarea></label>
      <label class="field"><span>Hashtags</span><input id="f-tags" value="${esc((c.hashtags || []).join(' '))}"></label>
      ${complianceBox(c)}
      ${commonActions()}
    </div>
  </div>`;
  setupLivePreview(src);
  $$('[data-title]').forEach((ch) => ch.addEventListener('click', () => { $('#f-title').value = ch.dataset.title; }));
  $$('[data-pv]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-pv]').forEach((x) => x.classList.toggle('active', x === b));
    $('#pv-live').classList.toggle('hidden', b.dataset.pv !== 'live');
    $('#pv-final').classList.toggle('hidden', b.dataset.pv !== 'final');
    if (b.dataset.pv === 'final') { $('#v-fg').pause(); $('#v-bg').pause(); }
  }));
  if (c.video && c.status !== 'draft') $('[data-pv="final"]').click();
  bindActions(collectClip);
  updateJobBar();
}

function collectClip() {
  const words = (draft.words || []).map((w, i) => ({ ...w, text: $(`#words input[data-i="${i}"]`)?.value ?? w.text })).filter((w) => w.text.trim());
  const start = Number($('#f-start').value), end = Number($('#f-end').value);
  const out = {
    hook: $('#f-hook').value, title: $('#f-title').value, commentary: $('#f-comm').value, layout: $('#f-layout').value,
    cropX: Number($('#f-cropx').value), zoom: Number($('#f-zoom').value), captionStyle: $('#f-cap').value, captionY: Number($('#f-capy').value),
    music: $('#f-music').value, musicVolume: Number($('#f-mvol').value), originalVolume: Number($('#f-ovol').value),
    start, end, description: $('#f-desc').value, hashtags: $('#f-tags').value.split(/\s+/).filter(Boolean),
  };
  if (start === draft.start && end === draft.end) out.words = words;
  return out;
}

function setupLivePreview(src) {
  const fg = $('#v-fg'), bg = $('#v-bg'), phone = $('#phone');
  const dur = src?.duration || 1;
  let playing = false;
  const S = () => Number($('#f-start').value), E = () => Number($('#f-end').value);
  const apply = () => {
    const layout = $('#f-layout').value;
    phone.classList.toggle('crop', layout === 'crop');
    const z = Number($('#f-zoom').value);
    const cx = Number($('#f-cropx').value);
    if (layout === 'crop') { fg.style.width = ''; phone.style.setProperty('--cx', `${cx * 100}%`); fg.style.transform = `translate(${-cx * 100}%, -50%)`; }
    else { fg.style.width = `${z * 100}%`; fg.style.left = `${50 + (cx - 0.5) * (z * 100 - 100)}%`; fg.style.transform = 'translate(-50%, -54%)'; }
    $('#ov-hook').textContent = $('#f-hook').value.replace(/[\p{Extended_Pictographic}]/gu, '');
    $('#ov-cap').style.bottom = `${(1 - Number($('#f-capy').value)) * 100}%`;
    fg.volume = Math.min(1, Number($('#f-ovol').value));
    const sl = $('#tl-sel');
    sl.style.left = `${(S() / dur) * 100}%`; sl.style.width = `${((E() - S()) / dur) * 100}%`;
    $('#h-in').style.left = `${(S() / dur) * 100}%`; $('#h-out').style.left = `${(E() / dur) * 100}%`;
  };
  ['#f-layout', '#f-zoom', '#f-cropx', '#f-hook', '#f-capy', '#f-ovol', '#f-start', '#f-end'].forEach((s) => $(s).addEventListener('input', apply));
  fg.addEventListener('loadedmetadata', () => { fg.currentTime = S(); bg.currentTime = S(); apply(); });
  const tick = () => {
    const t = fg.currentTime;
    if (playing && t >= E()) { fg.currentTime = S(); bg.currentTime = S(); }
    if (Math.abs(bg.currentTime - t) > 0.25) bg.currentTime = t;
    const rel = t - S();
    $('#ov-bar').style.width = `${Math.max(0, Math.min(1, rel / (E() - S()))) * 100}%`;
    $('#tl-head').style.left = `${(t / dur) * 100}%`;
    $('#pv-time').textContent = `${tsec(t)} · clip ${tsec(Math.max(0, rel))} / ${tsec(E() - S())}`;
    // subtítulos en vivo (palabras relativas al inicio guardado)
    const style = $('#f-cap').value;
    const absT = t - draft.start;
    const words = draft.words || [];
    let html = '';
    if (style !== 'none' && words.length) {
      const idx = words.findIndex((w, i) => absT >= w.start && absT < (words[i + 1]?.start ?? w.end + 0.5));
      if (idx >= 0) {
        const chunkStart = Math.floor(idx / 3) * 3;
        html = words.slice(chunkStart, chunkStart + 3).map((w, k) => {
          const txt = esc(($(`#words input[data-i="${chunkStart + k}"]`)?.value ?? w.text).toUpperCase());
          return style === 'karaoke' && chunkStart + k === idx ? `<span class="on">${txt}</span>` : txt;
        }).join(' ');
      }
    }
    const cap = $('#ov-cap');
    if (cap.innerHTML !== html) cap.innerHTML = html;
    cap.style.background = style === 'boxed' && html ? 'rgba(0,0,0,.78)' : 'none';
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  $('#pv-play').addEventListener('click', () => {
    playing = !playing;
    if (playing) { if (fg.currentTime < S() || fg.currentTime >= E()) fg.currentTime = S(); fg.play(); bg.play(); $('#pv-play').textContent = '⏸ Pausa'; }
    else { fg.pause(); bg.pause(); $('#pv-play').textContent = '▶ Play'; }
  });
  $('#set-in').addEventListener('click', () => { $('#f-start').value = fg.currentTime.toFixed(1); if (E() - S() < 3) $('#f-end').value = Math.min(dur, S() + 30).toFixed(1); apply(); });
  $('#set-out').addEventListener('click', () => { $('#f-end').value = fg.currentTime.toFixed(1); apply(); });
  // línea de tiempo
  const tl = $('#tl');
  let drag = null;
  const posT = (e) => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); };
  $('#h-in').addEventListener('pointerdown', (e) => { drag = 'in'; e.stopPropagation(); tl.setPointerCapture(e.pointerId); });
  $('#h-out').addEventListener('pointerdown', (e) => { drag = 'out'; e.stopPropagation(); tl.setPointerCapture(e.pointerId); });
  tl.addEventListener('pointerdown', (e) => { if (!drag) { fg.currentTime = posT(e); bg.currentTime = fg.currentTime; } });
  tl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const t = +posT(e).toFixed(1);
    if (drag === 'in' && t < E() - 2) $('#f-start').value = t;
    if (drag === 'out' && t > S() + 2) $('#f-end').value = t;
    fg.currentTime = t;
    apply();
  });
  tl.addEventListener('pointerup', () => { drag = null; });
  apply();
}

// ================= DATO CURIOSO =================
function renderStoryEditor() {
  const c = draft;
  const o = store.state.options;
  $('#editor').innerHTML = `
  <div class="editor">
    <div class="phone-wrap">
      <div class="phone">${c.video ? `<video id="final-video" data-src="${c.video}" src="${c.video}" controls playsinline style="width:100%;height:100%"></video>` : `<div class="empty">${c.status === 'rendering' ? '🎞️ Renderizando…' : 'Aún sin renderizar'}</div>`}</div>
      ${c.narration?.url ? `<div class="tiny" style="margin-top:8px">🎙️ Narración (${c.customVoice ? 'tu voz' : c.voice}):</div><audio controls src="${c.narration.url}" style="width:100%"></audio>` : ''}
      <div class="card" style="margin-top:10px">
        <div class="tiny">¿Quieres usar TU voz? Lee el guion completo y Nico la usa como narración.</div>
        <div class="row" style="margin-top:8px"><button class="btn" id="rec-btn">🎙️ Grabar mi voz</button><span class="tiny" id="rec-state"></span></div>
      </div>
    </div>
    <div class="ed-form">
      <div class="row" style="justify-content:space-between"><div id="ed-status">${statusLine()}</div><span class="tiny">⭐ ${c.score ?? '—'}</span></div>
      <div id="ed-job"></div>
      <div class="tiny">📚 Fuente: ${c.sourceUrl ? `<a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.sourceUrl)}</a>` : '—'} — verifica el dato antes de publicar.</div>
      <label class="field"><span>Título</span><input id="s-title" value="${esc(c.title)}"></label>
      <label class="field"><span>Hook (primera frase del narrador — conecta en 2 segundos)</span><input id="s-hook" value="${esc(c.script.hook)}"></label>
      <div class="field"><span>Escenas (texto narrado + imagen)</span><div class="scenes" id="scenes"></div></div>
      <label class="field"><span>Cierre / llamada a la acción</span><input id="s-cta" value="${esc(c.script.cta)}"></label>
      <div class="ed-grid">
        <label class="field"><span>Voz</span><select id="s-voice">${opt(o.voices, c.voice)}</select></label>
        <label class="field"><span>Música (original, sin copyright)</span><select id="s-music">${musicOpts(c.music)}</select></label>
        <label class="field"><span>Volumen música</span><input type="range" id="s-mvol" min="0" max="0.5" step="0.01" value="${c.musicVolume ?? 0.1}"></label>
        <label class="field"><span>Subtítulos</span><select id="s-cap">${opt(o.captionStyles, c.captionStyle)}</select></label>
      </div>
      <label class="field"><span>Descripción</span><textarea id="f-desc" rows="5">${esc(c.description || '')}</textarea></label>
      <label class="field"><span>Hashtags</span><input id="f-tags" value="${esc((c.hashtags || []).join(' '))}"></label>
      ${complianceBox(c)}
      ${commonActions()}
    </div>
  </div>`;
  renderScenes();
  bindActions(collectStory);
  $('#rec-btn').addEventListener('click', toggleRecording);
  updateJobBar();
}

function renderScenes() {
  const box = $('#scenes');
  if (!box) return;
  const texts = $$('#scenes textarea').map((t) => t.value);
  box.innerHTML = draft.scenes.map((s, i) => `
    <div class="scene">
      <div class="img" style="${s.imageUrl ? `background-image:url('${s.imageUrl}')` : ''}" title="${esc(s.credit || '')}"></div>
      <div class="stack">
        <textarea rows="3" data-i="${i}">${esc(texts[i] ?? s.text)}</textarea>
        <input data-visual="${i}" value="${esc(s.visual || '')}" placeholder="Descripción de la imagen (prompt para IA)">
        <div class="row wrap"><button class="btn small" data-img="ai" data-i="${i}">🎨 Render IA</button><button class="btn small" data-img="photo" data-i="${i}">📷 Foto real</button><button class="btn small" data-img="url" data-i="${i}">🔗 Desde URL</button><span class="tiny">${esc(s.credit || '')}</span></div>
      </div>
    </div>`).join('');
  $$('[data-img]', box).forEach((b) => b.addEventListener('click', async () => {
    const i = Number(b.dataset.i);
    const body = { mode: b.dataset.img, visual: $(`[data-visual="${i}"]`).value };
    if (b.dataset.img === 'url') { const u = prompt('URL de la imagen (asegúrate de tener derecho a usarla):'); if (!u) return; body.url = u; }
    b.disabled = true; b.textContent = '⏳ Creando…';
    try { await api(`/api/clips/${draft.id}/scenes/${i}/image`, { body }); toast('🎨 Camila cambió la imagen. Renderiza para ver el resultado.'); } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

function collectStory() {
  return {
    title: $('#s-title').value, hook: $('#s-hook').value, cta: $('#s-cta').value, voice: $('#s-voice').value, music: $('#s-music').value,
    musicVolume: Number($('#s-mvol').value), captionStyle: $('#s-cap').value, description: $('#f-desc').value, hashtags: $('#f-tags').value.split(/\s+/).filter(Boolean),
    scenes: draft.scenes.map((s, i) => ({ text: $(`#scenes textarea[data-i="${i}"]`).value, visual: $(`[data-visual="${i}"]`).value, query: s.query })),
  };
}

async function toggleRecording() {
  const btn = $('#rec-btn');
  if (mediaRec) { mediaRec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => chunks.push(e.data);
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      mediaRec = null;
      btn.textContent = '🎙️ Grabar mi voz';
      btn.classList.remove('primary');
      $('#rec-state').textContent = 'Procesando tu voz…';
      try {
        await api(`/api/clips/${draft.id}`, { method: 'PATCH', body: collectStory() });
        await api(`/api/clips/${draft.id}/voice`, { raw: true, method: 'POST', body: new Blob(chunks, { type: chunks[0]?.type || 'audio/webm' }), headers: { 'Content-Type': 'application/octet-stream' } });
        $('#rec-state').textContent = '✅ Voz lista. Dale a «Guardar y renderizar».';
      } catch (e) { $('#rec-state').textContent = ''; toast(e.message, true); }
    };
    mediaRec.start();
    btn.textContent = '⏹ Detener grabación';
    btn.classList.add('primary');
    $('#rec-state').innerHTML = `Lee en voz alta: <i>${esc([$('#s-hook').value, ...$$('#scenes textarea').map((t) => t.value), $('#s-cta').value].join(' '))}</i>`;
  } catch (e) { toast(`No pude usar el micrófono: ${e.message}`, true); }
}


// ================= HISTORIA EN CHAT =================
let chatTimer = null;

function renderChatEditor() {
  const c = draft;
  const o = store.state.options;
  $('#editor').innerHTML = `
  <div class="editor">
    <div class="phone-wrap">
      <div class="prev-tabs"><button class="btn small active" data-pv="live">👁️ Vista previa en vivo</button><button class="btn small" data-pv="final">🎞️ Render final</button></div>
      <div id="pv-live">
        <div class="phone chatphone" id="chatphone"></div>
        <div class="row" style="margin-top:8px"><button class="btn small" id="chat-play">▶ Reproducir</button><span class="tiny">Así se verá: los mensajes aparecen uno a uno.</span></div>
      </div>
      <div id="pv-final" class="hidden">
        ${c.video ? `<div class="phone"><video id="final-video" data-src="${c.video}" src="${c.video}" controls playsinline style="width:100%;height:100%"></video></div>` : `<div class="phone"><div class="empty">${c.status === 'rendering' ? '🎞️ Animando…' : 'Aún sin renderizar'}</div></div>`}
      </div>
    </div>
    <div class="ed-form">
      <div class="row" style="justify-content:space-between"><div id="ed-status">${statusLine()}</div></div>
      <div id="ed-job"></div>
      <label class="field"><span>Título (YouTube / TikTok)</span><input id="c-title" value="${esc(c.title)}"></label>
      <label class="field"><span>Frase de arriba (el gancho)</span><input id="c-header" value="${esc(c.chat.header)}"></label>
      <div class="ed-grid">
        <label class="field"><span>Estilo del chat</span><select id="c-theme">${opt(o.chatThemes || {}, c.theme)}</select></label>
        <label class="field"><span>Música</span><select id="c-music">${musicOpts(c.music)}</select></label>
        <label class="field"><span>Volumen música</span><input type="range" id="c-mvol" min="0" max="0.6" step="0.01" value="${c.musicVolume ?? 0.18}"></label>
      </div>
      <div class="field"><span>Personajes (marca «yo» para quien escribe desde la derecha)</span><div class="stack" id="c-chars"></div><button class="btn small" id="c-addchar" style="align-self:flex-start">+ Personaje</button></div>
      <div class="field"><span>Mensajes (el último es el remate 🥁)</span><div class="stack" id="c-msgs"></div><button class="btn small" id="c-addmsg" style="align-self:flex-start">+ Mensaje</button></div>
      <label class="field"><span>Descripción</span><textarea id="f-desc" rows="4">${esc(c.description || '')}</textarea></label>
      <label class="field"><span>Hashtags</span><input id="f-tags" value="${esc((c.hashtags || []).join(' '))}"></label>
      ${complianceBox(c)}
      ${commonActions()}
    </div>
  </div>`;
  renderChatLists();
  $('#c-addchar').addEventListener('click', () => { syncChat(); draft.chat.characters.push({ name: `Persona ${draft.chat.characters.length + 1}`, role: '', me: false }); renderChatLists(); });
  $('#c-addmsg').addEventListener('click', () => { syncChat(); draft.chat.messages.push({ from: draft.chat.characters[0]?.name || '', text: '' }); renderChatLists(); });
  $('#chat-play').addEventListener('click', playChat);
  ['#c-header', '#c-theme'].forEach((x) => $(x).addEventListener('input', () => { syncChat(); drawChatPhone(draft.chat.messages.length); }));
  $$('[data-pv]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-pv]').forEach((x) => x.classList.toggle('active', x === b));
    $('#pv-live').classList.toggle('hidden', b.dataset.pv !== 'live');
    $('#pv-final').classList.toggle('hidden', b.dataset.pv !== 'final');
  }));
  bindActions(collectChat);
  drawChatPhone(draft.chat.messages.length);
  updateJobBar();
}

function renderChatLists() {
  const ch = draft.chat;
  $('#c-chars').innerHTML = ch.characters.map((p, i) => `
    <div class="row"><input data-cn="${i}" value="${esc(p.name)}" placeholder="Nombre" style="width:150px"><input data-cr="${i}" value="${esc(p.role)}" placeholder="Rol (opcional)" class="grow"><label><input type="checkbox" data-cm="${i}" ${p.me ? 'checked' : ''}> yo</label><button class="btn small danger" data-cdel="${i}">✕</button></div>`).join('');
  const names = ch.characters.map((p) => p.name);
  $('#c-msgs').innerHTML = ch.messages.map((m, i) => `
    <div class="row"><select data-mf="${i}" style="width:140px">${names.map((n) => `<option ${n === m.from ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><input data-mt="${i}" value="${esc(m.text)}" class="grow" maxlength="220"><button class="btn small" data-mup="${i}" title="Subir">↑</button><button class="btn small danger" data-mdel="${i}">✕</button></div>`).join('');
  $$('[data-cdel]').forEach((b) => b.addEventListener('click', () => { syncChat(); const n = ch.characters[b.dataset.cdel].name; ch.characters.splice(b.dataset.cdel, 1); ch.messages = ch.messages.filter((m) => m.from !== n); renderChatLists(); }));
  $$('[data-mdel]').forEach((b) => b.addEventListener('click', () => { syncChat(); ch.messages.splice(b.dataset.mdel, 1); renderChatLists(); }));
  $$('[data-mup]').forEach((b) => b.addEventListener('click', () => { syncChat(); const i = +b.dataset.mup; if (i > 0) [ch.messages[i - 1], ch.messages[i]] = [ch.messages[i], ch.messages[i - 1]]; renderChatLists(); }));
  $$('#c-chars input, #c-msgs input, #c-msgs select').forEach((x) => x.addEventListener('change', () => { syncChat(); renderChatLists(); }));
  drawChatPhone(ch.messages.length);
}

function syncChat() {
  const ch = draft.chat;
  const renames = {};
  ch.characters.forEach((p, i) => {
    const n = $(`[data-cn="${i}"]`)?.value.trim();
    if (n && n !== p.name) { renames[p.name] = n; p.name = n; }
    p.role = $(`[data-cr="${i}"]`)?.value ?? p.role;
    p.me = $(`[data-cm="${i}"]`)?.checked ?? p.me;
  });
  ch.messages.forEach((m, i) => {
    m.from = renames[m.from] || $(`[data-mf="${i}"]`)?.value || m.from;
    if (renames[m.from]) m.from = renames[m.from];
    m.text = $(`[data-mt="${i}"]`)?.value ?? m.text;
  });
  if ($('#c-header')) ch.header = $('#c-header').value;
  if ($('#c-theme')) draft.theme = $('#c-theme').value;
}

function collectChat() {
  syncChat();
  return {
    title: $('#c-title').value, theme: $('#c-theme').value, music: $('#c-music').value, musicVolume: Number($('#c-mvol').value),
    description: $('#f-desc').value, hashtags: $('#f-tags').value.split(/\s+/).filter(Boolean),
    chat: { ...draft.chat, messages: draft.chat.messages.filter((m) => m.text.trim()) },
  };
}

const CHAT_CSS = {
  oscuro: { bg: '#101114', panel: '#1d1e22', other: '#2b2c31', me: '#2b2c31', text: '#fff', meta: '#9a9aa2', header: '#fff' },
  whatsapp: { bg: '#0b141a', panel: '#0b141a', other: '#202c33', me: '#005c4b', text: '#e9edef', meta: '#8696a0', header: '#fff' },
  imessage: { bg: '#000', panel: '#000', other: '#26252a', me: '#0a84ff', text: '#fff', meta: '#8e8e93', header: '#fff' },
  ludus: { bg: '#0a0a0a', panel: '#121212', other: '#1f1f1f', me: '#C6FF00', meText: '#000', text: '#fff', meta: '#9a9a9a', header: '#C6FF00' },
};
const AV = ['#ff6b3d', '#4dd6ff', '#9b5cff', '#ffb000', '#00e5a8', '#ff3b8d'];

function drawChatPhone(n, typingFrom = null) {
  const el = $('#chatphone');
  if (!el) return;
  const ch = draft.chat;
  const T = CHAT_CSS[draft.theme] || CHAT_CSS.oscuro;
  const chars = Object.fromEntries(ch.characters.map((p, i) => [p.name, { ...p, color: AV[i % AV.length] }]));
  const msgs = ch.messages.slice(0, n).map((m, i) => {
    const c = chars[m.from] || { name: m.from, color: '#888' };
    const first = ch.messages[i - 1]?.from !== m.from;
    return `<div class="cm ${c.me ? 'me' : ''} ${first ? 'first' : ''}">
      ${!c.me ? `<div class="av" style="background:${first ? c.color : 'transparent'}">${first ? esc(c.name[0] || '') : ''}</div>` : ''}
      <div class="bb" style="background:${c.me ? T.me : T.other};color:${c.me && T.meText ? T.meText : T.text}">${first && !c.me ? `<div class="nm" style="color:${T.meta}">${esc(c.name)}${c.role ? ` - ${esc(c.role)}` : ''}</div>` : ''}${esc(m.text)}</div></div>`;
  }).join('');
  const typing = typingFrom ? `<div class="cm ${chars[typingFrom]?.me ? 'me' : ''}">${chars[typingFrom]?.me ? '' : '<div class="av" style="background:transparent"></div>'}<div class="bb typing" style="background:${T.other}"><i></i><i></i><i></i></div></div>` : '';
  el.style.background = T.bg;
  el.innerHTML = `<div class="chd" style="color:${T.header}">${esc(ch.header)}</div><div class="cpanel" style="background:${T.panel}"><div class="cscroll">${msgs}${typing}</div></div><div class="ov-handle">${esc(store.state.settings.watermark ? store.state.settings.handle : '')}</div>`;
  const sc = $('.cscroll', el);
  sc.scrollTop = sc.scrollHeight;
}

function playChat() {
  syncChat();
  clearTimeout(chatTimer);
  const msgs = draft.chat.messages;
  let i = 0;
  drawChatPhone(0);
  const next = () => {
    if (i >= msgs.length) return;
    const same = msgs[i - 1]?.from === msgs[i].from;
    drawChatPhone(i, msgs[i].from);
    chatTimer = setTimeout(() => {
      i++;
      drawChatPhone(i);
      const read = Math.min(4.2, Math.max(1.1, 0.85 + msgs[i - 1].text.length * 0.045));
      chatTimer = setTimeout(next, read * 1000);
    }, (same ? 0.35 : 0.75) * 1000);
  };
  chatTimer = setTimeout(next, 1400);
}

