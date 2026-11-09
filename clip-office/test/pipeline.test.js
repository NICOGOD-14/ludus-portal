// Pruebas de las piezas puras del pipeline (no requieren red ni API keys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.CLIP_OFFICE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'clipoffice-test-'));

const { parseVtt, wordsIn, timedText } = await import('../server/pipeline/transcript.js');
const { chunkWords, buildAss } = await import('../server/pipeline/captions.js');
const { restorePunctuation, estimateWords } = await import('../server/pipeline/tts.js');
const { segmentTimes, templateScript, narrationText } = await import('../server/pipeline/story.js');
const { youtubeId, isDirectMedia } = await import('../server/pipeline/ingest.js');
const { templateCopy, complianceCheck } = await import('../server/pipeline/copywriter.js');

const AUTO_VTT = `WEBVTT
Kind: captions
Language: es

00:00:01.000 --> 00:00:03.000 align:start position:0%
 
mira<00:00:01.400><c> esto</c><00:00:01.900><c> en</c><00:00:02.200><c> GTA</c>

00:00:03.000 --> 00:00:03.010 align:start position:0%
mira esto en GTA
 

00:00:03.010 --> 00:00:05.000 align:start position:0%
mira esto en GTA
no<00:00:03.500><c> puede</c><00:00:04.000><c> ser</c>
`;

test('parseVtt lee subtítulos automáticos de YouTube palabra por palabra', () => {
  const w = parseVtt(AUTO_VTT);
  assert.deepEqual(w.map((x) => x.text), ['mira', 'esto', 'en', 'GTA', 'no', 'puede', 'ser']);
  assert.equal(w[0].start, 1);
  assert.equal(w[1].start, 1.4);
  assert.ok(w.every((x) => x.end > x.start));
});

test('parseVtt reparte tiempos en subtítulos manuales', () => {
  const w = parseVtt('WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhola a todos\n');
  assert.equal(w.length, 3);
  assert.ok(Math.abs(w[1].start - 0.667) < 0.01);
});

test('wordsIn devuelve tiempos relativos al clip', () => {
  const w = wordsIn(parseVtt(AUTO_VTT), 1.4, 3.45);
  assert.equal(w[0].text, 'esto');
  assert.equal(w[0].start, 0);
  assert.ok(w.some((x) => x.text === 'no'));
  assert.ok(!w.some((x) => x.text === 'puede'));
  assert.match(timedText(parseVtt(AUTO_VTT)), /^\[1s\] mira/);
});

test('chunkWords agrupa en frases cortas y corta en puntuación', () => {
  const words = 'Hola, esto es GTA seis y es increíble'.split(' ').map((t, i) => ({ text: t, start: i * 0.3, end: i * 0.3 + 0.25 }));
  const ch = chunkWords(words);
  assert.deepEqual(ch[0].map((x) => x.text), ['Hola,']);
  assert.ok(ch.every((c) => c.length <= 3));
});

test('buildAss genera karaoke, hook y quita emojis', () => {
  const ass = buildAss({ words: [{ text: 'hola', start: 0, end: 0.5 }, { text: 'mundo', start: 0.5, end: 1 }], hook: 'Mira esto 🔥', duration: 5, handle: '@yo' });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Hook,,0,0,0,,.*MIRA ESTO$/m);
  assert.ok(!ass.includes('🔥'));
  assert.equal((ass.match(/,Cap,,/g) || []).length, 2);
  assert.match(ass, /\\c&H0000FFC6&/i);
});

test('restorePunctuation devuelve signos al texto narrado', () => {
  const w = restorePunctuation([{ text: 'Sabías', start: 0, end: 1 }, { text: 'que', start: 1, end: 2 }], '¿Sabías que?');
  assert.deepEqual(w.map((x) => x.text), ['¿Sabías', 'que?']);
});

test('estimateWords cubre toda la duración', () => {
  const w = estimateWords('uno dos tres. cuatro', 4);
  assert.equal(w.length, 4);
  assert.ok(w[3].end <= 4);
});

