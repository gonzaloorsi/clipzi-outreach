// daily-outreach.mjs
// Automated daily YouTube outreach for Clipzi
// Queue-based architecture: discovers channels → queues → sends from queue
// Searches YouTube for VIDEOS to discover channels through content (larger search space)
// Scores them, sends personalized emails via Resend

import { readFileSync, writeFileSync, existsSync } from "fs";

// ─── Config ────────────────────────────────────────────────────────────────
const YOUTUBE_API_KEYS = [
  process.env.YOUTUBE_API_KEY,
  process.env.YOUTUBE_API_KEY_2,
  process.env.YOUTUBE_API_KEY_3,
  process.env.YOUTUBE_API_KEY_4,
  process.env.YOUTUBE_API_KEY_5,
].filter(Boolean);

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const SENDER_NAME = process.env.SENDER_NAME;

const SENDERS = [
  { email: process.env.SENDER_EMAIL, limit: 100 },
  { email: process.env.SENDER_EMAIL_2, limit: 100 },
].filter(s => s.email);

const MAX_EMAILS_PER_DAY = SENDERS.reduce((sum, s) => sum + s.limit, 0);
const QUEUE_THRESHOLD = 400; // 2 days buffer at 200/day
const QUERIES_PER_RUN = 150;
const SEND_DELAY_MS = 200;
const MIN_SUBSCRIBERS = 7_000;

let currentKeyIndex = 0;

function getCurrentApiKey() {
  return YOUTUBE_API_KEYS[currentKeyIndex];
}

function switchToNextKey() {
  if (currentKeyIndex + 1 < YOUTUBE_API_KEYS.length) {
    currentKeyIndex++;
    console.log(`  🔑 Switched to API key ${currentKeyIndex + 1}/${YOUTUBE_API_KEYS.length}`);
    return true;
  }
  return false;
}

if (YOUTUBE_API_KEYS.length === 0) { console.error("❌ Missing YOUTUBE_API_KEY"); process.exit(1); }
if (!RESEND_API_KEY) { console.error("❌ Missing RESEND_API_KEY"); process.exit(1); }
if (SENDERS.length === 0) { console.error("❌ Missing SENDER_EMAIL"); process.exit(1); }
if (!SENDER_NAME) { console.error("❌ Missing SENDER_NAME"); process.exit(1); }

console.log(`🔑 YouTube API keys loaded: ${YOUTUBE_API_KEYS.length}`);
console.log(`📤 Senders: ${SENDERS.map(s => s.email + " (" + s.limit + "/day)").join(", ")}`);

