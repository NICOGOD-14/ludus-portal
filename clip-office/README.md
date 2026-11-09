# 🏢 Ludus Clip Office

Una oficina 3D con 11 agentes de IA que producen clips verticales (9:16) para **YouTube Shorts, TikTok e Instagram Reels**, y videos de **datos curiosos** con voz, ilustraciones generadas por IA, subtítulos animados y música sin copyright.

Entras a la oficina, haces clic en cualquier trabajador, ves qué está haciendo en su monitor y le hablas por chat o con tu voz.

---

## ⚡ La forma más fácil (Windows)

1. Descomprime el .zip.
2. Entra a la carpeta `clip-office` y dale doble clic a **`ABRIR-OFICINA.bat`**.
3. Si Windows pregunta "¿Permitir cambios?", di que **Sí**. Instala solo Node.js, Python y FFmpeg si no los tienes. Si te pide cerrar y volver a abrir, hazlo.
4. Se abre la oficina en tu navegador y, en la ventana negra, aparece **tu link para el celular** con su contraseña.

## 🚀 Instalación manual (una sola vez)

Necesitas: **Node.js 20+** ([nodejs.org](https://nodejs.org)), **Python 3** ([python.org](https://python.org), marca "Add Python to PATH") y **FFmpeg**.

**Windows**
```bat
winget install --id Gyan.FFmpeg -e
cd clip-office
npm run setup
```
Luego, cada vez que la quieras usar: doble clic en **`iniciar-windows.bat`**.

**Mac**
```bash
brew install ffmpeg node python
cd clip-office && npm run setup
```
Luego: doble clic en **`iniciar-mac.command`** (o `npm start`).

Abre **http://localhost:4321**.

`npm run setup` instala solo `yt-dlp` (descarga de videos) y `edge-tts` (voz neural gratuita en español).

### Lo que te pido que configures (en ⚙️ Ajustes dentro de la app)

| Clave | ¿Para qué? | ¿Obligatoria? |
|---|---|---|
| `ANTHROPIC_API_KEY` | El "cerebro" de los agentes (Claude): conversan de verdad, eligen los momentos más virales, escriben hooks y guiones, e investigan en internet. Consíguela en [console.anthropic.com](https://console.anthropic.com). | Muy recomendada. Sin ella funcionan en **modo básico** (reglas + plantillas). |
| `YOUTUBE_API_KEY` | Métricas de tu canal y búsqueda de videos **Creative Commons**. Google Cloud → APIs → YouTube Data API v3. | Recomendada |
| `YOUTUBE_CLIENT_ID` / `SECRET` | Publicar en tu canal desde la app. Credencial OAuth tipo "Aplicación web" con redirección `http://localhost:4321/api/youtube/callback`. | Para publicar |
| `OPENAI_API_KEY` | Transcribir con Whisper los videos que no traen subtítulos. | Opcional |
| `PEXELS_API_KEY` | Fotos de stock gratuitas. | Opcional |
| `TIKTOK_ACCESS_TOKEN`, `INSTAGRAM_ACCESS_TOKEN` + `INSTAGRAM_USER_ID` | Leer seguidores/likes automáticamente. | Opcional (también puedes anotarlos a mano) |
| `YTDLP_COOKIES_FILE` | Si YouTube dice "confirma que no eres un bot": exporta tus cookies a `cookies.txt` (extensión "Get cookies.txt LOCALLY") y pon la ruta aquí. | Solo si te pasa |

Las claves se guardan **solo en tu PC** (`data/secrets.json`), nunca en el repositorio.

---

## 👥 El equipo

| | Agente | Rol | Qué hace |
|---|---|---|---|
| 🎬 | **Valeria Ríos** | Directora Creativa | Le hablas a ella y reparte el trabajo. Puede usar todas las herramientas. |
| 📡 | **Diego "Radar" Salas** | Cazador de Tendencias | Busca gameplays nuevos de GTA 6 y videos virales, los descarga. |
| 🔎 | **Lucía Paredes** | Investigadora | Encuentra datos curiosos reales con su fuente. |
| ✍️ | **Mateo Quispe** | Guionista y Hooks | Escribe la frase de los primeros 2 segundos, títulos y guiones. |
| ✂️ | **Sofía Valdivia** | Editora de Video | Elige los mejores momentos, reencuadra a 9:16 y renderiza. |
| 💬 | **Bruno Takahashi** | Subtítulos | Transcribe y pone subtítulos karaoke palabra por palabra. |
| 🎨 | **Camila Torres** | Directora de Arte | Genera ilustraciones 3D con IA o busca fotos libres. |
| 🎧 | **Nico Fernández** | Voz y Música | Voz neural (o **tu voz** grabada) y música original sin copyright. |
| 🚀 | **Andrés Castillo** | Community y Publicación | Descripciones, hashtags y subida a YouTube. |
| 📈 | **Renata Vega** | Analista de Datos | Mide views, likes y seguidores en YouTube, TikTok e Instagram. |
| ⚖️ | **Tomás León** | Copyright y Monetización | Revisa cada clip y te avisa de riesgos antes de publicar. |

---

## 🎮 Cómo se usa

**Clips de un video (GTA 6 u otro):** pega el link en la Oficina ("Pedido rápido a Valeria") o en 🎬 Estudio → *Crear*. Funciona con YouTube, TikTok, Twitch, Kick, X y MP4 directos. También puedes **subir tu propio gameplay** (la opción más segura para monetizar).

Qué pasa: Diego descarga → Bruno transcribe → Sofía detecta los momentos con más acción (picos de audio, cambios de escena, lo que se dice y, con Claude, lo más viral) → Mateo escribe hook, título y descripción → Tomás revisa derechos → Sofía renderiza en 1080×1920 con subtítulos, barra de progreso, tu @handle y música.

**Editar y previsualizar (🎬 Estudio):**
- Vista previa **en vivo** tipo celular: ves el encuadre, el hook y los subtítulos mientras ajustas.
- Arrastra los bordes de la línea de tiempo para recortar, o usa "Inicio aquí / Fin aquí".
- Cambia el encuadre (desenfocado, pantalla completa, zoom), la posición, el estilo de subtítulos, la música y los volúmenes.
- Corrige cualquier palabra de los subtítulos.
- *Guardar y renderizar* → *Aprobar* → *Descargar MP4* o *Subir a YouTube* (privado, no listado o público).

**Datos curiosos (🔎):** pide un tema ("misterios del Perú", "el espacio") o déjalo vacío. Lucía investiga, y con *Crear video* Mateo escribe un guion con hook, Camila genera una ilustración por escena, Nico narra y Sofía monta todo con efecto Ken Burns y transiciones. Puedes cambiar cada imagen (render IA, foto real o URL), editar el texto, cambiar la voz o **grabar tu voz** desde el navegador.

**Historias en chat (💬, en la pestaña Datos y Chats):** escribe una idea ("el jefe descubre que el practicante usa IA") o déjala vacía. Mateo escribe una conversación original con remate final y Sofía la anima mensaje por mensaje: indicador "escribiendo…", scroll, sonido de notificación y música. Hay 4 estilos (oscuro tipo oficina, WhatsApp, iMessage y Ludus neón) y la opción de poner una **voz distinta a cada personaje**. En el Estudio puedes editar personajes y mensajes, reordenarlos y ver la vista previa en vivo antes de renderizar. Es contenido 100% original, el formato más seguro para monetizar. También puedes pedírsela a Valeria: "hazme una historia en chat estilo WhatsApp sobre…".

**Hablarle a un agente:** clic en su escritorio (o en la lista). Pestañas: 💬 Chat (con 🎙️ para dictar por voz y opción de escuchar la respuesta), 👤 Perfil (habilidades y qué pedirle) y 🛠️ Trabajo (lo que hace ahora y su bitácora).

---

## 🌐 Abrir la oficina desde el celular (link público gratis)

Doble clic en **`iniciar-con-link-windows.bat`** (Mac: `iniciar-con-link-mac.command`, o `npm run online`). La primera vez descarga solo **Cloudflare Tunnel** y crea una contraseña. En la ventana negra aparecerá TU link real (este de abajo es solo un ejemplo, no lo copies):

```
🌐 TU OFICINA EN INTERNET:  https://(cuatro-palabras-distintas-cada-vez).trycloudflare.com
🔑 Contraseña:  (la tuya, generada al azar)
```

Abre ese link desde el celular o cualquier PC, pon la contraseña y listo. En la app también aparece el botón **🌐 Link público** arriba para copiarlo.

- Funciona **mientras tu laptop y esa ventana estén encendidas**. Si la cierras, el link deja de funcionar.
- El link **cambia cada vez** que lo vuelves a abrir (es la versión gratis y sin cuenta de Cloudflare).
- Desde tu propia laptop (`http://localhost:4321`) no pide contraseña; desde el link, siempre. Cámbiala en ⚙️ Ajustes → `APP_PASSWORD`.
- Si no conecta, puede ser que la red (por ejemplo la de la universidad) bloquee el túnel: prueba con los datos del celular o el wifi de tu casa.

---

## ⏰ Funcionando 24/7

En ⏰ Automatización hay reglas que corren solas mientras el programa está abierto:

- **Datos curiosos del día** (activa): cada 12 h investiga y produce 1 video.
- **Historia en chat diaria** (activa): cada 24 h escribe y anima una historia en chat original.
- **Métricas cada hora** (activa).
- **GTA 6: gameplays nuevos** (desactivada por defecto): cada 3 h busca videos nuevos y saca 3 clips de cada uno. Actívala cuando decidas tu estrategia de derechos (ver abajo). Con `YOUTUBE_API_KEY` puedes marcar "Solo Creative Commons".

Para que sea realmente 24/7, déjala corriendo en una PC que no se apague o en un servidor (VPS). En un servidor Linux:
```bash
npm i -g pm2 && pm2 start server/index.js --name clip-office && pm2 save && pm2 startup
```
(Si la abres a internet, pon un proxy con contraseña delante: la app no tiene login.)

---

## 💰 Monetización y derechos: lee esto

Esto es lo que más decide si ganas dinero o no:

1. **Clips de gameplays de otros creadores** pueden recibir reclamos de copyright o que YouTube los marque como **"contenido reutilizado"**, y eso bloquea la monetización del canal entero. Lo seguro es:
   - usar **tu propio gameplay** cuando salga GTA 6 (súbelo con el botón 📁),
   - usar videos con licencia **Creative Commons** o con **permiso** del creador,
   - y siempre añadir **valor propio**: el campo "Comentario propio", tu voz, contexto, comparaciones. Tomás te marca el riesgo en cada clip.
2. **Música:** usa solo la música de la oficina (compuesta por código, es original) o pistas que tengas con licencia en `data/music/`. Ojo: las radios dentro de GTA tienen canciones con Content ID; si te reclaman, baja el "Volumen original".
3. **Datos curiosos:** son el formato más seguro (guion, voz e imágenes propios). Verifica siempre la fuente antes de publicar. YouTube pide marcar contenido sintético realista; la app ya marca `containsSyntheticMedia` en los videos de datos curiosos.
4. Las imágenes IA vienen de Pollinations (gratis); para uso comercial intensivo revisa sus términos o cambia a fotos libres (Ajustes → Imágenes).

## 📈 Para que sea mega top: recomendaciones

- **Hook en los primeros 2 segundos**, subtítulos grandes y clips de **20–45 s**. Los finales que conectan con el inicio hacen que el video se repita (más retención).
- **Constancia:** 1–3 Shorts al día, siempre a la misma hora. Revisa en 📈 qué formato crece más y pídele a Renata que te lo explique.
- **Un canal, un tema:** separa GTA 6 y datos curiosos en canales distintos; el algoritmo recomienda mejor canales con una audiencia clara.
- **Publica en las 3 redes:** descarga el MP4 y súbelo a TikTok y Reels (marca ✔ en la app para llevar el control). Para publicar y medir las tres desde un solo lugar, **Metricool** o **Buffer** te sirven.
- **Monetización real:** YouTube Partner Program pide 1 000 suscriptores + 10 M de vistas de Shorts en 90 días (o 4 000 h de reproducción en 12 meses). TikTok Creator Rewards solo paga videos de más de 1 minuto, así que algunos datos curiosos conviene hacerlos de 60–70 s.

---

## 🧱 Cómo está construido

```
clip-office/
├── server/
│   ├── index.js          API + servidor web (Express)
│   ├── agents.js         los 11 agentes y su estado en vivo
│   ├── brain.js          chat: Claude con herramientas reales (o modo básico)
│   ├── jobs.js           cola de trabajo que pasa por cada agente
│   ├── scheduler.js      automatizaciones 24/7
│   ├── pipeline/         descarga, transcripción, momentos virales, subtítulos ASS,
│   │                     render FFmpeg, investigación, guiones, voz, imágenes, música
│   └── integrations/     YouTube (métricas + subida), TikTok, Instagram
├── public/               interfaz: oficina 3D (Three.js), estudio, paneles
├── scripts/              instalación y voz (edge-tts)
├── assets/fonts/         tipografías Anton y Montserrat (licencia OFL)
├── test/                 pruebas (npm test)
└── data/                 tus videos, clips, base de datos y claves (no se sube a git)
```

`npm test` corre las pruebas del pipeline. La música original se genera la primera vez que abres la app.

### Problemas comunes

- **"YouTube pidió verificar que no eres un bot"** → configura `YTDLP_COOKIES_FILE` o sube el video como archivo. Mantén yt-dlp al día: `pip install -U yt-dlp`.
- **No sale la voz** → `pip install -U edge-tts` y revisa tu conexión (usa el servicio de voz de Microsoft Edge).
- **La vista 3D va lenta** → usa Chrome o Edge con aceleración por hardware activada.
