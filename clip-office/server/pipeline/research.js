// Investigación de temas y datos curiosos (Claude + búsqueda web, Wikipedia, o banco propio).
import { askJson, llmAvailable } from '../llm.js';
import { db, uid, now, save, emit } from '../db.js';
import { fetchJson } from '../util.js';

/** Banco de datos curiosos verificados para cuando no hay internet/API. */
export const FACT_BANK = [
  { title: 'Los pulpos tienen tres corazones', summary: 'Dos corazones bombean sangre a las branquias y uno al resto del cuerpo. Además su sangre es azul porque usa hemocianina (con cobre) en lugar de hemoglobina.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Octopoda' },
  { title: 'Un día en Venus dura más que su año', summary: 'Venus tarda unos 243 días terrestres en girar sobre sí mismo, pero solo unos 225 en dar la vuelta al Sol. Y gira al revés que casi todos los planetas.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Venus_(planeta)' },
  { title: 'Cleopatra vivió más cerca del iPhone que de las pirámides', summary: 'La Gran Pirámide de Guiza se construyó hacia el 2560 a. C.; Cleopatra murió en el 30 a. C. Hay más tiempo entre la pirámide y Cleopatra que entre Cleopatra y hoy.', category: 'Historia', source: 'https://es.wikipedia.org/wiki/Cleopatra' },
  { title: 'La miel no se echa a perder', summary: 'Se han encontrado vasijas con miel en tumbas egipcias de miles de años. Su poca agua, su acidez y el peróxido de hidrógeno que contiene impiden que crezcan bacterias.', category: 'Ciencia', source: 'https://es.wikipedia.org/wiki/Miel' },
  { title: 'Los tiburones existen desde antes que los árboles', summary: 'Los primeros tiburones aparecieron hace unos 450 millones de años; los primeros árboles, hace unos 385 millones de años.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Selachimorpha' },
  { title: 'Hay más árboles en la Tierra que estrellas en la Vía Láctea', summary: 'Un estudio de 2015 estimó unos 3 billones de árboles en el planeta, mientras que la Vía Láctea tendría entre 100 000 y 400 000 millones de estrellas.', category: 'Naturaleza', source: 'https://www.nature.com/articles/nature14967' },
  { title: 'El corazón de una ballena azul pesa como un auto pequeño', summary: 'El corazón de la ballena azul, el animal más grande que ha existido, pesa alrededor de 180 kilos y su latido se puede detectar a kilómetros con sonar.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Balaenoptera_musculus' },
  { title: 'En el espacio no puedes llorar como en la Tierra', summary: 'Sin gravedad, las lágrimas no caen: forman una burbuja de agua pegada al ojo. El astronauta Chris Hadfield lo mostró desde la Estación Espacial.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Chris_Hadfield' },
  { title: 'Machu Picchu se construyó sin mortero', summary: 'Los incas encajaron las piedras con tal precisión que en muchos muros no cabe ni una hoja. Esta técnica hace que las piedras "bailen" en un sismo y vuelvan a su lugar.', category: 'Historia', source: 'https://es.wikipedia.org/wiki/Machu_Picchu' },
  { title: 'Las líneas de Nazca solo se entienden desde el aire', summary: 'En el desierto de Nazca (Perú) hay figuras gigantes de hasta 300 metros, como un colibrí y un mono, hechas hace unos 2000 años. Siguen siendo uno de los grandes misterios.', category: 'Misterios', source: 'https://es.wikipedia.org/wiki/L%C3%ADneas_de_Nazca' },
  { title: 'Una cucharadita de estrella de neutrones pesaría millones de toneladas', summary: 'Las estrellas de neutrones son tan densas que una cucharadita de su material pesaría unos mil millones de toneladas en la Tierra.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Estrella_de_neutrones' },
  { title: 'Los flamencos son rosados por lo que comen', summary: 'Nacen grises. Su color viene de los carotenoides de las algas y crustáceos que comen; sin esa dieta, pierden el rosado.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Phoenicopteridae' },
  { title: 'El Monte Everest crece cada año', summary: 'La placa india sigue empujando contra la euroasiática, y el Everest sube unos milímetros por año.', category: 'Naturaleza', source: 'https://es.wikipedia.org/wiki/Monte_Everest' },
  { title: 'Tu cuerpo tiene más bacterias que estrellas tiene la Vía Láctea', summary: 'Se estima que una persona tiene unos 38 billones de bacterias, aproximadamente tantas como células humanas.', category: 'Cuerpo humano', source: 'https://es.wikipedia.org/wiki/Microbiota_normal' },
  { title: 'El primer video de YouTube dura 19 segundos', summary: '"Me at the zoo" fue subido el 23 de abril de 2005 por Jawed Karim, cofundador de YouTube, frente a los elefantes del zoológico de San Diego.', category: 'Internet', source: 'https://es.wikipedia.org/wiki/Me_at_the_zoo' },
  { title: 'Los ajolotes pueden regenerar partes de su cerebro', summary: 'El ajolote mexicano regenera patas, cola, partes del corazón y hasta del cerebro sin dejar cicatriz. Por eso es estudiado en todo el mundo.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Ambystoma_mexicanum' },
  { title: 'Un rayo es cinco veces más caliente que el Sol', summary: 'Un rayo puede calentar el aire a unos 30 000 °C, mientras que la superficie del Sol está a unos 5500 °C.', category: 'Ciencia', source: 'https://es.wikipedia.org/wiki/Rayo' },
  { title: 'La Gran Muralla China no se ve a simple vista desde el espacio', summary: 'Es un mito: es muy larga pero muy angosta y del color del terreno. Astronautas como Yang Liwei confirmaron que no la vieron.', category: 'Mitos', source: 'https://es.wikipedia.org/wiki/Gran_Muralla_China' },
  { title: 'Los koalas duermen hasta 22 horas al día', summary: 'Su dieta de eucalipto aporta muy poca energía y es difícil de digerir, así que pasan la mayor parte del día durmiendo.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Phascolarctos_cinereus' },
  { title: 'Los plátanos son bayas, pero las fresas no', summary: 'Para la botánica, una baya nace de una sola flor con un solo ovario y tiene las semillas dentro. El plátano cumple eso; la fresa no, porque sus "semillitas" de afuera son en realidad sus frutos.', category: 'Ciencia', source: 'https://es.wikipedia.org/wiki/Baya' },
  { title: 'Los wombats hacen popó en forma de cubo', summary: 'Este marsupial australiano produce heces cúbicas gracias a la forma en que se contraen las paredes de su intestino. Las usa para marcar territorio sobre rocas y troncos sin que se rueden.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Vombatidae' },
  { title: 'La Luna se aleja de la Tierra cada año', summary: 'Medidas con láser rebotado en espejos que dejaron las misiones Apolo muestran que la Luna se aleja unos 3,8 centímetros por año.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Luna' },
  { title: 'Saturno flotaría en una piscina gigante', summary: 'Saturno es el planeta menos denso del sistema solar: su densidad media es menor que la del agua, así que en teoría flotaría si hubiera una piscina lo bastante grande.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Saturno_(planeta)' },
  { title: 'La Torre Eiffel crece en verano', summary: 'El hierro se dilata con el calor. En los días más calurosos la Torre Eiffel puede ganar varios centímetros de altura y luego volver a encogerse con el frío.', category: 'Lugares', source: 'https://es.wikipedia.org/wiki/Torre_Eiffel' },
  { title: 'En Perú hay más de 3000 variedades de papa', summary: 'La papa se domesticó en los Andes hace miles de años, cerca del lago Titicaca. Solo en Perú se conocen más de 3000 variedades de todos los colores y formas.', category: 'Latinoamérica', source: 'https://es.wikipedia.org/wiki/Solanum_tuberosum' },
  { title: 'El corazón de un colibrí late más de 1000 veces por minuto', summary: 'Los colibríes tienen el metabolismo más acelerado de las aves. En pleno vuelo su corazón puede superar los 1000 latidos por minuto, y de noche entran en un "modo ahorro" llamado torpor.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Trochilidae' },
  { title: 'La luz del Sol que ves tiene 8 minutos de antigüedad', summary: 'La luz tarda unos 8 minutos y 20 segundos en viajar del Sol a la Tierra. Si el Sol desapareciera, seguiríamos viéndolo durante ese tiempo.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Sol' },
  { title: 'Existen ranas transparentes', summary: 'Las ranas de cristal de Centro y Sudamérica tienen la piel del vientre tan transparente que se le ven el corazón y los órganos. Algunas se vuelven aún más transparentes al dormir.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Centrolenidae' },
  { title: 'Ningún puente cruza el río Amazonas', summary: 'A lo largo de su cauce principal no hay ni un solo puente. Atraviesa selva poco poblada, sus orillas cambian con las crecidas y la gente cruza en barco.', category: 'Latinoamérica', source: 'https://es.wikipedia.org/wiki/R%C3%ADo_Amazonas' },
  { title: 'En el desierto de Atacama prueban robots para Marte', summary: 'Algunas zonas de Atacama, en Chile, están entre las más secas del planeta. Su suelo se parece tanto al de Marte que la NASA ha probado ahí equipos y robots para misiones marcianas.', category: 'Latinoamérica', source: 'https://es.wikipedia.org/wiki/Desierto_de_Atacama' },
  { title: 'Un Game Boy sobrevivió a un bombardeo y sigue funcionando', summary: 'Durante la Guerra del Golfo un Game Boy quedó quemado en un bombardeo. Aun así encendía y Nintendo lo exhibió funcionando con Tetris en su tienda de Nueva York.', category: 'Videojuegos', source: 'https://es.wikipedia.org/wiki/Game_Boy' },
  { title: 'Las mariposas saborean con las patas', summary: 'Las mariposas tienen receptores de sabor en las patas. Al posarse en una hoja "la prueban" para saber si sirve para poner sus huevos.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Lepidoptera' },
  { title: 'Los tardígrados sobrevivieron al espacio exterior', summary: 'Estos animales microscópicos fueron expuestos al vacío y la radiación del espacio en 2007 en la misión FOTON-M3, y algunos sobrevivieron y hasta se reprodujeron al volver.', category: 'Ciencia', source: 'https://es.wikipedia.org/wiki/Tardigrada' },
  { title: 'Los perezosos aguantan la respiración 40 minutos', summary: 'Pese a ser lentísimos en tierra, los perezosos nadan bien y pueden bajar su ritmo cardíaco para aguantar hasta unos 40 minutos bajo el agua.', category: 'Animales', source: 'https://es.wikipedia.org/wiki/Folivora' },
  { title: 'En Mercurio un día dura dos años', summary: 'Mercurio da la vuelta al Sol en 88 días, pero entre un amanecer y el siguiente pasan unos 176 días terrestres: un "día" solar allí dura dos de sus años.', category: 'Espacio', source: 'https://es.wikipedia.org/wiki/Mercurio_(planeta)' },
  { title: 'Pong fue uno de los primeros videojuegos comerciales exitosos', summary: 'Atari lanzó Pong en 1972: dos paletas y una pelota. Su éxito en bares y salas de juego ayudó a crear la industria de los videojuegos que hoy mueve miles de millones.', category: 'Videojuegos', source: 'https://es.wikipedia.org/wiki/Pong' },
  { title: 'El lago Titicaca es el lago navegable más alto del mundo', summary: 'Está a unos 3812 metros sobre el nivel del mar entre Perú y Bolivia, y en él viven los uros en islas flotantes hechas de totora.', category: 'Lugares', source: 'https://es.wikipedia.org/wiki/Lago_Titicaca' },
];

