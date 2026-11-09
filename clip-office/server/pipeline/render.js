// Render de clips verticales 1080x1920 listos para Shorts / Reels / TikTok.
import fs from 'node:fs';
import path from 'node:path';
import { BIN, DIRS } from '../config.js';
import { db } from '../db.js';
import { run, ffPath, clamp } from '../util.js';
import { buildAss } from './captions.js';
import { musicFile } from './music.js';

export const LAYOUTS = {
  blur: 'Fondo desenfocado + video al centro',
  crop: 'Pantalla completa (recorte 9:16)',
  zoom: 'Zoom fuerte al centro',
};

const timeRe = /time=(\d+):(\d+):([\d.]+)/;
const parseT = (l) => { const m = l.match(timeRe); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; };

export function encodeArgs(out) {
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-movflags', '+faststart', '-shortest', out];
}

export function overlayChain(assFile, dur, { progressBar = true } = {}) {
  let f = `ass=filename='${ffPath(assFile)}':fontsdir='${ffPath(DIRS.fonts)}'`;
  if (progressBar) f += `,drawbox=x=0:y=ih-14:w=iw*t/${dur.toFixed(2)}:h=14:color=0xC6FF00@0.95:t=fill`;
  return f;
}

export async function makeThumb(video, out, at = 1) {
  await run(BIN.ffmpeg, ['-y', '-v', 'error', '-ss', String(at), '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', out]);
}

export async function renderClip(clip, src, { onProgress } = {}) {
  const s = db.settings;
  const dir = path.join(DIRS.clips, clip.id);
  fs.mkdirSync(dir, { recursive: true });
  const start = clamp(clip.start, 0, Math.max(0, src.duration - 1));
  const dur = clamp(clip.end - start, 1, Math.max(1, src.duration - start));
  const assFile = path.join(dir, 'captions.ass');
  fs.writeFileSync(assFile, buildAss({
    words: clip.words || [], hook: clip.hook, commentary: clip.showCommentary === false ? '' : clip.commentary,
    handle: s.watermark ? s.handle : '', duration: dur, style: clip.captionStyle || s.captionStyle, captionY: clip.captionY ?? 0.72,
  }));

  const layout = clip.layout || s.layout;
  const zoom = clamp(Number(clip.zoom) || (layout === 'zoom' ? 1.9 : 1.22), 0.6, 3);
  const cropX = clamp(clip.cropX ?? 0.5, 0, 1);
  let v;
  if (layout === 'crop') {
    v = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*${cropX}:(ih-1920)/2,setsar=1[base]`;
  } else {
    const fgW = Math.round(1080 * zoom / 2) * 2;
    v = `[0:v]split=2[bg0][fg0];[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:3,eq=brightness=-0.14:saturation=1.25[bg];` +
      `[fg0]scale=${fgW}:-2[fg];[bg][fg]overlay=x='(W-w)*${cropX}':y='(H-h)/2-60',setsar=1[base]`;
  }
  v += `;[base]fps=30,${overlayChain(assFile, dur)}[v]`;

  const music = musicFile(clip.music ?? s.musicMood);
  const args = ['-y', '-v', 'info', '-ss', start.toFixed(3), '-t', dur.toFixed(3), '-i', src.path];
  if (music) args.push('-stream_loop', '-1', '-i', music);
  const mv = clamp(clip.musicVolume ?? s.musicVolume, 0, 1);
  const ov = clamp(clip.originalVolume ?? 1, 0, 2);
  const fadeOut = `afade=t=out:st=${Math.max(0, dur - 0.6).toFixed(2)}:d=0.6`;
  let a;
  if (src.hasAudio && music) a = `[0:a]volume=${ov}[a0];[1:a]atrim=0:${dur.toFixed(2)},volume=${mv}[m];[a0][m]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,${fadeOut}[a]`;
  else if (src.hasAudio) a = `[0:a]volume=${ov},loudnorm=I=-14:TP=-1.5:LRA=11,${fadeOut}[a]`;
  else if (music) a = `[1:a]atrim=0:${dur.toFixed(2)},volume=${Math.max(mv, 0.5)},${fadeOut}[a]`;
  else a = `anullsrc=r=44100:cl=stereo,atrim=0:${dur.toFixed(2)}[a]`;

  const out = path.join(dir, 'clip.mp4');
  const tmp = path.join(dir, 'clip.tmp.mp4');
  args.push('-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[a]', '-t', dur.toFixed(3), ...encodeArgs(tmp));
  await run(BIN.ffmpeg, args, { timeoutMs: 30 * 60000, onLine: (l) => { const x = parseT(l); if (x != null) onProgress?.(clamp((x / dur) * 100, 0, 99)); } });
  fs.renameSync(tmp, out);
  await makeThumb(out, path.join(dir, 'thumb.jpg'), Math.min(1.5, dur / 2));
  return { output: out, thumb: path.join(dir, 'thumb.jpg'), duration: dur };
}