// ─── Video-focused Search Query Pool (500+ queries) ─────────────────────────
// Each query is an object: { q, duration?, order?, region? }
// type=video discovers channels through their content (much larger search space)
const QUERY_POOL = [
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PODCASTS & CONVERSATIONS (long duration, date order)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "podcast episodio completo español", duration: "long", order: "date" },
  { q: "entrevista larga conversación", duration: "long", order: "date" },
  { q: "charla debate opinión", duration: "long", order: "date" },
  { q: "mesa redonda discusión panel", duration: "long", order: "date" },
  { q: "podcast emprendimiento negocios", duration: "long", order: "date" },
  { q: "podcast true crime crimen real", duration: "long", order: "date" },
  { q: "podcast comedia humor español", duration: "long", order: "date" },
  { q: "podcast desarrollo personal motivación", duration: "long", order: "date" },
  { q: "podcast psicología salud mental", duration: "long", order: "date" },
  { q: "podcast historia relatos", duration: "long", order: "date" },
  { q: "podcast ciencia tecnología español", duration: "long", order: "date" },
  { q: "podcast entrevista famosos celebridades", duration: "long", order: "date" },
  { q: "podcast política actualidad opinión", duration: "long", order: "date" },
  { q: "podcast filosofía pensamiento profundo", duration: "long", order: "date" },
  { q: "podcast deportes fútbol análisis", duration: "long", order: "date" },
  { q: "podcast feminismo género sociedad", duration: "long", order: "date" },
  { q: "podcast música artistas industria", duration: "long", order: "date" },
  { q: "podcast terror misterio paranormal", duration: "long", order: "date" },
  { q: "podcast finanzas inversiones dinero", duration: "long", order: "date" },
  { q: "podcast viajes experiencias mundo", duration: "long", order: "date" },
  { q: "podcast parejas relaciones amor", duration: "long", order: "date" },
  { q: "podcast espiritualidad meditación vida", duration: "long", order: "date" },
  { q: "podcast cine series películas", duration: "long", order: "date" },
  { q: "podcast gaming videojuegos", duration: "long", order: "date" },
  { q: "podcast educación aprendizaje", duration: "long", order: "date" },
  { q: "podcast latino spotify nuevo episodio", duration: "long", order: "date" },
  { q: "entrevista en profundidad completa", duration: "long", order: "date" },
  { q: "conversación sin filtro español", duration: "long", order: "date" },
  { q: "podcast maternidad crianza familia", duration: "long", order: "date" },
  { q: "podcast alimentación nutrición salud", duration: "long", order: "date" },
  { q: "podcast marketing digital redes", duration: "long", order: "date" },
  { q: "podcast inmigración experiencia país", duration: "long", order: "date" },
  { q: "podcast astronomía ciencia universo", duration: "long", order: "date" },
  { q: "podcast derecho leyes abogado", duration: "long", order: "date" },
  { q: "podcast medicina doctor salud", duration: "long", order: "date" },
  { q: "podcast arquitectura diseño arte", duration: "long", order: "date" },
  { q: "podcast economía mercados análisis", duration: "long", order: "date" },
  { q: "podcast fútbol comentario análisis", duration: "long", order: "date" },
  { q: "podcast inteligencia artificial futuro", duration: "long", order: "date" },
  { q: "podcast bienestar autoayuda coaching", duration: "long", order: "date" },
  { q: "podcast literatura libros recomendaciones", duration: "long", order: "date" },
  { q: "podcast emprendedor startup historia", duration: "long", order: "date" },
  { q: "podcast medio ambiente sostenibilidad", duration: "long", order: "date" },
  { q: "podcast gastronomía cocina chef", duration: "long", order: "date" },
  { q: "podcast fotografía creatividad", duration: "long", order: "date" },
  { q: "podcast moda tendencias estilo", duration: "long", order: "date" },
  { q: "podcast religión fe espiritualidad", duration: "long", order: "date" },
  { q: "podcast animales mascotas veterinaria", duration: "long", order: "date" },
  { q: "podcast productividad hábitos éxito", duration: "long", order: "date" },
  { q: "podcast comedia argentino humor", duration: "long", order: "date", region: "AR" },
  { q: "podcast mexicano entrevista nuevo", duration: "long", order: "date", region: "MX" },
  { q: "podcast colombiano conversación", duration: "long", order: "date", region: "CO" },
  { q: "podcast chileno episodio completo", duration: "long", order: "date", region: "CL" },
  { q: "podcast español españa nuevo", duration: "long", order: "date", region: "ES" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. PHOTOGRAPHY & CREATIVE (medium duration)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "sesión fotográfica detrás cámaras", duration: "medium" },
  { q: "tutorial lightroom edición fotos", duration: "medium" },
  { q: "fotografía callejera street photography", duration: "medium" },
  { q: "cómo editar fotos profesional", duration: "medium" },
  { q: "photoshop tutorial español completo", duration: "medium" },
  { q: "video cinematográfico making of", duration: "medium" },
  { q: "fotografía retrato iluminación estudio", duration: "medium" },
  { q: "edición de video premiere pro tutorial", duration: "medium" },
  { q: "after effects motion graphics español", duration: "medium" },
  { q: "davinci resolve tutorial español", duration: "medium" },
  { q: "fotografía de producto ecommerce", duration: "medium" },
  { q: "fotografía paisaje naturaleza tips", duration: "medium" },
  { q: "cámara nueva review español unboxing", duration: "medium" },
  { q: "drone fpv cinematic video", duration: "medium" },
  { q: "color grading cinematografía tutorial", duration: "medium" },
  { q: "video boda producción audiovisual", duration: "medium" },
  { q: "fotografía celular smartphone tips", duration: "medium" },
  { q: "timelapse hyperlapse tutorial español", duration: "medium" },
  { q: "capcut edición video tutorial", duration: "medium" },
  { q: "cortometraje filmmaking indie español", duration: "medium" },
  { q: "diseño gráfico illustrator tutorial", duration: "medium" },
  { q: "lettering caligrafía tutorial español", duration: "medium" },
  { q: "ilustración digital procreate tutorial", duration: "medium" },
  { q: "pintura óleo acrílico arte tutorial", duration: "medium" },
  { q: "dibujo realista lápiz tutorial", duration: "medium" },
  { q: "Sony Alpha review español fotografía", duration: "medium" },
  { q: "Canon vs Nikon comparativa español", duration: "medium" },
  { q: "lente objetivo review español", duration: "medium" },
  { q: "estudio fotografía setup tour", duration: "medium" },
  { q: "edición fotos celular tutorial", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. ENTREPRENEURS & BUSINESS (long, mix date/viewCount)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "emprendimiento experiencia real historia", duration: "long", order: "date" },
  { q: "marketing digital estrategia 2024", duration: "long", order: "viewCount" },
  { q: "caso de éxito negocio emprendedor", duration: "long", order: "date" },
  { q: "cómo emprender negocio desde cero", duration: "long", order: "viewCount" },
  { q: "ventas tips estrategia cerrar", duration: "long", order: "date" },
  { q: "ecommerce tienda online dropshipping", duration: "long", order: "date" },
  { q: "negocio rentable 2024 ideas", duration: "long", order: "viewCount" },
  { q: "freelance trabajar independiente experiencia", duration: "long", order: "date" },
  { q: "startup historia emprendedor latino", duration: "long", order: "date" },
  { q: "copywriting redacción ventas persuasión", duration: "medium", order: "date" },
  { q: "SEO posicionamiento web estrategia", duration: "long", order: "date" },
  { q: "marca personal branding construir", duration: "long", order: "viewCount" },
  { q: "nómada digital trabajar viajando", duration: "long", order: "date" },
  { q: "monetizar redes sociales ganar dinero", duration: "long", order: "viewCount" },
  { q: "liderazgo equipos gestión empresa", duration: "long", order: "date" },
  { q: "amazon fba vender productos", duration: "long", order: "date" },
  { q: "bienes raíces inversión inmobiliaria", duration: "long", order: "date" },
  { q: "negocio online rentable paso a paso", duration: "long", order: "viewCount" },
  { q: "publicidad facebook ads google ads", duration: "medium", order: "date" },
  { q: "emprendimiento social impacto comunidad", duration: "long", order: "date" },
  { q: "modelo de negocio canvas plan", duration: "long", order: "date" },
  { q: "productividad emprendedor hábitos rutina", duration: "long", order: "date" },
  { q: "automatización negocio herramientas", duration: "medium", order: "date" },
  { q: "networking conexiones profesionales", duration: "long", order: "date" },
  { q: "franquicia negocio invertir", duration: "long", order: "date" },
  { q: "e-commerce Shopify tutorial español", duration: "long", order: "date" },
  { q: "marketing contenidos estrategia", duration: "medium", order: "date" },
  { q: "negocio gastronómico restaurante", duration: "long", order: "date" },
  { q: "importar productos china alibaba", duration: "long", order: "viewCount" },
  { q: "emprender sin dinero experiencia real", duration: "long", order: "date" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. FITNESS & HEALTH (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "rutina completa gimnasio español", duration: "medium" },
  { q: "entrenamiento funcional casa completo", duration: "medium" },
  { q: "yoga clase completa principiantes", duration: "medium" },
  { q: "nutrición dieta semana saludable", duration: "medium" },
  { q: "crossfit wod entrenamiento completo", duration: "medium" },
  { q: "pilates clase completa español", duration: "medium" },
  { q: "rutina abdominales core completa", duration: "medium" },
  { q: "entrenamiento hiit quema grasa", duration: "medium" },
  { q: "rutina piernas glúteos completa", duration: "medium" },
  { q: "entrenamiento pecho espalda gym", duration: "medium" },
  { q: "calistenia ejercicio peso corporal", duration: "medium" },
  { q: "stretching estiramientos flexibilidad", duration: "medium" },
  { q: "running correr entrenamiento maratón", duration: "medium" },
  { q: "boxeo entrenamiento tutorial saco", duration: "medium" },
  { q: "MMA artes marciales entrenamiento", duration: "medium" },
  { q: "natación técnica entrenamiento", duration: "medium" },
  { q: "ciclismo mtb ruta entrenamiento", duration: "medium" },
  { q: "suplementos proteína nutrición gym", duration: "medium" },
  { q: "transformación física antes después", duration: "medium", order: "viewCount" },
  { q: "definición muscular dieta cutting", duration: "medium" },
  { q: "volumen muscular masa ganar", duration: "medium" },
  { q: "preparación física competencia fitness", duration: "medium" },
  { q: "yoga avanzado flujo vinyasa", duration: "medium" },
  { q: "entrenamiento adultos mayores salud", duration: "medium" },
  { q: "rehabilitación lesión ejercicios", duration: "medium" },
  { q: "salud hormonal bienestar ejercicio", duration: "medium" },
  { q: "triatlón ironman entrenamiento", duration: "long" },
  { q: "escalada bouldering climbing tutorial", duration: "medium" },
  { q: "surf olas tutorial español", duration: "medium" },
  { q: "tenis entrenamiento técnica saque", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. COOKING (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "receta completa paso a paso español", duration: "medium" },
  { q: "cocina mexicana tradicional receta", duration: "medium", region: "MX" },
  { q: "cocina peruana ceviche receta", duration: "medium", region: "PE" },
  { q: "pastelería repostería decoración torta", duration: "medium" },
  { q: "asado parrilla carne argentina", duration: "medium", region: "AR" },
  { q: "comida colombiana receta tradicional", duration: "medium", region: "CO" },
  { q: "pan artesanal masa madre receta", duration: "medium" },
  { q: "cocina italiana pasta pizza casera", duration: "medium" },
  { q: "sushi preparación receta japonesa", duration: "medium" },
  { q: "comida saludable meal prep semana", duration: "medium" },
  { q: "recetas rápidas fáciles 15 minutos", duration: "medium" },
  { q: "barbacoa bbq ahumado técnica", duration: "medium" },
  { q: "repostería postres dulces chocolate", duration: "medium" },
  { q: "cocina vegana vegetariana receta", duration: "medium" },
  { q: "comida callejera street food latino", duration: "medium" },
  { q: "coctelería bartender tragos mezcla", duration: "medium" },
  { q: "café barista latte art preparar", duration: "medium" },
  { q: "fermentación kombucha kimchi receta", duration: "medium" },
  { q: "comida chilena empanada receta", duration: "medium", region: "CL" },
  { q: "comida ecuatoriana receta típica", duration: "medium", region: "EC" },
  { q: "comida venezolana arepa receta", duration: "medium" },
  { q: "cocina asiática wok salteado receta", duration: "medium" },
  { q: "chocolate bombones temperado tutorial", duration: "medium" },
  { q: "helado artesanal receta técnica", duration: "medium" },
  { q: "panadería pan dulce receta", duration: "medium" },
  { q: "conservas mermelada encurtidos receta", duration: "medium" },
  { q: "tacos al pastor preparación receta", duration: "medium", region: "MX" },
  { q: "ceviche receta paso a paso", duration: "medium", region: "PE" },
  { q: "empanadas receta horno frita", duration: "medium", region: "AR" },
  { q: "cocina española paella tortilla", duration: "medium", region: "ES" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. EDUCATION & TUTORIALS (long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "clase completa universidad español", duration: "long" },
  { q: "curso gratis tutorial completo", duration: "long" },
  { q: "explicación completa tema detallado", duration: "long" },
  { q: "aprende programación desde cero", duration: "long" },
  { q: "curso python completo español", duration: "long", order: "viewCount" },
  { q: "curso javascript web desarrollo", duration: "long", order: "viewCount" },
  { q: "excel avanzado macros tutorial", duration: "long" },
  { q: "matemáticas explicación clase completa", duration: "long" },
  { q: "física cuántica explicación español", duration: "long" },
  { q: "química orgánica clase completa", duration: "long" },
  { q: "biología celular clase explicación", duration: "long" },
  { q: "historia universal clase completa", duration: "long" },
  { q: "contabilidad básica curso español", duration: "long" },
  { q: "economía explicación macro micro", duration: "long" },
  { q: "derecho clase universidad español", duration: "long" },
  { q: "psicología clase teoría explicación", duration: "long" },
  { q: "wordpress crear página web tutorial", duration: "long" },
  { q: "data science machine learning español", duration: "long" },
  { q: "cloud computing AWS Azure tutorial", duration: "long" },
  { q: "desarrollo móvil android flutter", duration: "long" },
  { q: "inglés clase completa gramática", duration: "long" },
  { q: "aprender español clase completa", duration: "long" },
  { q: "react tutorial completo español", duration: "long" },
  { q: "SQL base datos tutorial completo", duration: "long" },
  { q: "inteligencia artificial tutorial español", duration: "long" },
  { q: "figma diseño UI UX tutorial", duration: "long" },
  { q: "ciberseguridad hacking ético curso", duration: "long" },
  { q: "linux terminal comandos tutorial", duration: "long" },
  { q: "Arduino electrónica proyectos tutorial", duration: "long" },
  { q: "curso marketing digital completo", duration: "long", order: "viewCount" },
  { q: "preparar examen oposición estudio", duration: "long" },
  { q: "curso fotografía completo principiantes", duration: "long" },
  { q: "astronomía explicación universo clase", duration: "long" },
  { q: "filosofía clase historia pensamiento", duration: "long" },
  { q: "geografía explicación países mundo", duration: "long" },
  { q: "sociología clase universidad español", duration: "long" },
  { q: "neurociencia cerebro mente explicación", duration: "long" },
  { q: "estadística probabilidad clase español", duration: "long" },
  { q: "cálculo matemáticas clase completa", duration: "long" },
  { q: "nutrición dietética clase profesional", duration: "long" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. GAMING (long, date order)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "gameplay completo español nuevo juego", duration: "long", order: "date" },
  { q: "walkthrough guía completa español", duration: "long", order: "date" },
  { q: "torneo competitivo esports español", duration: "long", order: "date" },
  { q: "minecraft survival serie español", duration: "long", order: "date" },
  { q: "GTA roleplay español serie", duration: "long", order: "date" },
  { q: "fortnite gameplay español victoria", duration: "medium", order: "date" },
  { q: "league of legends lol gameplay", duration: "long", order: "date" },
  { q: "valorant gameplay competitivo español", duration: "long", order: "date" },
  { q: "FIFA EA FC gameplay español", duration: "medium", order: "date" },
  { q: "call of duty warzone gameplay", duration: "long", order: "date" },
  { q: "roblox gameplay español nuevo", duration: "medium", order: "date" },
  { q: "dead by daylight gameplay español", duration: "long", order: "date" },
  { q: "apex legends gameplay español", duration: "long", order: "date" },
  { q: "horror game terror juego español", duration: "long", order: "date" },
  { q: "speedrun récord mundial español", duration: "medium", order: "date" },
  { q: "análisis review juego nuevo español", duration: "medium", order: "date" },
  { q: "free fire gameplay latino", duration: "medium", order: "date" },
  { q: "Pokemon gameplay serie español", duration: "long", order: "date" },
  { q: "zelda gameplay completo español", duration: "long", order: "date" },
  { q: "retro gaming clásicos nostalgia", duration: "medium", order: "date" },
  { q: "streaming directo gameplay español", duration: "long", order: "date" },
  { q: "PS5 Xbox gameplay review español", duration: "medium", order: "date" },
  { q: "Hogwarts Legacy gameplay español", duration: "long", order: "date" },
  { q: "Resident Evil gameplay terror español", duration: "long", order: "date" },
  { q: "juego indie gameplay español", duration: "medium", order: "date" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. TRAVEL & LIFESTYLE (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "viaje completo destino turismo", duration: "long", order: "date" },
  { q: "vlog diario rutina mi día", duration: "medium", order: "date" },
  { q: "mudanza nuevo país experiencia vivir", duration: "long", order: "date" },
  { q: "vanlife viaje carretera aventura", duration: "long", order: "date" },
  { q: "mochilero viaje barato sudamérica", duration: "long", order: "date" },
  { q: "viaje europa mochila experiencia", duration: "long", order: "date" },
  { q: "camino santiago experiencia completa", duration: "long", order: "date" },
  { q: "tour ciudad guía turística español", duration: "medium", order: "date" },
  { q: "crucero barco viaje experiencia", duration: "long", order: "date" },
  { q: "vuelos baratos tips ahorro viajar", duration: "medium" },
  { q: "vivir en otro país experiencia latino", duration: "long", order: "date" },
  { q: "viaje pareja luna miel destino", duration: "medium", order: "date" },
  { q: "viaje solo mujer experiencia", duration: "medium", order: "date" },
  { q: "camping naturaleza montaña aventura", duration: "medium", order: "date" },
  { q: "roadtrip ruta carretera español", duration: "long", order: "date" },
  { q: "viaje México destinos turismo", duration: "medium", order: "date", region: "MX" },
  { q: "viaje Colombia destinos turismo", duration: "medium", order: "date", region: "CO" },
  { q: "viaje Perú Machu Picchu turismo", duration: "medium", order: "date", region: "PE" },
  { q: "viaje Argentina Buenos Aires turismo", duration: "medium", order: "date", region: "AR" },
  { q: "viaje España turismo ciudades", duration: "medium", order: "date", region: "ES" },
  { q: "viaje Chile Patagonia turismo", duration: "medium", order: "date", region: "CL" },
  { q: "nómada digital vida experiencia", duration: "long", order: "date" },
  { q: "costo de vida país comparación", duration: "medium", order: "date" },
  { q: "aeropuerto tips primer viaje avión", duration: "medium" },
  { q: "hotel hostal airbnb experiencia review", duration: "medium", order: "date" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. MUSIC & PERFORMANCE (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "cover canción español acústico", duration: "medium" },
  { q: "producción musical tutorial beat", duration: "medium" },
  { q: "concierto en vivo completo español", duration: "long" },
  { q: "guitarra tutorial canción español", duration: "medium" },
  { q: "piano tutorial canción aprender", duration: "medium" },
  { q: "batería drums cover español", duration: "medium" },
  { q: "bajo eléctrico tutorial línea", duration: "medium" },
  { q: "ukulele tutorial canción fácil", duration: "medium" },
  { q: "cantar vocal técnica tutorial", duration: "medium" },
  { q: "beatbox freestyle español", duration: "medium" },
  { q: "producción beat trap reggaeton", duration: "medium" },
  { q: "mezcla mastering tutorial español", duration: "long" },
  { q: "FL Studio tutorial español beat", duration: "medium" },
  { q: "Ableton Live tutorial español", duration: "medium" },
  { q: "rap batalla gallos freestyle", duration: "medium", order: "date" },
  { q: "sesión acústica artista español", duration: "medium", order: "date" },
  { q: "reacción música nuevo video español", duration: "medium", order: "date" },
  { q: "violín tutorial clásico español", duration: "medium" },
  { q: "DJ mezcla set completo español", duration: "long" },
  { q: "composición canción songwriting español", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. NEWS & COMMENTARY (medium, date order)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "análisis noticias hoy español", duration: "medium", order: "date" },
  { q: "opinión actualidad política análisis", duration: "medium", order: "date" },
  { q: "resumen semanal noticias español", duration: "medium", order: "date" },
  { q: "debate político opinión español", duration: "long", order: "date" },
  { q: "geopolítica análisis mundial español", duration: "medium", order: "date" },
  { q: "comentario social actualidad español", duration: "medium", order: "date" },
  { q: "economía noticias análisis mercados", duration: "medium", order: "date" },
  { q: "tecnología noticias nuevos productos", duration: "medium", order: "date" },
  { q: "deportes noticias resumen español", duration: "medium", order: "date" },
  { q: "crónica investigación periodismo español", duration: "long", order: "date" },
  { q: "noticias México hoy análisis", duration: "medium", order: "date", region: "MX" },
  { q: "noticias Argentina hoy análisis", duration: "medium", order: "date", region: "AR" },
  { q: "noticias Colombia hoy análisis", duration: "medium", order: "date", region: "CO" },
  { q: "noticias España hoy análisis", duration: "medium", order: "date", region: "ES" },
  { q: "noticias Chile hoy análisis", duration: "medium", order: "date", region: "CL" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. TECH & REVIEWS (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "review completo español producto", duration: "medium" },
  { q: "unboxing nuevo producto español", duration: "medium", order: "date" },
  { q: "comparativa vs mejor español", duration: "medium" },
  { q: "setup tour escritorio gaming", duration: "medium" },
  { q: "iPhone review español experiencia", duration: "medium", order: "date" },
  { q: "Samsung Galaxy review español", duration: "medium", order: "date" },
  { q: "laptop notebook review español", duration: "medium" },
  { q: "auriculares review español audio", duration: "medium" },
  { q: "tablet iPad review español", duration: "medium" },
  { q: "smartwatch reloj inteligente review", duration: "medium" },
  { q: "cámara review español video foto", duration: "medium" },
  { q: "monitor pantalla review español", duration: "medium" },
  { q: "teclado mouse gaming review español", duration: "medium" },
  { q: "smart home domótica hogar inteligente", duration: "medium" },
  { q: "apps aplicaciones recomendaciones español", duration: "medium" },
  { q: "software programa gratis mejor español", duration: "medium" },
  { q: "inteligencia artificial chatgpt herramientas", duration: "medium", order: "date" },
  { q: "robot aspiradora review español", duration: "medium" },
  { q: "impresora 3D maker review español", duration: "medium" },
  { q: "silla gaming escritorio review español", duration: "medium" },
  { q: "consola gaming PS5 Xbox Switch review", duration: "medium" },
  { q: "accesorio tech gadget review español", duration: "medium" },
  { q: "Tesla auto eléctrico review español", duration: "medium" },
  { q: "mejores compras tech 2024 español", duration: "medium", order: "date" },
  { q: "tecnología barata buena review español", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. COMEDY & ENTERTAINMENT (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "stand up comedia completo español", duration: "long" },
  { q: "sketches humor español comedia", duration: "medium" },
  { q: "parodia imitación famosos español", duration: "medium" },
  { q: "broma cámara oculta prank español", duration: "medium" },
  { q: "challenge reto viral divertido", duration: "medium", order: "date" },
  { q: "reacción react video español", duration: "medium", order: "date" },
  { q: "storytime historia personal español", duration: "medium" },
  { q: "roast comedia español humor", duration: "medium" },
  { q: "compilación mejores momentos graciosos", duration: "medium" },
  { q: "humor argentino comedia sketch", duration: "medium", region: "AR" },
  { q: "humor mexicano comedia sketch", duration: "medium", region: "MX" },
  { q: "humor colombiano comedia viral", duration: "medium", region: "CO" },
  { q: "humor español comedia monólogo", duration: "medium", region: "ES" },
  { q: "humor chileno comedia sketch", duration: "medium", region: "CL" },
  { q: "humor venezolano comedia viral", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. DIY & CRAFTS (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "manualidad paso a paso español", duration: "medium" },
  { q: "proyecto diy bricolaje español", duration: "medium" },
  { q: "crochet tejido tutorial español", duration: "medium" },
  { q: "carpintería proyecto madera tutorial", duration: "long" },
  { q: "resina epoxi manualidades tutorial", duration: "medium" },
  { q: "macramé nudos decoración tutorial", duration: "medium" },
  { q: "costura coser ropa tutorial", duration: "medium" },
  { q: "cerámica alfarería barro tutorial", duration: "medium" },
  { q: "joyería bisutería artesanal hacer", duration: "medium" },
  { q: "bordado punto cruz tutorial español", duration: "medium" },
  { q: "scrapbooking álbum recuerdos tutorial", duration: "medium" },
  { q: "velas artesanales jabones hacer", duration: "medium" },
  { q: "reciclaje upcycling proyecto creativo", duration: "medium" },
  { q: "mueble pallet madera reciclada", duration: "medium" },
  { q: "pintura decorativa mural técnica", duration: "medium" },
  { q: "soldadura metalurgia proyecto taller", duration: "long" },
  { q: "impresión 3D proyecto maker español", duration: "medium" },
  { q: "origami papel manualidad tutorial", duration: "medium" },
  { q: "modelismo maqueta escala tutorial", duration: "medium" },
  { q: "cuero marroquinería proyecto tutorial", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. PETS & ANIMALS (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "adiestramiento perro tutorial español", duration: "medium" },
  { q: "cuidado mascota consejo veterinario", duration: "medium" },
  { q: "gato cuidado felino tutorial", duration: "medium" },
  { q: "acuario pecera peces tropical setup", duration: "medium" },
  { q: "aves pájaros loros canarios cuidado", duration: "medium" },
  { q: "reptiles serpientes lagarto cuidado", duration: "medium" },
  { q: "caballo equitación hípica español", duration: "medium" },
  { q: "granja animales campo rural vida", duration: "medium" },
  { q: "hamster roedor conejo cuidado", duration: "medium" },
  { q: "perro cachorro educación socialización", duration: "medium" },
  { q: "comida casera mascota receta", duration: "medium" },
  { q: "veterinaria caso clínico animal", duration: "medium" },
  { q: "rescate animal refugio adopción", duration: "medium", order: "date" },
  { q: "comportamiento animal etología educación", duration: "medium" },
  { q: "terrario vivario reptil anfibio", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. FINANCE & INVESTING (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "finanzas personales consejo ahorro", duration: "medium" },
  { q: "inversiones bolsa análisis acciones", duration: "medium", order: "date" },
  { q: "cómo ahorrar dinero tips", duration: "medium", order: "viewCount" },
  { q: "trading forex criptomonedas español", duration: "long", order: "date" },
  { q: "educación financiera jóvenes español", duration: "medium" },
  { q: "jubilación retiro pensión planificar", duration: "medium" },
  { q: "presupuesto deudas pagar organizar", duration: "medium" },
  { q: "criptomonedas bitcoin análisis español", duration: "medium", order: "date" },
  { q: "invertir poco dinero principiante", duration: "medium", order: "viewCount" },
  { q: "impuestos declaración SAT fiscal", duration: "medium", region: "MX" },
  { q: "impuestos AFIP monotributo Argentina", duration: "medium", region: "AR" },
  { q: "impuestos DIAN Colombia declaración", duration: "medium", region: "CO" },
  { q: "fondos inversión ETF español", duration: "medium" },
  { q: "economía explicación inflación español", duration: "medium", order: "date" },
  { q: "tarjetas crédito finanzas tips", duration: "medium" },
  { q: "ganar dinero extra ingreso pasivo", duration: "medium", order: "viewCount" },
  { q: "bienes raíces invertir propiedad", duration: "long" },
  { q: "mercado valores análisis semanal", duration: "medium", order: "date" },
  { q: "libertad financiera plan estrategia", duration: "long" },
  { q: "primer sueldo invertir ahorrar joven", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. TRUE CRIME & MYSTERY (long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "caso criminal completo español", duration: "long" },
  { q: "misterio sin resolver investigación", duration: "long" },
  { q: "documental crimen real español", duration: "long" },
  { q: "caso criminal famoso análisis", duration: "long", order: "viewCount" },
  { q: "desaparición caso misterio español", duration: "long" },
  { q: "asesino serial historia caso real", duration: "long" },
  { q: "caso policial investigación verdad", duration: "long" },
  { q: "crimen organizado narco historia", duration: "long" },
  { q: "caso sin resolver misterioso español", duration: "long", order: "date" },
  { q: "expediente criminal análisis completo", duration: "long" },
  { q: "leyendas urbanas mitos terror real", duration: "long" },
  { q: "ovnis ufología avistamiento evidencia", duration: "long" },
  { q: "conspiraciones teorías secretos mundo", duration: "long" },
  { q: "fantasmas paranormal evidencia video", duration: "long" },
  { q: "lugares abandonados urbex exploración", duration: "long" },
  { q: "enigmas mundo misterios antiguos", duration: "long" },
  { q: "caso forense evidencia análisis", duration: "long" },
  { q: "estafador fraude caso real español", duration: "long" },
  { q: "secta culto historia investigación", duration: "long" },
  { q: "cold case caso frío resolución", duration: "long" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 17. SPIRITUALITY & WELLNESS (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "meditación guiada completa español", duration: "medium" },
  { q: "tarot lectura español signos", duration: "medium", order: "date" },
  { q: "astrología signo horóscopo semanal", duration: "medium", order: "date" },
  { q: "reiki energía sanación sesión", duration: "medium" },
  { q: "herbología plantas medicinales natural", duration: "medium" },
  { q: "aceites esenciales aromaterapia uso", duration: "medium" },
  { q: "ayurveda bienestar natural rutina", duration: "medium" },
  { q: "mindfulness atención plena ejercicio", duration: "medium" },
  { q: "chakras energía equilibrio cuerpo", duration: "medium" },
  { q: "yoga nidra relajación profunda", duration: "medium" },
  { q: "manifestación ley atracción abundancia", duration: "medium" },
  { q: "ritual luna nueva energía espiritual", duration: "medium", order: "date" },
  { q: "numerología significado números vida", duration: "medium" },
  { q: "cristales piedras energéticas uso", duration: "medium" },
  { q: "respiración técnica pranayama calma", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 18. CARS & VEHICLES (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "review auto prueba manejo español", duration: "medium" },
  { q: "restauración auto clásico proyecto", duration: "long" },
  { q: "motocicleta viaje ruta aventura", duration: "long" },
  { q: "tuning modificación auto proyecto", duration: "medium" },
  { q: "drift carreras competencia auto", duration: "medium" },
  { q: "fórmula 1 F1 análisis español", duration: "medium", order: "date" },
  { q: "mecánica automotriz taller tutorial", duration: "medium" },
  { q: "auto eléctrico Tesla review español", duration: "medium" },
  { q: "4x4 offroad todoterreno aventura", duration: "medium" },
  { q: "detailing lavado pulido auto", duration: "medium" },
  { q: "moto chopper custom proyecto", duration: "medium" },
  { q: "comparativa autos nuevos español", duration: "medium", order: "date" },
  { q: "autocaravana camper vanlife viaje", duration: "long" },
  { q: "karting go kart carreras español", duration: "medium" },
  { q: "scooter moto eléctrica movilidad", duration: "medium" },
  { q: "autos clásicos encuentro exhibición", duration: "medium" },
  { q: "rally competencia carreras español", duration: "medium" },
  { q: "comprar auto usado tips consejo", duration: "medium" },
  { q: "mantenimiento auto básico tutorial", duration: "medium" },
  { q: "mejor auto 2024 recomendación español", duration: "medium", order: "date" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 19. FILM & SERIES COMMENTARY (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "análisis película explicación completa", duration: "long" },
  { q: "resumen serie completa temporada", duration: "long" },
  { q: "crítica cine opinión película", duration: "medium", order: "date" },
  { q: "ranking mejores películas lista", duration: "medium" },
  { q: "teoría fan series películas español", duration: "medium" },
  { q: "final explicado película serie", duration: "medium", order: "date" },
  { q: "Easter eggs detalles ocultos película", duration: "medium" },
  { q: "Marvel MCU análisis teoría español", duration: "medium", order: "date" },
  { q: "anime reseña opinión español", duration: "medium", order: "date" },
  { q: "Netflix nueva serie recomendación", duration: "medium", order: "date" },
  { q: "Star Wars análisis teoría español", duration: "medium" },
  { q: "terror horror película reseña español", duration: "medium" },
  { q: "documental reseña recomendación español", duration: "medium" },
  { q: "ciencia ficción película análisis", duration: "medium" },
  { q: "K-drama doramas recomendación español", duration: "medium" },
  { q: "videoclip reacción opinión español", duration: "medium", order: "date" },
  { q: "cómic manga webtoon reseña español", duration: "medium" },
  { q: "superhéroes DC Marvel análisis", duration: "medium" },
  { q: "Oscar premios cine análisis español", duration: "medium", order: "date" },
  { q: "Behind scenes making of película", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 20. RANDOM BROAD QUERIES (no duration, mix regions)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "vlog 2024 español mi vida" },
  { q: "mi experiencia real historia personal" },
  { q: "no vas a creer lo que pasó" },
  { q: "les cuento todo la verdad" },
  { q: "probando por primera vez español" },
  { q: "día completo conmigo rutina" },
  { q: "lo que nadie te dice sobre" },
  { q: "la verdad sobre mi vida" },
  { q: "mi historia cómo llegué aquí" },
  { q: "qué pasó por qué dejé" },
  { q: "antes y después transformación" },
  { q: "vlog familiar español nuevo" },
  { q: "roomtour casa tour departamento" },
  { q: "haul compras ropa español" },
  { q: "grwm arréglate conmigo español" },
  { q: "mukbang comida español probando" },
  { q: "tier list ranking español opinión" },
  { q: "tag preguntas respuestas español" },
  { q: "Q&A preguntas suscriptores español" },
  { q: "draw my life mi historia español" },
  { q: "un día en mi vida vlog español", region: "MX" },
  { q: "un día conmigo vlog español", region: "AR" },
  { q: "rutina mañana productiva español", region: "CO" },
  { q: "cosas que no sabías de mí", region: "CL" },
  { q: "probando comida callejera español", region: "PE" },
  { q: "mi rutina diaria vlog español", region: "ES" },
  { q: "vlog semanal vida español 2024", region: "EC" },
  { q: "mudanza nuevo departamento casa", region: "VE" },
  { q: "comprando todo de un color challenge" },
  { q: "24 horas haciendo reto challenge" },
  { q: "respondiendo comentarios hate español" },
  { q: "mis mejores y peores compras" },
  { q: "gastando dinero en cosas innecesarias" },
  { q: "haciendo de todo por un día" },
  { q: "ASMR español relajación video" },
  { q: "broma pesada amigos español" },
  { q: "revelación sorpresa reacción español" },
  { q: "vlog navidad fiestas familia español" },
  { q: "resumen año 2024 reflexión español" },
  { q: "cambio extremo makeover español" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 21. HOME & DECORATION (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "organización minimalismo casa orden", duration: "medium" },
  { q: "decoración hogar ideas económicas", duration: "medium" },
  { q: "tiny house pequeña casa tour", duration: "medium" },
  { q: "renovación pintura pared habitación", duration: "medium" },
  { q: "limpieza profunda casa rutina", duration: "medium" },
  { q: "huerto urbano terraza jardín casa", duration: "medium" },
  { q: "remodelación antes después cocina baño", duration: "medium" },
  { q: "feng shui casa energía decoración", duration: "medium" },
  { q: "construcción obra casa proyecto", duration: "long" },
  { q: "plomería electricidad reparación casa", duration: "medium" },
  { q: "container house casa contenedor proyecto", duration: "long" },
  { q: "muebles IKEA hack transformación", duration: "medium" },
  { q: "jardín paisajismo plantas exterior", duration: "medium" },
  { q: "albañilería cerámica piso instalación", duration: "medium" },
  { q: "primer departamento decorar organizar", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 22. BOARD GAMES & TABLETOP (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "juegos mesa board game español", duration: "medium" },
  { q: "dungeons dragons rol mesa partida", duration: "long" },
  { q: "cartas magic pokemon tcg español", duration: "medium" },
  { q: "warhammer miniaturas pintura tutorial", duration: "medium" },
  { q: "ajedrez partida análisis español", duration: "medium" },
  { q: "juego rol partida completa español", duration: "long" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 23. FASHION & BEAUTY (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "maquillaje tutorial natural español", duration: "medium" },
  { q: "cuidado cabello peinados tutorial", duration: "medium" },
  { q: "skincare rutina coreana español", duration: "medium" },
  { q: "uñas nail art manicura diseño", duration: "medium" },
  { q: "moda sostenible slow fashion outfit", duration: "medium" },
  { q: "barbería corte cabello hombre tutorial", duration: "medium" },
  { q: "perfumes fragancias reseña colección", duration: "medium" },
  { q: "outfit ideas estilo ropa español", duration: "medium" },
  { q: "segunda mano thrift vintage ropa", duration: "medium" },
  { q: "moda tallas grandes curvy español", duration: "medium" },
  { q: "haul Shein Zara ropa compras", duration: "medium", order: "date" },
  { q: "tendencias moda 2024 español", duration: "medium", order: "date" },
  { q: "closet armario organización cápsula", duration: "medium" },
  { q: "acné tratamiento skincare productos", duration: "medium" },
  { q: "cabello rizado crespo cuidado rutina", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 24. FAMILY & PARENTING (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "maternidad mamá embarazo experiencia", duration: "medium" },
  { q: "paternidad papá bebé cuidado", duration: "medium" },
  { q: "familia numerosa hijos vida diaria", duration: "medium" },
  { q: "crianza respetuosa educación hijos", duration: "medium" },
  { q: "parto experiencia nacimiento bebé", duration: "long" },
  { q: "recetas niños familia alimentación", duration: "medium" },
  { q: "actividades infantiles manualidades niños", duration: "medium" },
  { q: "homeschooling educación casa familia", duration: "medium" },
  { q: "adolescentes jóvenes consejo padres", duration: "medium" },
  { q: "juguetes niños review español", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 25. MENTAL HEALTH & SELF-IMPROVEMENT (medium/long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "psicología terapia ansiedad ayuda", duration: "medium" },
  { q: "desarrollo personal autoayuda hábitos", duration: "medium" },
  { q: "productividad organización tiempo tips", duration: "medium" },
  { q: "hábitos disciplina motivación diaria", duration: "medium" },
  { q: "inteligencia emocional relaciones", duration: "medium" },
  { q: "estoicismo filosofía vida práctica", duration: "medium" },
  { q: "coaching vida profesional carrera", duration: "long" },
  { q: "superación personal historia real", duration: "medium" },
  { q: "comunicación oratoria hablar público", duration: "medium" },
  { q: "depresión salud mental hablar", duration: "medium" },
  { q: "autoestima confianza seguridad tips", duration: "medium" },
  { q: "manejo estrés técnicas relajación", duration: "medium" },
  { q: "relaciones tóxicas pareja consejo", duration: "medium" },
  { q: "duelo pérdida superar dolor", duration: "medium" },
  { q: "TDAH adulto experiencia estrategias", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 26. SCIENCE & HISTORY (long)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "paleontología dinosaurios fósiles documental", duration: "long" },
  { q: "física cuántica relatividad explicación", duration: "long" },
  { q: "matemáticas paradojas curiosidades", duration: "medium" },
  { q: "neurociencia cerebro mente explicación", duration: "long" },
  { q: "historia antigua roma grecia civilización", duration: "long" },
  { q: "historia medieval castillos caballeros", duration: "long" },
  { q: "mitología dioses leyendas antiguas", duration: "long" },
  { q: "arqueología descubrimientos hallazgo", duration: "long" },
  { q: "volcanes geología fenómenos naturales", duration: "medium" },
  { q: "oceanografía mar océano profundo", duration: "long" },
  { q: "guerra mundial historia completa", duration: "long" },
  { q: "revolución historia país independencia", duration: "long" },
  { q: "evolución biología Darwin explicación", duration: "long" },
  { q: "espacio exploración NASA astronauta", duration: "long" },
  { q: "prehistoria humanidad orígenes", duration: "long" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 27. SOCIAL MEDIA & CREATOR ECONOMY (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "crecer TikTok seguidores estrategia", duration: "medium" },
  { q: "Instagram reels estrategia contenido", duration: "medium" },
  { q: "monetizar YouTube AdSense ganar dinero", duration: "medium" },
  { q: "editar videos celular tutorial gratis", duration: "medium" },
  { q: "thumbnail miniatura YouTube diseñar", duration: "medium" },
  { q: "SEO YouTube posicionamiento búsqueda", duration: "medium" },
  { q: "streaming OBS setup configurar", duration: "medium" },
  { q: "contenido viral tips estrategia", duration: "medium" },
  { q: "marca personal branding construir", duration: "medium" },
  { q: "creador contenido tips crecer 2024", duration: "medium", order: "date" },
  { q: "algoritmo YouTube TikTok cómo funciona", duration: "medium" },
  { q: "ganar dinero redes sociales métodos", duration: "medium" },
  { q: "cómo empezar YouTube canal nuevo", duration: "medium", order: "viewCount" },
  { q: "equipo YouTuber cámara micrófono luz", duration: "medium" },
  { q: "Twitch streaming empezar español", duration: "medium" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 28. REGIONAL QUERIES WITH REGION CODES
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "tutorial completo español nuevo 2024", duration: "long", order: "date", region: "AR" },
  { q: "experiencia real historia vida", duration: "long", order: "date", region: "MX" },
  { q: "emprendimiento negocio experiencia", duration: "long", order: "date", region: "CO" },
  { q: "clase tutorial curso gratis", duration: "long", region: "CL" },
  { q: "cocina receta casera completa", duration: "medium", region: "PE" },
  { q: "fitness rutina ejercicio completo", duration: "medium", region: "ES" },
  { q: "gaming gameplay español directo", duration: "long", order: "date", region: "EC" },
  { q: "comedia humor sketch divertido", duration: "medium", region: "VE" },
  { q: "podcast entrevista conversación nueva", duration: "long", order: "date", region: "AR" },
  { q: "review unboxing producto nuevo", duration: "medium", order: "date", region: "MX" },
  { q: "viaje turismo destino explorar", duration: "medium", order: "date", region: "CO" },
  { q: "maquillaje belleza tutorial tips", duration: "medium", region: "CL" },
  { q: "música cover acústico sesión", duration: "medium", region: "PE" },
  { q: "manualidad DIY proyecto creativo", duration: "medium", region: "ES" },
  { q: "documental historia investigación", duration: "long", region: "EC" },
  { q: "deporte entrenamiento competencia", duration: "medium", region: "VE" },
  { q: "noticias análisis opinión semana", duration: "medium", order: "date", region: "AR" },
  { q: "desarrollo personal motivación vida", duration: "medium", region: "MX" },
  { q: "true crime caso real crimen", duration: "long", region: "CO" },
  { q: "educación clase explicación tema", duration: "long", region: "CL" },
  { q: "finanzas inversión dinero consejo", duration: "medium", region: "PE" },
  { q: "salud bienestar nutrición vida", duration: "medium", region: "ES" },
  { q: "arte pintura dibujo creativo", duration: "medium", region: "MX" },
  { q: "ciencia tecnología futuro innovación", duration: "long", region: "AR" },
  { q: "misterio paranormal leyenda terror", duration: "long", region: "CO" },

  // ═══════════════════════════════════════════════════════════════════════════
  // 29. NICHE HOBBIES (medium)
  // ═══════════════════════════════════════════════════════════════════════════
  { q: "LEGO construcción colección MOC", duration: "medium" },
  { q: "astronomía telescopio observación", duration: "medium" },
  { q: "supervivencia bushcraft camping", duration: "long" },
  { q: "numismática monedas colección antiguas", duration: "medium" },
  { q: "magia trucos ilusionismo tutorial", duration: "medium" },
  { q: "aeromodelismo aviones RC vuelo", duration: "medium" },
  { q: "acuarismo peces tropicales acuario", duration: "medium" },
  { q: "pesca fishing deportiva técnica", duration: "medium" },
  { q: "buceo diving submarinismo mar", duration: "medium" },
  { q: "kayak canoa rafting río aventura", duration: "medium" },
  { q: "golf swing tutorial técnica", duration: "medium" },
  { q: "tiro arco archery tutorial", duration: "medium" },
  { q: "parkour freerunning training", duration: "medium" },
  { q: "patinaje artístico hielo tutorial", duration: "medium" },
  { q: "bonsái plantas cuidado tutorial", duration: "medium" },
  { q: "colección figuras coleccionismo unboxing", duration: "medium" },
  { q: "fotografía analógica rollo film", duration: "medium" },
  { q: "radioaficionado HAM radio comunicación", duration: "medium" },
  { q: "apicultura abejas miel producción", duration: "medium" },
  { q: "robótica arduino raspberry proyecto", duration: "long" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ytGet(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  params.key = getCurrentApiKey();
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    if (body.includes("quota")) {
      // Try switching to next key
      if (switchToNextKey()) {
        return ytGet(endpoint, params); // Retry with new key
      }
      throw new Error("QUOTA_EXCEEDED");
    }
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function extractEmails(text) {
  if (!text) return [];
  const re = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  return [...new Set(text.match(re) || [])];
}

function cleanName(name) {
  // Remove emojis
  let clean = name
    .replace(
      /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FEFF}]|[\u{1F900}-\u{1F9FF}]|[\u{2700}-\u{27BF}]|[\u{200D}]|[\u{FE0F}]/gu,
      ""
    )
    .trim();

  // Remove suffixes after separators
  const separators = [" | ", " · ", " - ", " : ", " (", " [", " / "];
  for (const sep of separators) {
    const idx = clean.indexOf(sep);
    if (idx > 3) {
      const first = clean.substring(0, idx).trim();
      if (first.length > 3) clean = first;
    }
  }

  // Remove trailing special chars
  clean = clean.replace(/[_\-·|:]+$/g, "").trim();

  // Remove common prefixes
  clean = clean.replace(/^(El Canal De |EL CANAL DE )/i, "");

  return clean || name;
}

function scoreChannel(ch) {
  let score = 0;
  const title = (ch.title || "").toLowerCase();
  const email = (ch.emails || "").toLowerCase();
  const subs = ch.subscribers || 0;

  // Subscriber sweet spot: 50K-10M
  if (subs >= 50_000 && subs <= 10_000_000) score += 30;
  else if (subs >= 10_000 && subs < 50_000) score += 15;
  else if (subs > 10_000_000) score += 20;

  // Good niches
  const goodNiches = [
    "podcast", "vlog", "review", "react", "entrevista", "lifestyle",
    "comedia", "humor", "cocina", "receta", "fitness", "gym", "deport",
    "basket", "futbol", "gaming", "tutorial", "barbero", "barber",
    "maquillaje", "belleza", "unbox", "opinion", "reseña", "storytime",
    "nutrici", "doctor", "fotograf", "audiovisual", "film", "produc",
    "surf", "moto", "tattoo", "tatuaje", "yoga", "crossfit", "boxeo",
    "mma", "tenis", "ajedrez", "café", "barista", "educaci", "ciencia",
    "historia", "viaje", "travel", "familia", "padre", "madre",
    "challenge", "prank", "mukbang", "haul",
  ];
  if (goodNiches.some((n) => title.includes(n))) score += 15;

  // Bad niches
  const badNiches = [
    "bitcoin", "cripto", "crypto", "inmobili", "bienes raices", "realtor",
    "real estate", "compilacion", "shorts 2024", "beats", "instrumental",
    "lofi mix", "white noise", "ruido blanco", "asmr sleep",
  ];
  if (badNiches.some((n) => title.includes(n))) score -= 25;

  // Too small
  if (subs < 1_000) score -= 20;

  // High video count (more content to clip)
  if (ch.videoCount > 500) score += 20;
  else if (ch.videoCount > 100) score += 15;
  else if (ch.videoCount > 30) score += 10;

  // Professional email domain
  if (
    email &&
    !email.includes("gmail.com") &&
    !email.includes("hotmail") &&
    !email.includes("outlook") &&
    !email.includes("yahoo")
  ) {
    score += 10;
  }

  // Spanish-speaking countries
  const latamCountries = [
    "MX", "AR", "CO", "CL", "PE", "EC", "PR", "GT", "UY", "VE",
    "DO", "PA", "CR", "ES", "BO", "PY", "SV", "HN", "NI", "CU",
  ];
  if (latamCountries.includes(ch.country)) score += 10;

  return score;
}

// ─── Step A: Load State ─────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════");
console.log("  📺 Clipzi Daily YouTube Outreach");
console.log(`  📅 ${new Date().toISOString().split("T")[0]}`);
console.log("═══════════════════════════════════════════════════\n");

// Load send_results.json
let sendResults = [];
try {
  sendResults = JSON.parse(readFileSync("send_results.json", "utf-8"));
  console.log(`📬 Previously sent emails: ${sendResults.length}`);
} catch (e) {
  console.log("📬 No previous send_results.json found, starting fresh");
}

const sentEmails = new Set(
  sendResults
    .filter((s) => s.status === "sent")
    .map((s) => s.email.toLowerCase())
);
const sentChannelIds = new Set(
  sendResults.filter((s) => s.channelId).map((s) => s.channelId)
);

// Load discovered channel IDs cache (all channels we've ever seen)
let discoveredCache = [];
try {
  discoveredCache = JSON.parse(readFileSync("discovered_ids.json", "utf-8"));
  console.log(`🗄️  Discovered channels cache: ${discoveredCache.length} IDs`);
} catch (e) {
  console.log("🗄️  No discovered_ids.json found, starting fresh cache");
}
const knownChannelIds = new Set(discoveredCache);

// Load search state
let searchState = { queryIndex: 0, lastRun: null, totalSent: sendResults.length };
try {
  searchState = JSON.parse(readFileSync("search_state.json", "utf-8"));
  console.log(`🔍 Query pool index: ${searchState.queryIndex}/${QUERY_POOL.length}`);
  console.log(`📊 Total sent so far: ${searchState.totalSent}`);
} catch (e) {
  console.log("🔍 No search_state.json found, starting from index 0");
}

// Load email queue
let emailQueue = [];
try {
  emailQueue = JSON.parse(readFileSync("email_queue.json", "utf-8"));
  console.log(`📋 Email queue: ${emailQueue.length} pending`);
} catch (e) {
  console.log("📋 No email_queue.json found, starting empty queue");
}

const queueBefore = emailQueue.length;

// Filter queue: remove items whose email is already in sentEmails (in case send_results.json was updated externally)
const queueBeforeCleanup = emailQueue.length;
emailQueue = emailQueue.filter(item => !sentEmails.has(item.primaryEmail.toLowerCase()));
emailQueue = emailQueue.filter(item => !sentChannelIds.has(item.channelId));
if (emailQueue.length < queueBeforeCleanup) {
  console.log(`📋 Cleaned queue: removed ${queueBeforeCleanup - emailQueue.length} already-sent items (${emailQueue.length} remaining)`);
}

console.log(""); // blank line after state loading

// ─── Step B/C/D: Conditional Search + Fetch + Filter ────────────────────────

// Track variables used in summary/report — initialize with defaults
let queriesToRun = [];
let discoveredChannelIds = new Set();
let withEmailCount = 0;
let candidatesCount = 0;
let quotaUsed = 0;
let nextQueryIndex = searchState.queryIndex;

if (emailQueue.length < QUEUE_THRESHOLD) {
  console.log(`📋 Queue below threshold (${emailQueue.length}/${QUEUE_THRESHOLD}) — searching for more...\n`);

  // ─── Search YouTube Videos ──────────────────────────────────────────────────

  console.log("=== STEP 1: Searching YouTube videos ===\n");

  // Pick next batch of queries (rotating through pool)
  let startIdx = searchState.queryIndex % QUERY_POOL.length;
  for (let i = 0; i < QUERIES_PER_RUN; i++) {
    queriesToRun.push(QUERY_POOL[(startIdx + i) % QUERY_POOL.length]);
  }
  nextQueryIndex = (startIdx + QUERIES_PER_RUN) % QUERY_POOL.length;

  console.log(`Running queries ${startIdx} to ${startIdx + QUERIES_PER_RUN - 1} (of ${QUERY_POOL.length} total)\n`);

  let quotaExceeded = false;

  // Reserve quota for channel detail fetches (Step 2)
  const QUOTA_PER_KEY = 10_000;
  const TOTAL_QUOTA = YOUTUBE_API_KEYS.length * QUOTA_PER_KEY;
  const MAX_SEARCH_QUOTA = Math.floor(TOTAL_QUOTA * 0.7);
  const QUOTA_RESERVE_FOR_DETAILS = TOTAL_QUOTA - MAX_SEARCH_QUOTA;

  const MAX_CHANNELS = 15_000;

  console.log(`  Quota budget: ${TOTAL_QUOTA} total, ${MAX_SEARCH_QUOTA} for search, ${QUOTA_RESERVE_FOR_DETAILS} reserved for details`);
  console.log(`  Max channels cap: ${MAX_CHANNELS}\n`);

  for (const query of queriesToRun) {
    if (quotaExceeded) break;
    if (quotaUsed >= MAX_SEARCH_QUOTA) {
      console.log(`  ⏹️  Search quota budget reached (${quotaUsed}/${MAX_SEARCH_QUOTA}) — saving rest for details`);
      break;
    }
    if (discoveredChannelIds.size >= MAX_CHANNELS) {
      console.log(`  ⏹️  Channel cap reached (${discoveredChannelIds.size}/${MAX_CHANNELS}) — moving to details`);
      break;
    }
    
    let pageToken = "";
    let pageNum = 0;
    const MAX_PAGES = 3;
    
    while (pageNum < MAX_PAGES && !quotaExceeded) {
      try {
        const params = {
          part: "snippet",
          q: query.q,
          type: "video",
          maxResults: "50",
          relevanceLanguage: "es",
        };
        if (query.duration) params.videoDuration = query.duration;
        if (query.order) params.order = query.order;
        if (query.region) params.regionCode = query.region;
        if (pageToken) params.pageToken = pageToken;
        
        const data = await ytGet("search", params);
        quotaUsed += 100;
        pageNum++;

        for (const item of data.items || []) {
          const channelId = item.snippet?.channelId;
          if (channelId) {
            discoveredChannelIds.add(channelId);
          }
        }
        
        pageToken = data.nextPageToken || "";
        if (!pageToken) break; // No more pages
        
      } catch (e) {
        if (e.message === "QUOTA_EXCEEDED") {
          quotaExceeded = true;
          console.log(`  ⚠️  Quota exceeded — stopping searches`);
        } else {
          console.log(`  ❌ Error: ${e.message}`);
          break;
        }
      }
      await sleep(100);
    }
    
    // Log after all pages for this query
    if (!quotaExceeded) {
      const label = query.q.substring(0, 45);
      console.log(
        `  ✅ "${label}" (${pageNum}p) → unique channels: ${discoveredChannelIds.size}`
      );
    }
    await sleep(100);
  }

  console.log(`\nTotal unique channel IDs discovered: ${discoveredChannelIds.size}`);
  console.log(`Quota used on searches: ~${quotaUsed} units\n`);

  // ─── Fetch Channel Details ────────────────────────────────────────────────

  if (discoveredChannelIds.size > 0) {
    console.log("=== STEP 2: Fetching channel details ===\n");

    // Reset quota state: try all keys again for details
    quotaExceeded = false;
    currentKeyIndex = 0;

    // Only fetch details for channels NOT already in our cache
    const allDiscoveredIds = [...discoveredChannelIds];
    const newChannelIds = allDiscoveredIds.filter(id => !knownChannelIds.has(id));
    console.log(`  Discovered: ${allDiscoveredIds.length} total, ${allDiscoveredIds.length - newChannelIds.length} already cached, ${newChannelIds.length} NEW\n`);

    const channelIdArray = newChannelIds;
    const channels = [];
    const BATCH_SIZE = 50;

    for (let i = 0; i < channelIdArray.length; i += BATCH_SIZE) {
      if (quotaExceeded) break;

      const batch = channelIdArray.slice(i, i + BATCH_SIZE);
      try {
        const data = await ytGet("channels", {
          part: "snippet,statistics",
          id: batch.join(","),
        });
        quotaUsed += 1;

        for (const ch of data.items || []) {
          const desc = ch.snippet?.description || "";
          const emails = extractEmails(desc);

          channels.push({
            title: ch.snippet.title,
            channelId: ch.id,
            country: ch.snippet?.country || "",
            subscribers: parseInt(ch.statistics?.subscriberCount || "0"),
            viewCount: parseInt(ch.statistics?.viewCount || "0"),
            videoCount: parseInt(ch.statistics?.videoCount || "0"),
            emails: emails.join(";"),
            url: `https://youtube.com/channel/${ch.id}`,
          });
        }

        process.stdout.write(
          `  Fetched ${Math.min(i + BATCH_SIZE, channelIdArray.length)}/${channelIdArray.length} channels\r`
        );
      } catch (e) {
        if (e.message === "QUOTA_EXCEEDED") {
          console.log("\n  ⚠️  Quota exceeded during channel fetch");
          quotaExceeded = true;
        } else {
          console.log(`\n  ❌ Error fetching batch: ${e.message}`);
        }
      }

      await sleep(100);
    }

    console.log(`\nChannels with details: ${channels.length}`);
    console.log(`Quota used so far: ~${quotaUsed} units\n`);

    // ─── Filter & Score ─────────────────────────────────────────────────────

    console.log("=== STEP 3: Filtering & scoring channels ===\n");

    // Collect emails already in queue to avoid duplicates
    const queueEmails = new Set(emailQueue.map(item => item.primaryEmail.toLowerCase()));
    const queueChannelIds = new Set(emailQueue.map(item => item.channelId));

    // Keep only channels with emails that haven't been contacted
    const seenEmails = new Set([...sentEmails, ...queueEmails]);
    const candidates = [];

    const withEmail = channels
      .filter((ch) => ch.emails && ch.emails.trim().length > 0)
      .filter((ch) => !sentChannelIds.has(ch.channelId))
      .filter((ch) => !queueChannelIds.has(ch.channelId))
      .filter((ch) => ch.subscribers >= MIN_SUBSCRIBERS);

    withEmailCount = withEmail.length;
    console.log(`Channels with email (≥${MIN_SUBSCRIBERS / 1000}K subs): ${withEmail.length}`);

    // Deduplicate by email
    for (const ch of withEmail) {
      const emails = ch.emails
        .split(";")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const newEmails = emails.filter((e) => !seenEmails.has(e));

      if (newEmails.length > 0) {
        newEmails.forEach((e) => seenEmails.add(e));
        // Use first new email as the primary contact
        ch.primaryEmail = newEmails[0];
        ch.score = scoreChannel(ch);
        candidates.push(ch);
      }
    }

    candidatesCount = candidates.length;
    console.log(`Candidates after dedup: ${candidates.length}`);

    // Add candidates to email queue
    for (const ch of candidates) {
      emailQueue.push({
        title: ch.title,
        cleanName: cleanName(ch.title),
        channelId: ch.channelId,
        country: ch.country,
        subscribers: ch.subscribers,
        videoCount: ch.videoCount,
        emails: ch.emails,
        primaryEmail: ch.primaryEmail,
        score: ch.score,
        discoveredDate: new Date().toISOString(),
      });
    }

    console.log(`📋 Queue after discovery: ${emailQueue.length} pending\n`);

    // Update discovered IDs cache
    for (const id of allDiscoveredIds) knownChannelIds.add(id);
    writeFileSync("discovered_ids.json", JSON.stringify([...knownChannelIds]));
    console.log(`📝 Updated discovered_ids.json: ${discoveredCache.length} → ${knownChannelIds.size} IDs\n`);
  } else {
    console.log("⚠️  No channels discovered from search.\n");
  }
} else {
  console.log(`📋 Queue has ${emailQueue.length} pending (≥${QUEUE_THRESHOLD}) — skipping search, saving quota\n`);
}

// ─── Step E: Send Emails from Queue ─────────────────────────────────────────

// Check if queue has items to send
if (emailQueue.length === 0) {
  console.log("⚠️  Email queue is empty and no new candidates found. Saving state and exiting.");
  searchState.queryIndex = nextQueryIndex;
  searchState.lastRun = new Date().toISOString();
  writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
  writeFileSync("email_queue.json", JSON.stringify(emailQueue, null, 2));
  process.exit(0);
}

// Sort queue by score (highest first)
emailQueue.sort((a, b) => b.score - a.score);

// Take top items to send today
const toSendToday = emailQueue.slice(0, MAX_EMAILS_PER_DAY);

console.log(`=== STEP 4: Sending emails (${toSendToday.length} from queue) ===\n`);

// Print candidates
console.log("     Canal                                          Subs     Score  Email");
console.log("     " + "─".repeat(95));
for (let i = 0; i < toSendToday.length; i++) {
  const ch = toSendToday[i];
  const name = ch.cleanName || cleanName(ch.title);
  const subs =
    ch.subscribers >= 1e6
      ? (ch.subscribers / 1e6).toFixed(1) + "M"
      : (ch.subscribers / 1e3).toFixed(0) + "K";
  console.log(
    `${String(i + 1).padStart(3)}. ${name.substring(0, 45).padEnd(45)} ${subs.padStart(8)}  ${String(ch.score).padStart(4)}  ${ch.primaryEmail}`
  );
}

console.log("");

const newSendResults = [];
let sentCount = 0;
let failedCount = 0;

const senderSentCount = SENDERS.map(() => 0);

function getSenderForNext() {
  for (let i = 0; i < SENDERS.length; i++) {
    if (senderSentCount[i] < SENDERS[i].limit) return i;
  }
  return -1;
}

for (const ch of toSendToday) {
  const senderIdx = getSenderForNext();
  if (senderIdx === -1) {
    console.log("⚠️  All senders at daily limit — stopping");
    break;
  }

  const senderEmail = SENDERS[senderIdx].email;
  const name = ch.cleanName || cleanName(ch.title);
  const email = ch.primaryEmail;

  const htmlBody = `<p>Hola equipo de ${name},</p><p>Clipzi (https://clipzi.app/) convierte videos largos en clips para TikTok, Reels y Shorts. Suben el video, la IA encuentra los mejores momentos, y luego los ajustan en un editor visual.</p><p>Damos 2 videos gratis por mes para probar el flujo. Si después necesitan más uso o más funciones, hay planes pagos.</p><p>Si les interesa, podemos hacer algo específico para ${name}.</p><p>${SENDER_NAME}<br/>Co-founder &amp; CEO, Clipzi</p>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `${SENDER_NAME} <${senderEmail}>`,
        to: [email],
        subject: `${name} x Clipzi`,
        html: htmlBody,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      sentCount++;
      senderSentCount[senderIdx]++;
      console.log(`✅ ${String(sentCount).padStart(3)}. [${senderEmail}] ${name.padEnd(35)} → ${email}`);
      newSendResults.push({
        channel: ch.title,
        cleanName: name,
        email,
        sentFrom: senderEmail,
        channelId: ch.channelId,
        subscribers: ch.subscribers,
        score: ch.score,
        status: "sent",
        id: data.id,
        date: new Date().toISOString(),
      });
    } else {
      failedCount++;
      console.log(`❌ ${name.padEnd(40)} → ${email} (${data.message || data.statusCode || "unknown error"})`);
      newSendResults.push({
        channel: ch.title,
        cleanName: name,
        email,
        channelId: ch.channelId,
        status: "failed",
        error: data.message || JSON.stringify(data),
        date: new Date().toISOString(),
      });
    }
  } catch (err) {
    failedCount++;
    console.log(`❌ ${name.padEnd(40)} → ${email} (${err.message})`);
    newSendResults.push({
      channel: ch.title,
      cleanName: name,
      email,
      channelId: ch.channelId,
      status: "error",
      error: err.message,
      date: new Date().toISOString(),
    });
  }

  await sleep(SEND_DELAY_MS);
}

// ─── Step F: Save State ─────────────────────────────────────────────────────

console.log("\n=== STEP 5: Saving state ===\n");

// Remove sent items from queue
const sentIds = new Set(newSendResults.filter(r => r.status === "sent").map(r => r.channelId));
// Also remove failed items from queue (don't retry broken emails)
const attemptedIds = new Set(newSendResults.map(r => r.channelId));
emailQueue = emailQueue.filter(item => !attemptedIds.has(item.channelId));

// Save email queue
writeFileSync("email_queue.json", JSON.stringify(emailQueue, null, 2));
console.log(`📋 Updated email_queue.json: ${emailQueue.length} remaining`);

// Append successful sends to send_results.json
const successfulSends = newSendResults.filter((r) => r.status === "sent");
const updatedSendResults = [...sendResults, ...successfulSends];
writeFileSync("send_results.json", JSON.stringify(updatedSendResults, null, 2));
console.log(`📝 Updated send_results.json: ${sendResults.length} → ${updatedSendResults.length} entries`);

// Update discovered IDs cache (if not already saved during search step)
// This is a no-op if search ran (already saved above), but handles the skip-search case
writeFileSync("discovered_ids.json", JSON.stringify([...knownChannelIds]));
console.log(`📝 Updated discovered_ids.json: ${knownChannelIds.size} IDs`);

// Update search state
searchState.queryIndex = nextQueryIndex;
searchState.lastRun = new Date().toISOString();
searchState.totalSent = updatedSendResults.length;
writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
console.log(`📝 Updated search_state.json: next query index = ${nextQueryIndex}`);

// ─── Summary ────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  📊 DAILY OUTREACH SUMMARY");
console.log("═══════════════════════════════════════════════════");
console.log(`  📋 Queue before: ${queueBefore}`);
console.log(`  📋 Queue after: ${emailQueue.length}`);
console.log(`  🔍 Video searches run: ${queriesToRun.length}`);
console.log(`  📺 Channels discovered: ${discoveredChannelIds.size}`);
console.log(`  📧 Channels with email: ${withEmailCount}`);
console.log(`  🎯 New candidates added to queue: ${candidatesCount}`);
console.log(`  ✅ Emails sent: ${sentCount}`);
console.log(`  ❌ Emails failed: ${failedCount}`);
console.log(`  📊 Total emails all-time: ${updatedSendResults.length}`);
console.log(`  ⚡ Quota used: ~${quotaUsed} units`);
console.log(`  🔄 Next query index: ${nextQueryIndex}`);
console.log("═══════════════════════════════════════════════════\n");

// ─── Step G: Send Report Email ──────────────────────────────────────────────

if (newSendResults.length > 0) {
  console.log("=== STEP 6: Sending report to gonzaloorsi@gmail.com ===\n");

  const today = new Date().toISOString().split("T")[0];

  const tableRows = newSendResults.map((r) => {
    const subs = r.subscribers >= 1e6
      ? (r.subscribers / 1e6).toFixed(1) + "M"
      : (r.subscribers / 1e3).toFixed(0) + "K";
    const status = r.status === "sent"
      ? "✅ Enviado"
      : `❌ ${r.error || "Error"}`;
    const from = r.sentFrom || "-";
    return `<tr>
      <td style="padding:8px;border:1px solid #ddd;">${r.cleanName || r.channel}</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;">${subs}</td>
      <td style="padding:8px;border:1px solid #ddd;">${r.email}</td>
      <td style="padding:8px;border:1px solid #ddd;">${from}</td>
      <td style="padding:8px;border:1px solid #ddd;">${status}</td>
    </tr>`;
  }).join("");

  const reportHtml = `
    <h2>Clipzi Outreach Report — ${today}</h2>
    <p>
      <strong>Queue before:</strong> ${queueBefore} |
      <strong>Queue after:</strong> ${emailQueue.length} |
      <strong>Video searches:</strong> ${queriesToRun.length} |
      <strong>Canales descubiertos:</strong> ${discoveredChannelIds.size} |
      <strong>Con email:</strong> ${withEmailCount} |
      <strong>Nuevos en cola:</strong> ${candidatesCount} |
      <strong>Enviados:</strong> ${sentCount} |
      <strong>Fallidos:</strong> ${failedCount} |
      <strong>Total histórico:</strong> ${updatedSendResults.length}
    </p>
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px;">
      <thead>
        <tr style="background:#f5f5f5;">
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Canal</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:right;">Subs</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Email</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Desde</th>
          <th style="padding:8px;border:1px solid #ddd;text-align:left;">Estado</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;

  try {
    const reportRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: `Clipzi Outreach Bot <${SENDERS[0].email}>`,
        to: ["gonzaloorsi@gmail.com"],
        subject: `Outreach Report ${today} — ${sentCount} enviados, ${updatedSendResults.length} total`,
        html: reportHtml,
      }),
    });
    if (reportRes.ok) {
      console.log("📧 Report sent to gonzaloorsi@gmail.com");
    } else {
      const err = await reportRes.json();
      console.log(`❌ Failed to send report: ${err.message}`);
    }
  } catch (err) {
    console.log(`❌ Failed to send report: ${err.message}`);
  }
} else {
  console.log("📭 No sends today — skipping report email.");
}