const TOPIC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['topics'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'summary', 'category', 'source', 'viralScore', 'angle'],
        properties: { title: { type: 'string' }, summary: { type: 'string' }, category: { type: 'string' }, source: { type: 'string' }, viralScore: { type: 'integer' }, angle: { type: 'string' } },
      },
    },
  },
};

function viralScore(t) {
  let s = 55;
  if (/\d/.test(t.title + t.summary)) s += 8;
  if (/(m[aá]s|nunca|nadie|mito|secreto|misterio|imposible|r[eé]cord|gigante|millones|billones|azul|al rev[eé]s)/i.test(t.title)) s += 12;
  if (t.title.length < 60) s += 5;
  return Math.min(97, s + Math.floor(Math.random() * 10));
}

async function wikipedia(query, count) {
  const lang = db.settings.language || 'es';
  if (query) {
    const u = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${count}&srsearch=${encodeURIComponent(query)}`;
    const j = await fetchJson(u);
    const titles = (j.query?.search || []).map((r) => r.title);
    const out = [];
    for (const title of titles) {
      try {
        const s = await fetchJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        if (s.extract) out.push({ title: s.title, summary: s.extract.slice(0, 600), category: query, source: s.content_urls?.desktop?.page || '', image: s.originalimage?.source || s.thumbnail?.source || '' });
      } catch { /* sigue */ }
    }
    return out;
  }
  const d = new Date();
  const feed = await fetchJson(`https://api.wikimedia.org/feed/v1/wikipedia/${lang}/featured/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`);
  const out = [];
  // evita tragedias: no son "datos curiosos" y la audiencia no lo espera
  const DARK = /(atentad|muert|asesin|masacre|bomb|terror|genocid|matanza|v[ií]ctimas|guerra|ejecut|accidente|naufrag|terremoto|tiroteo|holocausto)/i;
  for (const ev of (feed.onthisday || []).filter((e) => !DARK.test(e.text + (e.pages?.[0]?.extract || ''))).slice(0, count)) {
    const p = ev.pages?.[0];
    out.push({ title: `Un día como hoy (${ev.year}): ${ev.text.slice(0, 80)}`, summary: `${ev.text} ${p?.extract || ''}`.slice(0, 600), category: 'Historia', source: p?.content_urls?.desktop?.page || '', image: p?.originalimage?.source || '' });
  }
  return out;
}

/** Investiga temas. query vacío = temas virales variados. */
export async function researchTopics(query = '', count = 6, { onProgress } = {}) {
  let found = [];
  let method = 'banco';
  if (llmAvailable()) {
    onProgress?.(20, 'Buscando en internet con Claude');
    try {
      const recent = db.topics.slice(-40).map((t) => t.title).join(' | ');
      const r = await askJson({
        system: 'Eres investigadora para un canal de Shorts de datos curiosos en español latino. Solo propones datos REALES y verificables, con una URL de fuente confiable. Nada de rumores ni datos inventados.',
        prompt: `Encuentra ${count} datos curiosos ${query ? `sobre: "${query}"` : 'variados (historia, espacio, animales, ciencia, misterios, Latinoamérica, internet, videojuegos)'} que sorprendan y hagan que la gente quiera ver hasta el final. Evita repetir: ${recent || 'ninguno'}.\nPara cada uno: title (el dato en una frase impactante), summary (3-4 frases con contexto y cifras), category, source (URL), viralScore (0-100) y angle (cómo contarlo para enganchar).`,
        schema: TOPIC_SCHEMA,
        effort: 'medium',
        webSearch: true,
      });
      found = r.topics || [];
      method = 'claude+web';
    } catch (e) { console.warn('[research/claude]', e.message); }
  }
  if (!found.length) {
    // Sin Claude: primero el banco verificado (lo que coincide con el tema), luego Wikipedia, y si no, el banco al azar.
    const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const used = new Set(db.topics.map((t) => t.title));
    const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);
    const fresh = FACT_BANK.filter((f) => !used.has(f.title));
    const keys = norm(query || '').split(/\W+/).filter((k) => k.length > 3).map((k) => k.replace(/(es|s)$/, ''));
    const matches = keys.length ? fresh.filter((f) => keys.some((k) => norm(f.title + ' ' + f.summary + ' ' + f.category).includes(k))) : shuffle(fresh);
    found = shuffle(matches).slice(0, count);
    method = 'banco';
    if (found.length < count) {
      onProgress?.(40, 'Consultando Wikipedia');
      try { const wiki = await wikipedia(query, count - found.length); if (wiki.length) { found = found.concat(wiki); method = found.length > wiki.length ? 'banco+wikipedia' : 'wikipedia'; } } catch (e) { console.warn('[research/wiki]', e.message); }
    }
    if (!found.length) found = shuffle(fresh.length ? fresh : FACT_BANK).slice(0, count);
  }
  const topics = found.slice(0, count).map((t) => ({
    id: uid('top_'), title: t.title, summary: t.summary, category: t.category || 'General', source: t.source || '',
    image: t.image || '', angle: t.angle || '', viralScore: t.viralScore || viralScore(t), method, query, status: 'nuevo', createdAt: now(),
  }));
  db.topics.push(...topics);
  save();
  topics.forEach((t) => emit('topic', t));
  return topics;
}
