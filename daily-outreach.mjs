// daily-outreach.mjs
// Automated daily YouTube outreach for Clipzi
// Searches YouTube for channels with emails, scores them, sends personalized emails via Resend

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

// ─── Search Query Pool (~200 unique queries) ────────────────────────────────
// These are all NEW queries — not overlapping with fetch-channels.mjs,
// scrape-channels.mjs, fetch-batch3.mjs, or fetch-batch4.mjs
const QUERY_POOL = [
  // ── Gaming (specific titles not covered before) ──
  "canal español valorant gameplay",
  "canal español gta roleplay",
  "canal español league of legends lol",
  "canal español free fire latino",
  "canal español apex legends",
  "canal español call of duty warzone español",
  "canal español fifa ea fc 2024",
  "canal español dead by daylight",
  "canal español among us español",
  "canal español horror game terror",

  // ── Specific sports (not in previous batches) ──
  "canal youtube padel español",
  "canal youtube natación swimming español",
  "canal youtube volleyball voley español",
  "canal youtube rugby latino",
  "canal youtube rally motocross español",
  "canal youtube lucha wrestling español",
  "canal youtube skateboard patineta español",
  "canal youtube artes marciales karate español",
  "canal youtube polo caballo argentino",
  "canal youtube atletismo correr español",

  // ── Music sub-genres ──
  "canal youtube cumbia argentina villera",
  "canal youtube salsa bachata latino",
  "canal youtube trap latino artista",
  "canal youtube flamenco guitarra español",
  "canal youtube metal rock pesado español",
  "canal youtube folklore folclore argentino",
  "canal youtube pop latino cantante",
  "canal youtube hip hop rap latino",
  "canal youtube instrumental lofi español",
  "canal youtube reggae ska latino",

  // ── Education (specific subjects) ──
  "canal youtube química ciencias español",
  "canal youtube biología naturales español",
  "canal youtube programación python español",
  "canal youtube inteligencia artificial AI español",
  "canal youtube geografía mapas español",
  "canal youtube astronomía espacio universo español",
  "canal youtube contabilidad contaduría español",
  "canal youtube derecho leyes estudiar español",
  "canal youtube economía macro micro español",
  "canal youtube literatura libros español",

  // ── Professional/career channels ──
  "canal youtube ingeniero ingeniería español",
  "canal youtube dentista odontología español",
  "canal youtube veterinario animales español",
  "canal youtube nutriólogo alimentación español",
  "canal youtube fisioterapeuta rehabilitación español",
  "canal youtube farmacia farmacéutico español",
  "canal youtube enfermero enfermería español",
  "canal youtube contador impuestos español",
  "canal youtube profesor maestro educación español",
  "canal youtube bombero rescate emergencia español",

  // ── Country-specific (not yet used) ──
  "youtuber boliviano bolivia canal",
  "youtuber paraguayo paraguay canal",
  "youtuber salvadoreño el salvador canal",
  "youtuber hondureño honduras canal",
  "youtuber guatemalteco guatemala canal",
  "youtuber panameño panama canal",
  "youtuber costarricense costa rica canal",
  "youtuber nicaragüense nicaragua canal",
  "youtuber cubano cuba canal",
  "youtuber puertorriqueño puerto rico canal",

  // ── City-specific ──
  "canal youtube guadalajara jalisco",
  "canal youtube monterrey nuevo leon",
  "canal youtube bogotá colombia creador",
  "canal youtube medellín antioquia",
  "canal youtube lima perú creador",
  "canal youtube santiago chile creador",
  "canal youtube madrid españa creador",
  "canal youtube barcelona españa creador",
  "canal youtube buenos aires ciudad creador",
  "canal youtube quito ecuador creador",

  // ── Food & Drink specifics ──
  "canal youtube asado parrilla carne español",
  "canal youtube vino sommelier cata español",
  "canal youtube cerveza artesanal craft español",
  "canal youtube sushi comida japonesa español",
  "canal youtube comida vegana vegetariana español",
  "canal youtube pastelería tortas decoración español",
  "canal youtube comida callejera street food latino",
  "canal youtube comida mexicana tacos español",
  "canal youtube comida peruana ceviche",
  "canal youtube mate yerba argentina",

  // ── Tech specifics (not covered) ──
  "canal youtube smartphone celular review español",
  "canal youtube apple iphone mac español",
  "canal youtube samsung galaxy android español",
  "canal youtube laptop notebook review español",
  "canal youtube apps aplicaciones móvil español",
  "canal youtube software programas gratis español",
  "canal youtube ciberseguridad hacking ético español",
  "canal youtube linux ubuntu código abierto español",
  "canal youtube domótica smart home español",
  "canal youtube inteligencia artificial chatgpt español",

  // ── Family & Parenting ──
  "canal youtube maternidad mamá embarazo español",
  "canal youtube paternidad papá bebé español",
  "canal youtube familia numerosa hijos español",
  "canal youtube homeschooling educación casa español",
  "canal youtube juguetes niños español latino",
  "canal youtube adolescentes jóvenes español",
  "canal youtube crianza respetuosa español",
  "canal youtube recetas niños familia español",
  "canal youtube actividades infantiles manualidades español",
  "canal youtube gemelos mellizos familia español",

  // ── Finance/Business (specific sub-niches) ──
  "canal youtube trading forex español",
  "canal youtube ahorro dinero finanzas español",
  "canal youtube jubilación retiro pensión español",
  "canal youtube presupuesto deudas español",
  "canal youtube negocio online ganar dinero español",
  "canal youtube empleo trabajo freelance español",
  "canal youtube bienes raíces rentar español",
  "canal youtube impuestos sat declaración español",
  "canal youtube economía familiar ahorro español",
  "canal youtube startup venture capital español",

  // ── Film/TV/Entertainment ──
  "canal youtube series netflix recomendación español",
  "canal youtube terror horror película español",
  "canal youtube ciencia ficción movie español",
  "canal youtube anime otaku japonés español",
  "canal youtube webtoon manhwa manga español",
  "canal youtube k-pop kpop coreano español",
  "canal youtube k-drama doramas español",
  "canal youtube superhéroes marvel dc español",
  "canal youtube star wars universo español",
  "canal youtube cómics historietas español",

  // ── Social Media & Creator Economy ──
  "canal youtube crecer tiktok seguidores español",
  "canal youtube instagram reels estrategia español",
  "canal youtube monetizar youtube adsense español",
  "canal youtube editar videos celular español",
  "canal youtube thumbnail miniatura youtube español",
  "canal youtube seo youtube posicionamiento español",
  "canal youtube streaming obs setup español",
  "canal youtube contenido viral tips español",
  "canal youtube marca personal branding español",
  "canal youtube influencer marketing español",

  // ── Cars/Vehicles (specific) ──
  "canal youtube tuning modificación autos español",
  "canal youtube drift carreras español",
  "canal youtube fórmula 1 f1 español",
  "canal youtube mecánica automotriz taller español",
  "canal youtube motos chopper custom español",
  "canal youtube camiones truck español",
  "canal youtube autos clásicos restauración español",
  "canal youtube eléctricos tesla ev español",
  "canal youtube karting go kart español",
  "canal youtube tractores maquinaria agrícola español",

  // ── Home & Lifestyle ──
  "canal youtube organización minimalismo casa español",
  "canal youtube tiny house pequeña casa español",
  "canal youtube departamento decorar pequeño español",
  "canal youtube mudanza primer depto español",
  "canal youtube limpieza orden hogar español",
  "canal youtube reciclaje upcycling español",
  "canal youtube huerto urbano terraza español",
  "canal youtube feng shui casa energía español",
  "canal youtube roomtour casa tour español",
  "canal youtube renovación pintura pared español",

  // ── Wellness & Alternative ──
  "canal youtube meditación mindfulness calma español",
  "canal youtube reiki energía sanación español",
  "canal youtube herbología plantas medicinales español",
  "canal youtube aceites esenciales aromaterapia español",
  "canal youtube ayurveda natural bienestar español",
  "canal youtube pilates stretching flexibilidad español",
  "canal youtube running trail senderismo español",
  "canal youtube dieta keto intermitente español",
  "canal youtube salud dental cuidado español",
  "canal youtube dermatología skincare piel español",

  // ── Formats (specific video styles) ──
  "canal youtube mukbang comida español",
  "canal youtube haul compras ropa español",
  "canal youtube grwm arréglate conmigo español",
  "canal youtube challenge reto viral español",
  "canal youtube prank broma cámara oculta español",
  "canal youtube speedrun gaming español",
  "canal youtube tier list ranking español",
  "canal youtube unboxing coleccionable español",
  "canal youtube compilación mejores momentos español",
  "canal youtube directo live en vivo español",

  // ── Niche hobbies ──
  "canal youtube lego construcción colección español",
  "canal youtube modelismo maqueta escala español",
  "canal youtube astronomía telescopio español",
  "canal youtube camping acampar naturaleza español",
  "canal youtube supervivencia bushcraft español",
  "canal youtube numismática monedas colección español",
  "canal youtube origami papel manualidad español",
  "canal youtube magia trucos ilusionismo español",
  "canal youtube aeromodelismo aviones rc español",
  "canal youtube acuarismo peces tropicales español",

  // ── Regional media & entertainment ──
  "canal youtube telenovela novela latino",
  "canal youtube radio programa locutor español",
  "canal youtube crónica barrio urbano latino",
  "canal youtube carnaval fiesta tradición latino",
  "canal youtube folklore danza típica latino",
  "canal youtube gastronomía regional pueblos español",
  "canal youtube mercado tianguis feria latino",
  "canal youtube fútbol femenil mujeres español",
  "canal youtube esports competitivo latino",
  "canal youtube beatbox freestyle competencia español",

  // ── Additional diverse niches ──
  "canal youtube astronomía planetario nasa español",
  "canal youtube robótica arduino raspberry español",
  "canal youtube empanadas comida típica latino",
  "canal youtube misterio leyendas urbanas español",
  "canal youtube inversiones acciones bolsa español",
  "canal youtube retro vintage nostalgia español",
  "canal youtube rap batalla gallos español",
  "canal youtube cine independiente corto español",
  "canal youtube diseño web freelancer español",
  "canal youtube educación financiera jóvenes español",

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW QUERIES (300+) — Added to expand discovery pool to 500+
  // ═══════════════════════════════════════════════════════════════════════════

  // ── Country + Niche combos: Argentina ──
  "youtuber argentino fitness",
  "youtuber argentino cocina recetas",
  "youtuber argentino gaming",
  "youtuber argentino comedia humor",
  "youtuber argentino viajes turismo",
  "youtuber argentino tecnología review",
  "youtuber argentino música cantante",
  "youtuber argentino moda fashion",
  "youtuber argentino finanzas inversiones",
  "youtuber argentino educación ciencia",

  // ── Country + Niche combos: México ──
  "youtuber mexicano fitness gym",
  "youtuber mexicano cocina comida",
  "youtuber mexicano gaming videojuegos",
  "youtuber mexicano comedia sketches",
  "youtuber mexicano viajes turismo",
  "youtuber mexicano tecnología gadgets",
  "youtuber mexicano música banda",
  "youtuber mexicano moda belleza",
  "youtuber mexicano negocios emprendimiento",
  "youtuber mexicano educación tutorial",

  // ── Country + Niche combos: Colombia ──
  "youtuber colombiano fitness ejercicio",
  "youtuber colombiano cocina colombiana",
  "youtuber colombiano gaming streaming",
  "youtuber colombiano comedia parodia",
  "youtuber colombiano viajes aventura",
  "youtuber colombiano tecnología celulares",
  "youtuber colombiano música reggaeton",
  "youtuber colombiano moda tendencias",
  "youtuber colombiano negocios dinero",
  "youtuber colombiano educación ciencias",

  // ── Country + Niche combos: Chile ──
  "youtuber chileno fitness deporte",
  "youtuber chileno cocina receta chilena",
  "youtuber chileno gaming minecraft",
  "youtuber chileno comedia standup",
  "youtuber chileno viajes mochilero",
  "youtuber chileno tecnología unboxing",
  "youtuber chileno música rap",
  "youtuber chileno moda streetwear",
  "youtuber chileno finanzas ahorro",
  "youtuber chileno ciencia divulgación",

  // ── Country + Niche combos: Perú ──
  "youtuber peruano fitness crossfit",
  "youtuber peruano cocina peruana ceviche",
  "youtuber peruano gaming fortnite",
  "youtuber peruano comedia imitación",
  "youtuber peruano viajes perú turismo",
  "youtuber peruano tecnología review",
  "youtuber peruano música criolla",
  "youtuber peruano emprendimiento negocio",
  "youtuber peruano educación mate",
  "youtuber peruano historia cultura",

  // ── Country + Niche combos: España ──
  "youtuber español fitness rutina",
  "youtuber español cocina española",
  "youtuber español gaming ps5 xbox",
  "youtuber español comedia monólogo",
  "youtuber español viajes europa",
  "youtuber español tecnología apple android",
  "youtuber español música indie",
  "youtuber español moda hombre",
  "youtuber español finanzas criptomonedas",
  "youtuber español ciencia curiosidades",

  // ── Country + Niche combos: Venezuela ──
  "youtuber venezolano en españa",
  "youtuber venezolano comida venezolana",
  "youtuber venezolano gaming roblox",
  "youtuber venezolano comedia venezolana",
  "youtuber venezolano emprendimiento",

  // ── Country + Niche combos: Ecuador / Uruguay ──
  "youtuber ecuatoriano ecuador contenido",
  "youtuber uruguayo uruguay canal",
  "youtuber dominicano república dominicana",
  "creador contenido centroamérica youtube",
  "youtuber caribeño latino canal",

  // ── Specific sub-niches not previously covered ──
  "canal español tarot lectura cartas",
  "canal español astrología horóscopo signos",
  "canal español crochet tejido ganchillo",
  "canal español guitarra tutorial principiante",
  "canal español piano tutorial clases",
  "canal español batería drums tutorial español",
  "canal español bajo eléctrico bass español",
  "canal español ukulele tutorial español",
  "canal español violín tutorial clásico español",
  "canal español producción musical beat español",
  "canal español cerámica alfarería barro",
  "canal español carpintería madera proyectos",
  "canal español soldadura metalurgia taller",
  "canal español joyería bisutería artesanal",
  "canal español bordado punto cruz costura",

  // ── Regional / City variations ──
  "creador contenido Rosario Argentina youtube",
  "youtuber Córdoba Argentina canal",
  "youtuber Cancún México canal",
  "youtuber Puebla México contenido",
  "youtuber Cali Colombia canal",
  "youtuber Barranquilla Colombia creador",
  "youtuber Arequipa Perú canal",
  "youtuber Valparaíso Chile creador",
  "youtuber Sevilla España canal",
  "youtuber Valencia España contenido",
  "youtuber Bilbao País Vasco canal",
  "youtuber Málaga España creador",
  "youtuber Quito Ecuador creador contenido",
  "youtuber Guayaquil Ecuador canal",
  "youtuber Montevideo Uruguay creador",
  "youtuber Asunción Paraguay canal",
  "youtuber La Paz Bolivia creador",
  "youtuber San José Costa Rica canal",
  "youtuber Santo Domingo República Dominicana",
  "youtuber Panamá City creador contenido",

  // ── Podcast variations ──
  "podcast español true crime crimen",
  "podcast español comedia humor risas",
  "podcast español negocios emprendimiento",
  "podcast español psicología salud mental",
  "podcast español historia relatos",
  "podcast español ciencia tecnología",
  "podcast español entrevistas famosos",
  "podcast español desarrollo personal",
  "podcast español política actualidad",
  "podcast español deportes fútbol",
  "podcast español terror misterio",
  "podcast español feminismo género",
  "podcast español filosofía pensamiento",
  "podcast español música artistas",
  "podcast latino spotify youtube",

  // ── Platform crossover terms ──
  "tiktoker español youtube canal",
  "tiktoker latino youtube videos",
  "streamer español youtube twitch",
  "streamer latino youtube gaming",
  "instagramer español youtube canal",
  "instagramer latino contenido youtube",
  "influencer español tiktok youtube",
  "influencer latino redes sociales youtube",
  "creador contenido digital español youtube",
  "creador contenido digital latino youtube",

  // ── Year-specific queries ──
  "nuevo canal youtube español 2024",
  "nuevo canal youtube latino 2024",
  "youtuber nuevo español 2025",
  "youtuber nuevo latino 2025",
  "canales youtube español tendencia 2024",
  "canales youtube español creciendo 2025",
  "mejores canales youtube español nuevos 2024",
  "youtubers emergentes español 2024",
  "youtubers emergentes latino 2025",
  "nuevo youtuber hispano 2024",

  // ── Size-specific queries ──
  "canal youtube español pequeño creciendo",
  "canal youtube latino pequeño emergente",
  "youtuber emergente latino suscriptores",
  "youtuber emergente español nuevo",
  "canal youtube español underrated infravalorado",
  "canal youtube español poco conocido recomendado",
  "youtuber español menos de 100k suscriptores",
  "youtuber latino menos de 50k suscriptores",
  "canal youtube español oculto joya escondida",
  "youtuber hispano promesa talento",

  // ── Language-learning specific ──
  "aprender español youtube canal",
  "español para extranjeros youtube clases",
  "learn spanish youtube channel",
  "spanish teacher youtube lessons",
  "profesor español youtube lecciones",
  "spanish language learning youtube",
  "español para principiantes youtube",
  "hablar español youtube tutorial",
  "gramática español youtube clase",
  "vocabulario español youtube aprender",

  // ── DIY & Crafts expanded ──
  "canal español DIY hazlo tú mismo proyectos",
  "canal español manualidades papel cartón",
  "canal español pintura óleo acrílico arte",
  "canal español dibujo ilustración digital",
  "canal español lettering caligrafía tipografía",
  "canal español resina epoxi manualidades",
  "canal español macramé nudos decoración",
  "canal español scrapbooking álbum recuerdos",
  "canal español velas artesanales jabones",
  "canal español impresión 3D maker español",

  // ── Photography & Video expanded ──
  "canal español fotografía paisaje retrato",
  "canal español edición photoshop lightroom",
  "canal español filmmaking cortometraje cine",
  "canal español drone dron aéreo fpv",
  "canal español cámara Sony Canon Nikon review",
  "canal español cinematografía color grading",
  "canal español video boda evento producción",
  "canal español fotografía celular smartphone",
  "canal español timelapse hyperlapse video",
  "canal español after effects motion graphics",

  // ── Pets & Animals expanded ──
  "canal español perros adiestramiento canino",
  "canal español gatos cuidado felino",
  "canal español acuario pecera peces tropical",
  "canal español aves pájaros loros canarios",
  "canal español reptiles serpientes lagartos",
  "canal español caballos equitación hípica",
  "canal español granja animales campo rural",
  "canal español veterinaria cuidado mascota",
  "canal español hamster roedores conejos",
  "canal español insectos entomología bichos",

  // ── Real estate & Architecture ──
  "canal español arquitectura diseño casas",
  "canal español construcción obra albañilería",
  "canal español plomería fontanería electricidad",
  "canal español remodelación antes después casa",
  "canal español container house casa contenedor",

  // ── Niche sports & activities ──
  "canal español escalada bouldering climbing",
  "canal español ciclismo bicicleta mtb ruta",
  "canal español pesca fishing deportiva",
  "canal español buceo diving submarinismo",
  "canal español kayak canoa rafting",
  "canal español golf swing tutorial",
  "canal español tiro arco archery",
  "canal español parkour freerunning",
  "canal español patinaje artístico hielo",
  "canal español triatlón ironman natación",

  // ── Mental health & Self-improvement ──
  "canal español psicología terapia ansiedad",
  "canal español desarrollo personal autoayuda",
  "canal español productividad organización tiempo",
  "canal español hábitos disciplina motivación",
  "canal español inteligencia emocional relaciones",
  "canal español estoicismo filosofía vida",
  "canal español coaching vida profesional",
  "canal español bienestar equilibrio vida",
  "canal español superación personal éxito",
  "canal español comunicación oratoria hablar público",

  // ── Science & History expanded ──
  "canal español paleontología dinosaurios fósiles",
  "canal español física cuántica relatividad",
  "canal español matemáticas paradojas curiosidades",
  "canal español neurociencia cerebro mente",
  "canal español historia antigua roma grecia",
  "canal español historia medieval castillos",
  "canal español mitología dioses leyendas",
  "canal español arqueología descubrimientos",
  "canal español vulcanología volcanes geología",
  "canal español oceanografía mar océano",

  // ── Fashion & Beauty expanded ──
  "canal español maquillaje natural tutorial",
  "canal español cuidado cabello peinados",
  "canal español skincare rutina coreana",
  "canal español uñas nail art manicura",
  "canal español moda sostenible slow fashion",
  "canal español barbería corte cabello hombre",
  "canal español perfumes fragancias reseña",
  "canal español estilo ropa outfit ideas",
  "canal español segunda mano thrift vintage ropa",
  "canal español moda tallas grandes curvy",

  // ── Paranormal & Mystery expanded ──
  "canal español ovnis ufología extraterrestres",
  "canal español conspiraciones teorías secretos",
  "canal español casos criminales sin resolver",
  "canal español fantasmas paranormal evidencia",
  "canal español lugares abandonados urbex exploración",
  "canal español criptozoología criaturas monstruos",
  "canal español enigmas mundo misterios antiguos",
  "canal español documentales misterio investigación",
  "canal español true crime español casos reales",
  "canal español leyendas mitos folklore terror",

  // ── Board games & Tabletop ──
  "canal español juegos mesa board games",
  "canal español dungeons dragons rol mesa",
  "canal español cartas magic pokemon tcg",
  "canal español warhammer miniaturas pintura",
  "canal español ajedrez estrategia partidas",

  // ── Cooking sub-niches expanded ──
  "canal español repostería postres dulces",
  "canal español pan artesanal panadería masa madre",
  "canal español comida saludable meal prep",
  "canal español recetas rápidas fáciles 15 minutos",
  "canal español barbacoa bbq ahumado",
  "canal español fermentación kombucha kimchi",
  "canal español chocolate bombones temperado",
  "canal español cocina italiana pasta pizza",
  "canal español cocina asiática wok sushi",
  "canal español coctelería bartender tragos",

  // ── Automotive sub-niches expanded ──
  "canal español detailing lavado auto",
  "canal español 4x4 offroad todoterreno",
  "canal español scooter moto eléctrica movilidad",
  "canal español autocaravana vanlife camper",
  "canal español accidentes tráfico dashcam",

  // ── General discovery terms (broad net) ──
  "mejores youtubers hispanos recomendados",
  "youtubers latinos que deberías conocer",
  "canales youtube español imperdibles",
  "youtubers en español que no conocías",
  "canales youtube español calidad contenido",
  "top youtubers habla hispana",
  "youtubers latinos recomendación canal",
  "creadores youtube español favoritos",
  "canales español youtube recomendados 2024",
  "youtubers hispanohablantes populares",

  // ── Education specific subjects expanded ──
  "canal español programación javascript web",
  "canal español desarrollo móvil android ios",
  "canal español data science machine learning español",
  "canal español cloud computing AWS Azure español",
  "canal español excel avanzado macros office",
  "canal español diseño gráfico illustrator español",
  "canal español marketing digital seo sem",
  "canal español copywriting redacción ventas",
  "canal español ecommerce tienda online dropshipping",
  "canal español wordpress crear página web",

  // ── Travel sub-niches ──
  "canal español mochilero viaje barato",
  "canal español viaje pareja luna miel",
  "canal español viaje solo mujer seguridad",
  "canal español viaje sudamérica ruta",
  "canal español viaje centroamérica backpacking",
  "canal español viaje españa pueblos rurales",
  "canal español nómada digital trabajar viajando",
  "canal español camino santiago peregrino",
  "canal español crucero barco viaje mar",
  "canal español vuelos baratos tips ahorro",

  // ── Additional general discovery ──
  "canal youtube habla hispana entretenimiento",
  "contenido español youtube suscribirse",
  "youtubers de habla hispana poco conocidos",
  "canal youtube latino arte cultura",
  "youtubers español motivación inspiración",
  "canal español debate opinión actualidad",
  "canal español entrevistas creadores emprendedores",
  "canal español reacción react video español",
  "canal español storytime historia personal",
  "canal español ASMR español relajación",
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

// Load search state
let searchState = { queryIndex: 0, lastRun: null, totalSent: sendResults.length };
try {
  searchState = JSON.parse(readFileSync("search_state.json", "utf-8"));
  console.log(`🔍 Query pool index: ${searchState.queryIndex}/${QUERY_POOL.length}`);
  console.log(`📊 Total sent so far: ${searchState.totalSent}\n`);
} catch (e) {
  console.log("🔍 No search_state.json found, starting from index 0\n");
}

// ─── Step B: Search YouTube ─────────────────────────────────────────────────

console.log("=== STEP 1: Searching YouTube ===\n");

// Pick next batch of queries (rotating through pool)
let startIdx = searchState.queryIndex % QUERY_POOL.length;
const queriesToRun = [];
for (let i = 0; i < QUERIES_PER_RUN; i++) {
  queriesToRun.push(QUERY_POOL[(startIdx + i) % QUERY_POOL.length]);
}
const nextQueryIndex = (startIdx + QUERIES_PER_RUN) % QUERY_POOL.length;

console.log(`Running queries ${startIdx} to ${startIdx + QUERIES_PER_RUN - 1} (of ${QUERY_POOL.length} total)\n`);

const discoveredChannelIds = new Set();
let quotaUsed = 0;
let quotaExceeded = false;

// Reserve quota for channel detail fetches (Step 2)
// Each search page = 100 units. Each detail batch (50 channels) = 1 unit.
// Split budget 70/30: 70% for search, 30% for details.
// With 4 keys = 40K total: 28K search + 12K details (enough for 600K channels)
// Even if keys are partially used, 30% reserve is safe.
const QUOTA_PER_KEY = 10_000;
const TOTAL_QUOTA = YOUTUBE_API_KEYS.length * QUOTA_PER_KEY;
const MAX_SEARCH_QUOTA = Math.floor(TOTAL_QUOTA * 0.7);
const QUOTA_RESERVE_FOR_DETAILS = TOTAL_QUOTA - MAX_SEARCH_QUOTA;

// Also: stop searching if we have enough channels already.
// Details cost 1 unit per 50 channels. Even with 10K channels, details only cost 200 units.
// The real constraint is finding NEW channels with emails, so more search = better.
// But cap at a reasonable number to not waste quota if keys are partially used.
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
        q: query,
        type: "channel",
        maxResults: "50",
        relevanceLanguage: "es",
      };
      if (pageToken) params.pageToken = pageToken;
      
      const data = await ytGet("search", params);
      quotaUsed += 100;
      pageNum++;

      for (const item of data.items || []) {
        const channelId = item.snippet?.channelId || item.id?.channelId;
        if (channelId) {
          discoveredChannelIds.add(channelId);
        }
      }
      
      pageToken = data.nextPageToken || "";
      if (!pageToken) break; // No more pages
      
    } catch (e) {
      if (e.message === "QUOTA_EXCEEDED") {
        console.log(`  ⚠️  Quota exceeded at "${query}" p${pageNum + 1} — stopping searches`);
        quotaExceeded = true;
      } else {
        console.log(`  ❌ Error for "${query}" p${pageNum + 1}: ${e.message}`);
        break;
      }
    }
    await sleep(100);
  }
  
  // Log after all pages for this query
  if (!quotaExceeded) {
    console.log(
      `  ✅ "${query}" (${pageNum}p) → unique: ${discoveredChannelIds.size}`
    );
  }
  await sleep(100);
}

