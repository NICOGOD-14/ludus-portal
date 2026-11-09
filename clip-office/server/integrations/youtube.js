// YouTube: estadísticas públicas (API key) y subida de videos (OAuth de Google).
import fs from 'node:fs';
import { getSecret, PUBLIC_URL } from '../config.js';
import { db, save } from '../db.js';

const REDIRECT = () => `${PUBLIC_URL}/api/youtube/callback`;

export function youtubeAuthUrl() {
  const id = getSecret('YOUTUBE_CLIENT_ID');
  if (!id) throw new Error('Falta YOUTUBE_CLIENT_ID en Ajustes');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', id);
  u.searchParams.set('redirect_uri', REDIRECT());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly');
  return u.toString();
}

async function tokenRequest(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getSecret('YOUTUBE_CLIENT_ID'), client_secret: getSecret('YOUTUBE_CLIENT_SECRET'), ...body }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${j.error_description || j.error}`);
  return j;
}

export async function youtubeCallback(code) {
  const j = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT() });
  db.youtubeAuth = { refresh_token: j.refresh_token, access_token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  save();
}

async function accessToken() {
  const a = db.youtubeAuth;
  if (!a?.refresh_token) throw new Error('Conecta tu canal de YouTube en Analytics → "Conectar YouTube para publicar"');
  if (a.access_token && a.expires > Date.now() + 60000) return a.access_token;
  const j = await tokenRequest({ refresh_token: a.refresh_token, grant_type: 'refresh_token' });
  a.access_token = j.access_token;
  a.expires = Date.now() + j.expires_in * 1000;
  save();
  return a.access_token;
}

export function youtubeConnected() { return Boolean(db.youtubeAuth?.refresh_token); }

/** Subida reanudable. privacy: private | unlisted | public */
export async function uploadToYoutube(clip, { privacy = 'private', onProgress } = {}) {
  const token = await accessToken();
  const tags = (clip.hashtags || []).map((h) => h.replace(/^#/, '')).slice(0, 15);
  let description = clip.description || '';
  if (!/#shorts/i.test(description)) description += '\n#Shorts';
  const meta = {
    snippet: { title: (clip.title || clip.hook).slice(0, 100), description: description.slice(0, 4900), tags, categoryId: clip.kind === 'story' ? '27' : '20', defaultLanguage: db.settings.language },
    status: { privacyStatus: privacy, selfDeclaredMadeForKids: false, containsSyntheticMedia: clip.kind === 'story' },
  };
  const size = fs.statSync(clip.output).size;
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`YouTube (inicio): ${init.status} ${(await init.text()).slice(0, 300)}`);
  const loc = init.headers.get('location');
  onProgress?.(10);
  const res = await fetch(loc, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: fs.readFileSync(clip.output) });
  const j = await res.json();
  if (!res.ok) throw new Error(`YouTube (subida): ${res.status} ${JSON.stringify(j).slice(0, 300)}`);
  onProgress?.(100);
  return { id: j.id };
}

/** Estadísticas públicas del canal + últimos videos (requiere YOUTUBE_API_KEY). */
export async function youtubeStats(handle) {
  const key = getSecret('YOUTUBE_API_KEY');
  if (!key || !handle) return null;
  const h = handle.startsWith('@') ? handle : `@${handle}`;
  const isId = /^UC[\w-]{20,}$/.test(handle);
  const u = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,contentDetails&${isId ? `id=${handle}` : `forHandle=${encodeURIComponent(h)}`}&key=${key}`;
  const j = await (await fetch(u, { signal: AbortSignal.timeout(20000) })).json();
  const ch = j.items?.[0];
  if (!ch) throw new Error(`No encontré el canal ${handle}`);
  const st = ch.statistics;
  let videos = [];
  try {
    const pl = ch.contentDetails.relatedPlaylists.uploads;
    const items = await (await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=25&playlistId=${pl}&key=${key}`)).json();
    const ids = (items.items || []).map((i) => i.contentDetails.videoId).join(',');
    if (ids) {
      const v = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&key=${key}`)).json();
      videos = (v.items || []).map((x) => ({ id: x.id, title: x.snippet.title, publishedAt: x.snippet.publishedAt, thumb: x.snippet.thumbnails?.default?.url, views: +x.statistics.viewCount || 0, likes: +x.statistics.likeCount || 0, comments: +x.statistics.commentCount || 0 }));
    }
  } catch (e) { console.warn('[yt videos]', e.message); }
  return {
    platform: 'youtube', name: ch.snippet.title, followers: +st.subscriberCount || 0, views: +st.viewCount || 0,
    likes: videos.reduce((a, v) => a + v.likes, 0), posts: +st.videoCount || 0, videos,
  };
}