test('segmentTimes reparte escenas sin huecos', () => {
  const topic = { title: 'Los pulpos tienen tres corazones', summary: 'Dos bombean a las branquias. Uno al cuerpo. Su sangre es azul.', source: 'x' };
  const script = templateScript(topic);
  const text = narrationText(script);
  const words = estimateWords(text, 20);
  const seg = segmentTimes(script, words, 21);
  assert.equal(seg.length, script.scenes.length);
  const total = seg.reduce((a, s) => a + s.dur, 0);
  assert.ok(Math.abs(total - 21) < 0.01);
  assert.ok(seg.every((s) => s.dur > 1));
  assert.match(script.hook, /^¿Sabías que los pulpos/);
});

test('reconoce links de YouTube y MP4 directos', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=tJbzMqJGH4k&t=3'), 'tJbzMqJGH4k');
  assert.equal(youtubeId('https://youtu.be/tJbzMqJGH4k'), 'tJbzMqJGH4k');
  assert.equal(youtubeId('https://youtube.com/shorts/tJbzMqJGH4k'), 'tJbzMqJGH4k');
  assert.ok(isDirectMedia('https://x.com/a/video.mp4?sig=1'));
  assert.ok(!isDirectMedia('https://www.youtube.com/watch?v=x'));
});

test('copy por plantilla y revisión de copyright', () => {
  const src = { title: 'GTA 6 gameplay Vice City', channel: 'Otro canal', url: 'https://youtu.be/abcdefghijk', license: '' };
  const c = templateCopy(src, 0);
  assert.ok(c.hashtags.includes('#GTA6'));
  assert.match(c.description, /Fuente: Otro canal/);
  const risk = complianceCheck({ start: 0, end: 30, music: 'hype', commentary: '' }, { ...src, hasAudio: true });
  assert.equal(risk.risk, 'alto');
  const own = complianceCheck({ start: 0, end: 30, music: 'hype' }, { license: 'own' });
  assert.equal(own.risk, 'bajo');
});

const { wrap, layoutMessages, timeline, buildChatAss, templateChat, normalizeChat } = await import('../server/pipeline/chatstory.js');

test('historias en chat: wrap, maquetado y línea de tiempo', () => {
  assert.ok(wrap('esto es un mensaje bastante largo que debe partirse en varias líneas', 24).every((l) => l.length <= 24));
  const chat = templateChat('excel');
  assert.ok(chat.messages.length >= 8);
  const L = layoutMessages(chat);
  assert.equal(L.length, chat.messages.length);
  for (let i = 1; i < L.length; i++) assert.ok(L[i].y > L[i - 1].y + L[i - 1].h - 1);
  const { times, total } = timeline(chat);
  assert.ok(times.every((t, i) => i === 0 || t.start > times[i - 1].start));
  assert.ok(total > times.at(-1).start);
  const ass = buildChatAss(chat, { times, total, handle: '@yo' });
  assert.match(ass, /Style: Msg,Montserrat/);
  assert.match(ass, /\\move\(/); // hay scroll en historias largas
});

test('normalizeChat descarta mensajes de personajes inexistentes', () => {
  const c = normalizeChat({ characters: [{ name: 'Ana' }], messages: [{ from: 'Ana', text: 'hola' }, { from: 'Nadie', text: 'x' }, ['Ana', 'chau']] });
  assert.deepEqual(c.messages.map((m) => m.text), ['hola', 'chau']);
});

test('efectos de trama automáticos en historias en chat', async () => {
  const { resolveSfx } = await import('../server/pipeline/chatstory.js');
  const fx = resolveSfx([
    { from: 'A', text: 'hola' }, { from: 'B', text: '...' }, { from: 'A', text: 'ok' }, { from: 'A', text: 'bien' },
    { from: 'B', text: 'NO PUEDE SER' }, { from: 'A', text: 'jajaja', sfx: 'none' }, { from: 'B', text: 'fin', sfx: 'drama' }, { from: 'A', text: 'remate' },
  ]);
  assert.deepEqual(fx, [null, 'grillos', null, null, 'sorpresa', null, 'drama', 'remate']);
});
