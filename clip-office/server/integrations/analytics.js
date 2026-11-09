// Métricas de crecimiento: YouTube, TikTok e Instagram (APIs oficiales o ingreso manual).
import { getSecret } from '../config.js';
import { db, now, save, emit } from '../db.js';
import { youtubeStats } from './youtube.js';

async function tiktokStats() {
  const token = getSecret('TIKTOK_ACCESS_TOKEN');
  if (!token) return null;
  const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,follower_count,likes_count,video_count', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok || j.error?.code !== 'ok') throw new Error(`TikTok: ${j.error?.message || res.status}`);
  const u = j.data.user;
  return { platform: 'tiktok', name: u.display_name, followers: u.follower_count, likes: u.likes_count, posts: u.video_count, views: null };
}

async function instagramStats() {
  const token = getSecret('INSTAGRAM_ACCESS_TOKEN');
  const id = getSecret('INSTAGRAM_USER_ID');
  if (!token || !id) return null;
  const base = `https://graph.facebook.com/v21.0/${id}`;
  const res = await fetch(`${base}?fields=username,followers_count,media_count&access_token=${token}`, { signal: AbortSignal.timeout(20000) });
  const j = await res.json();
  if (!res.ok) throw new Error(`Instagram: ${j.error?.message || res.status}`);
  let likes = 0, views = 0;
  try {
    const m = await (await fetch(`${base}/media?fields=like_count,media_type,insights.metric(views)&limit=25&access_token=${token}`)).json();
    for (const it of m.data || []) { likes += it.like_count || 0; views += it.insights?.data?.[0]?.values?.[0]?.value || 0; }
  } catch { /* insights opcionales */ }
  return { platform: 'instagram', name: j.username, followers: j.followers_count, posts: j.media_count, likes, views: views || null };
}

export async function refreshAnalytics() {
  const results = [];
  const errors = [];
  const acc = db.analytics.accounts;
  for (const [name, fn] of [['youtube', () => youtubeStats(acc.youtube)], ['tiktok', tiktokStats], ['instagram', instagramStats]]) {
    try { const r = await fn(); if (r) results.push(r); } catch (e) { errors.push(`${name}: ${e.message}`); }
  }
  const ts = now();
  for (const r of results) {
    db.analytics.snapshots.push({ ts, platform: r.platform, followers: r.followers, views: r.views, likes: r.likes, posts: r.posts, source: 'api' });
    if (r.videos) db.analytics.youtubeVideos = r.videos;
  }
  if (db.analytics.snapshots.length > 5000) db.analytics.snapshots.splice(0, db.analytics.snapshots.length - 5000);
  db.analytics.lastRefresh = ts;
  db.analytics.lastErrors = errors;
  save();
  emit('analytics', summary());
  const s = results.map((r) => `${r.platform}: ${fmt(r.followers)} seguidores${r.views != null ? `, ${fmt(r.views)} views` : ''}`).join(' · ');
  return { summary: s || (errors.length ? `No pude leer métricas: ${errors.join(' | ')}` : 'Aún no hay cuentas conectadas. Configúralas en Analytics.'), results, errors };
}

const fmt = (n) => (n == null ? '—' : Intl.NumberFormat('es', { notation: 'compact' }).format(n));

export function addManual({ platform, followers, views, likes, posts, ts }) {
  db.analytics.snapshots.push({ ts: ts || now(), platform, followers: num(followers), views: num(views), likes: num(likes), posts: num(posts), source: 'manual' });
  save();
  emit('analytics', summary());
}
const num = (v) => (v === '' || v == null ? null : Number(v));

export function summary() {
  const out = {};
  for (const p of ['youtube', 'tiktok', 'instagram']) {
    const snaps = db.analytics.snapshots.filter((s) => s.platform === p).sort((a, b) => a.ts.localeCompare(b.ts));
    const last = snaps[snaps.length - 1];
    const dayAgo = Date.now() - 86400000;
    const prev = [...snaps].reverse().find((s) => new Date(s.ts).getTime() <= dayAgo) || snaps[0];
    out[p] = {
      last: last || null,
      delta24h: last && prev ? { followers: (last.followers ?? 0) - (prev.followers ?? 0), views: (last.views ?? 0) - (prev.views ?? 0), likes: (last.likes ?? 0) - (prev.likes ?? 0) } : null,
      series: snaps.slice(-200),
    };
  }
  const clips = db.clips;
  return {
    platforms: out,
    accounts: db.analytics.accounts,
    lastRefresh: db.analytics.lastRefresh,
    lastErrors: db.analytics.lastErrors || [],
    youtubeVideos: db.analytics.youtubeVideos || [],
    production: {
      clips: clips.filter((c) => c.kind === 'gameplay').length,
      stories: clips.filter((c) => c.kind === 'story').length,
      ready: clips.filter((c) => c.status === 'ready' || c.status === 'approved').length,
      published: clips.filter((c) => c.status === 'published').length,
    },
  };
}