console.log(`\nTotal unique channel IDs discovered: ${discoveredChannelIds.size}`);
console.log(`Quota used on searches: ~${quotaUsed} units\n`);

if (discoveredChannelIds.size === 0) {
  console.log("⚠️  No channels discovered. Saving state and exiting.");
  searchState.queryIndex = nextQueryIndex;
  searchState.lastRun = new Date().toISOString();
  writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
  process.exit(0);
}

// ─── Step C: Fetch Channel Details ──────────────────────────────────────────

console.log("=== STEP 2: Fetching channel details ===\n");

// Reset quota state: try all keys again for details
// Some keys might have been exhausted during search but others might still work
quotaExceeded = false;
currentKeyIndex = 0;

const channelIdArray = [...discoveredChannelIds];
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

// ─── Step D: Filter & Score ─────────────────────────────────────────────────

console.log("=== STEP 3: Filtering & scoring channels ===\n");

// Keep only channels with emails that haven't been contacted
const seenEmails = new Set([...sentEmails]);
const candidates = [];

const withEmail = channels
  .filter((ch) => ch.emails && ch.emails.trim().length > 0)
  .filter((ch) => !sentChannelIds.has(ch.channelId))
  .filter((ch) => ch.subscribers >= MIN_SUBSCRIBERS);

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

