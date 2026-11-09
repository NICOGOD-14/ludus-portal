// Descarga de la fuente (YouTube, TikTok, Twitch, MP4 directo o archivo subido).
import fs from 'node:fs';
import path from 'node:path';
import { BIN, DIRS, getSecret } from '../config.js';
import { db, uid, now, save, emit } from '../db.js';
import { run, probe, download } from '../util.js';

export function isDirectMedia(url) {
  return /\.(mp4|mov|webm|mkv)(\?|$)/i.test(url);
}

export function youtubeId(url) {
  const m = String(url).match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Devuelve la fuente existente si ya se descargó ese link. */
export function existingSource(url) {
  const id = youtubeId(url);
  return db.sources.find((s) => s.status === 'ready' && (s.url === url || (id && s.videoId === id)));
}

export async function ingestUrl(url, { onProgress } = {}) {
  const prev = existingSource(url);
  if (prev && fs.existsSync(prev.path)) return prev;

  const id = uid('src_');
  const dir = path.join(DIRS.sources, id);
  fs.mkdirSync(dir, { recursive: true });
  const src = { id, url, videoId: youtubeId(url), title: url, channel: '', license: '', status: 'downloading', createdAt: now(), dir };
  db.sources.push(src);
  save();
  emit('source', src);

  try {
    if (isDirectMedia(url)) {
      onProgress?.(10, 'Descargando archivo de video');
      const file = path.join(dir, 'video' + path.extname(new URL(url).pathname));
      await download(url, file, { timeoutMs: 15 * 60000 });
      src.path = file;
      src.title = decodeURIComponent(path.basename(new URL(url).pathname));
    } else {
      const args = [
        '-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b',
        '--merge-output-format', 'mp4',
        '-o', path.join(dir, 'video.%(ext)s'),
        '--write-info-json', '--write-auto-subs', '--write-subs',
        '--sub-langs', 'es.*,es,en.*,en', '--sub-format', 'vtt',
        '--no-playlist', '--newline', '--no-progress', '--progress',
        '--js-runtimes', 'node',
        '--max-filesize', '2G',
      ];
      const cookies = getSecret('YTDLP_COOKIES_FILE');
      if (cookies) args.push('--cookies', cookies);
      args.push(url);
      await run(BIN.ytdlp, args, {
        cwd: dir,
        timeoutMs: 30 * 60000,
        onLine: (l) => {
          const m = l.match(/\[download\]\s+([\d.]+)%/);
          if (m) onProgress?.(Number(m[1]) * 0.9, `Descargando ${m[1]}%`);
        },
      });
      const files = fs.readdirSync(dir);
      const video = files.find((f) => /^video\.(mp4|mkv|webm|mov)$/.test(f));
      if (!video) throw new Error('yt-dlp no generó el video');
      src.path = path.join(dir, video);
      const infoFile = files.find((f) => f.endsWith('.info.json'));
      if (infoFile) {
        const info = JSON.parse(fs.readFileSync(path.join(dir, infoFile), 'utf8'));
        Object.assign(src, {
          title: info.title || src.title,
          channel: info.channel || info.uploader || '',
          channelUrl: info.channel_url || info.uploader_url || '',
          license: info.license || '',
          views: info.view_count || 0,
          uploadDate: info.upload_date || '',
          description: (info.description || '').slice(0, 2000),
          platform: info.extractor_key || '',
        });
        fs.rmSync(path.join(dir, infoFile));
      }
      const subs = files.filter((f) => f.endsWith('.vtt'));
      const pick = subs.find((f) => /\.es[.-]/.test(f) && !/orig/.test(f)) || subs.find((f) => /\.es/.test(f)) || subs.find((f) => /\.en/.test(f)) || subs[0];
      if (pick) src.subsPath = path.join(dir, pick);
    }
    const meta = await probe(src.path);
    Object.assign(src, meta, { status: 'ready' });
    save();
    emit('source', src);
    return src;
  } catch (e) {
    src.status = 'error';
    src.error = e.message;
    save();
    emit('source', src);
    if (/Sign in to confirm|bot/i.test(e.message)) {
      throw new Error('YouTube pidió verificar que no eres un bot. Exporta tus cookies (cookies.txt) y ponlas en Ajustes → YTDLP_COOKIES_FILE, o sube el video como archivo.');
    }
    throw e;
  }
}

export async function ingestFile(tmpFile, originalName) {
  const id = uid('src_');
  const dir = path.join(DIRS.sources, id);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalName || '.mp4') || '.mp4';
  const file = path.join(dir, 'video' + ext);
  fs.renameSync(tmpFile, file);
  const meta = await probe(file);
  const src = { id, url: '', title: originalName || 'Video subido', channel: 'Tú', license: 'own', status: 'ready', createdAt: now(), dir, path: file, ...meta };
  db.sources.push(src);
  save();
  emit('source', src);
  return src;
}

/** Búsqueda de videos para el Scout. Usa la API de YouTube si hay clave (permite filtrar Creative Commons), si no yt-dlp. */
export async function searchVideos(query, { max = 8, creativeCommons = false, days = 7 } = {}) {
  const key = getSecret('YOUTUBE_API_KEY');
  if (key) {
    const after = new Date(Date.now() - days * 86400000).toISOString();
    const u = new URL('https://www.googleapis.com/youtube/v3/search');
    Object.entries({ part: 'snippet', q: query, type: 'video', order: 'viewCount', maxResults: String(Math.min(max, 25)), publishedAfter: after, key, relevanceLanguage: 'es' }).forEach(([k, v]) => u.searchParams.set(k, v));
    if (creativeCommons) u.searchParams.set('videoLicense', 'creativeCommon');
    const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const j = await res.json();
    return (j.items || []).map((it) => ({ id: it.id.videoId, title: it.snippet.title, channel: it.snippet.channelTitle, url: `https://www.youtube.com/watch?v=${it.id.videoId}`, publishedAt: it.snippet.publishedAt, license: creativeCommons ? 'creativeCommon' : '' }));
  }
  if (creativeCommons) throw new Error('Para filtrar solo videos Creative Commons necesitas YOUTUBE_API_KEY en Ajustes.');
  // resultados de búsqueda ordenados por fecha de subida (sp=CAI=)
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=CAI%3D`;
  const out = await run(BIN.ytdlp, ['--flat-playlist', '--playlist-end', String(max), '--print', '%(id)s\t%(title)s\t%(channel)s\t%(view_count)s', url], { timeoutMs: 90000 });
  return out.split('\n').filter(Boolean).map((l) => {
    const [id, title, channel, views] = l.split('\t');
    if (!/^[\w-]{11}$/.test(id)) return null;
    return { id, title, channel, views: Number(views) || 0, url: `https://www.youtube.com/watch?v=${id}` };
  }).filter(Boolean);
}