console.log(`Candidates after dedup: ${candidates.length}`);

// Sort by score descending and take top MAX_EMAILS_PER_DAY
candidates.sort((a, b) => b.score - a.score);
const toSend = candidates.slice(0, MAX_EMAILS_PER_DAY);

console.log(`Top candidates to email: ${toSend.length}\n`);

if (toSend.length === 0) {
  console.log("⚠️  No new channels to email today. Saving state.");
  searchState.queryIndex = nextQueryIndex;
  searchState.lastRun = new Date().toISOString();
  writeFileSync("search_state.json", JSON.stringify(searchState, null, 2));
  process.exit(0);
}

// Print candidates
console.log("     Canal                                          Subs     Score  Email");
console.log("     " + "─".repeat(95));
for (let i = 0; i < toSend.length; i++) {
  const ch = toSend[i];
  const name = cleanName(ch.title);
  const subs =
    ch.subscribers >= 1e6
      ? (ch.subscribers / 1e6).toFixed(1) + "M"
      : (ch.subscribers / 1e3).toFixed(0) + "K";
  console.log(
    `${String(i + 1).padStart(3)}. ${name.substring(0, 45).padEnd(45)} ${subs.padStart(8)}  ${String(ch.score).padStart(4)}  ${ch.primaryEmail}`
  );
}

// ─── Step E: Send Emails via Resend ─────────────────────────────────────────

console.log("\n=== STEP 4: Sending emails ===\n");

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

for (const ch of toSend) {
  const senderIdx = getSenderForNext();
  if (senderIdx === -1) {
    console.log("⚠️  All senders at daily limit — stopping");
    break;
  }

  const senderEmail = SENDERS[senderIdx].email;
  const name = cleanName(ch.title);
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

// Append successful sends to send_results.json
const successfulSends = newSendResults.filter((r) => r.status === "sent");
const updatedSendResults = [...sendResults, ...successfulSends];
writeFileSync("send_results.json", JSON.stringify(updatedSendResults, null, 2));
console.log(`📝 Updated send_results.json: ${sendResults.length} → ${updatedSendResults.length} entries`);

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
console.log(`  🔍 Queries run: ${queriesToRun.length}`);
console.log(`  📺 Channels discovered: ${discoveredChannelIds.size}`);
console.log(`  📧 Channels with email: ${withEmail.length}`);
console.log(`  🎯 Candidates (new, deduped): ${candidates.length}`);
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
      <strong>Queries:</strong> ${queriesToRun.length} |
      <strong>Canales descubiertos:</strong> ${discoveredChannelIds.size} |
      <strong>Con email:</strong> ${withEmail.length} |
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
