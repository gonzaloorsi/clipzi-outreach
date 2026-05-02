import { writeFileSync } from "fs";

// Comprehensive list of marketing/communication agencies in Chile, Mexico, Spain
// Sourced from industry knowledge, agency associations, award lists
const agencies = {
  chile: [
    { name: "Porta", web: "porta.cl" },
    { name: "McCann Santiago", web: "mccann.cl" },
    { name: "BBDO Chile", web: "bbdo.cl" },
    { name: "Ogilvy Chile", web: "ogilvy.cl" },
    { name: "DDB Chile", web: "ddb.cl" },
    { name: "Grey Chile", web: "grey.cl" },
    { name: "Publicis Chile", web: "publicis.cl" },
    { name: "Wunderman Thompson Chile", web: "wundermanthompson.cl" },
    { name: "Havas Chile", web: "havas.cl" },
    { name: "Leo Burnett Chile", web: "leoburnett.cl" },
    { name: "JWT Chile", web: "jwt.cl" },
    { name: "Lowe Chile", web: "lowessp.cl" },
    { name: "Prolam Y&R", web: "prolam.cl" },
    { name: "Inbrax", web: "inbrax.com" },
    { name: "Jelly", web: "jelly.cl" },
    { name: "Xtreme Marketing", web: "xtrememarketing.cl" },
    { name: "IDA Chile", web: "ida.cl" },
    { name: "Webketing", web: "webketing.cl" },
    { name: "Factor Digital", web: "factordigital.cl" },
    { name: "Staff Creativa Chile", web: "staffcreativa.cl" },
    { name: "Marketmedios", web: "marketmedios.cl" },
    { name: "Rompecabeza Digital", web: "rompecabeza.cl" },
    { name: "Clever Digital", web: "cleverdigital.cl" },
    { name: "Tu Hosting Chile", web: "tuhosting.cl" },
    { name: "Creato", web: "creato.cl" },
    { name: "Agencia Rut", web: "agenciarut.cl" },
    { name: "Notable", web: "notable.cl" },
    { name: "Venditori", web: "venditori.cl" },
    { name: "Mentalidad Web", web: "mentalidadweb.com" },
    { name: "Forma Comunicaciones", web: "formacomunicaciones.cl" },
    { name: "I3net", web: "i3net.cl" },
    { name: "La Cocina Marketing", web: "lacocinamarketing.cl" },
    { name: "Inbound Chile", web: "inbound.cl" },
    { name: "Digital Heads", web: "digitalheads.cl" },
    { name: "Cebra", web: "cebra.cl" },
    { name: "Niu Marketing", web: "niumarketing.cl" },
    { name: "ROI Agency", web: "roiagency.cl" },
    { name: "Attach", web: "attach.cl" },
    { name: "BIG Digital", web: "bigdigital.cl" },
    { name: "MR Agencia", web: "mragencia.cl" },
    { name: "Flock", web: "flock.cl" },
    { name: "Digital Bots", web: "digitalbots.cl" },
    { name: "Simplicity", web: "simplicity.cl" },
    { name: "AB Comunicaciones Chile", web: "abcomunicaciones.cl" },
    { name: "Global Interactive", web: "globalinteractive.cl" },
    { name: "Adity", web: "adity.cl" },
    { name: "NetMinds", web: "netminds.cl" },
    { name: "MATCH Comunicaciones", web: "matchcomunicaciones.cl" },
    { name: "Grupo Lucky", web: "grupolucky.cl" },
    { name: "Digitalízame", web: "digitalizame.cl" },
    { name: "Marketgreen", web: "marketgreen.cl" },
    { name: "Agencia Klare", web: "klare.cl" },
    { name: "Agencia Swell", web: "agenciaswell.cl" },
    { name: "Brand Lab", web: "brandlab.cl" },
    { name: "Mktmarketingdigital", web: "mktmarketingdigital.cl" },
    { name: "Win Win Marketing", web: "winwinmarketing.cl" },
    { name: "Next_U Chile", web: "next-u.cl" },
    { name: "Hic & Nunc", web: "hicetnunc.cl" },
    { name: "Publimark", web: "publimark.cl" },
    { name: "Socialand", web: "socialand.cl" },
    { name: "Soho Agency", web: "sohoagency.cl" },
    { name: "Digital Republic", web: "digitalrepublic.cl" },
    { name: "Agencia Siete", web: "agenciasiete.cl" },
    { name: "Humana Comunicaciones", web: "humana.cl" },
    { name: "Factory Chile", web: "factory.cl" },
    { name: "Digital Marketing Chile", web: "digitalmarketingchile.cl" },
    { name: "Appsol", web: "appsol.cl" },
    { name: "Masdigital", web: "masdigital.cl" },
    { name: "Dobuss Chile", web: "dobuss.cl" },
    { name: "Pixel Factory", web: "pixelfactory.cl" },
    { name: "Agencia Moov", web: "agenciamoov.cl" },
    { name: "Branding Chile", web: "brandingchile.cl" },
    { name: "Idea Works", web: "ideaworks.cl" },
    { name: "SomosAgencia", web: "somosagencia.cl" },
    { name: "1up Digital", web: "1updigital.cl" },
    { name: "Agencia Fusión", web: "agenciafusion.cl" },
    { name: "Web Growth", web: "webgrowth.cl" },
    { name: "Magnolia", web: "magnolia.cl" },
    { name: "Digital Partners Chile", web: "digitalpartners.cl" },
    { name: "Agencia Ping", web: "agenciaping.cl" },
    { name: "M22 Marketing", web: "m22marketing.cl" },
    { name: "Red Design", web: "reddesign.cl" },
    { name: "Impact Media Chile", web: "impactmedia.cl" },
    { name: "Go Digital Chile", web: "godigital.cl" },
    { name: "Smart Digital", web: "smartdigital.cl" },
    { name: "Agency One Chile", web: "agencyone.cl" },
    { name: "Social Boost Chile", web: "socialboost.cl" },
    { name: "Media Source Chile", web: "mediasource.cl" },
    { name: "Lab Digital", web: "labdigital.cl" },
    { name: "Agencia Wow", web: "agenciawow.cl" },
    { name: "Rocket Digital Chile", web: "rocketdigital.cl" },
    { name: "Disruptiva", web: "disruptiva.cl" },
    { name: "Nube Digital Chile", web: "nubedigital.cl" },
    { name: "Medios Digitales Chile", web: "mediosdigitales.cl" },
    { name: "Agencia Delta Chile", web: "agenciadelta.cl" },
    { name: "Fly Media Chile", web: "flymedia.cl" },
    { name: "Target Chile", web: "target.cl" },
    { name: "Nexo Digital Chile", web: "nexodigital.cl" },
    { name: "360 Digital Chile", web: "360digital.cl" },
    { name: "Performly Chile", web: "performly.cl" },
    { name: "Shift Marketing Chile", web: "shiftmarketing.cl" },
  ],
  mexico: [
    { name: "Ogilvy Mexico", web: "ogilvy.com.mx" },
    { name: "McCann Mexico", web: "mccann.com.mx" },
    { name: "BBDO Mexico", web: "bbdo.com.mx" },
    { name: "DDB Mexico", web: "ddb.com.mx" },
    { name: "Publicis Mexico", web: "publicis.com.mx" },
    { name: "Havas Mexico", web: "havas.com.mx" },
    { name: "Leo Burnett Mexico", web: "leoburnett.com.mx" },
    { name: "Grey Mexico", web: "grey.com.mx" },
    { name: "Wunderman Thompson Mexico", web: "wundermanthompson.com.mx" },
    { name: "JWT Mexico", web: "jwt.com.mx" },
    { name: "Ganem Group", web: "ganem.com.mx" },
    { name: "Archer Troy", web: "archertroy.com" },
    { name: "Anónimo", web: "anonimo.com.mx" },
    { name: "Bombay", web: "bombay.mx" },
    { name: "Sparkling", web: "sparkling.com.mx" },
    { name: "Elogia Mexico", web: "elogia.net" },
    { name: "Cliento", web: "clfrankiento.mx" },
    { name: "Media Source", web: "mediasource.mx" },
    { name: "Prospect Factory", web: "prospectfactory.com.mx" },
    { name: "Smartup Mexico", web: "smartup.mx" },
    { name: "Blank", web: "blank.com.mx" },
    { name: "Masclicks", web: "masclicks.com.mx" },
    { name: "Crea Tu Web", web: "creatuweb.mx" },
    { name: "Mijo Brands", web: "mijobrands.com" },
    { name: "Zitro Digital", web: "zitrodigital.com" },
    { name: "Marca Lima", web: "marcalima.com" },
    { name: "Digital Friks", web: "digitalfriks.com" },
    { name: "Rocket Marketing Mexico", web: "rocketmarketing.mx" },
    { name: "BMG Media", web: "bmgmedia.com.mx" },
    { name: "Netcommerce", web: "netcommerce.mx" },
    { name: "Quiroga Agency", web: "quirogaagency.com" },
    { name: "Gou Mx", web: "gou.mx" },
    { name: "Brand Industry", web: "brandindustry.mx" },
    { name: "Digital Business", web: "digitalbusiness.mx" },
    { name: "Merca2.0 Agency", web: "merca20.com" },
    { name: "Serendipia", web: "serendipia.digital" },
    { name: "Nobox Agency", web: "noboxagency.com" },
    { name: "WebSeo", web: "webseo.mx" },
    { name: "Traffic Agency", web: "trafficagency.mx" },
    { name: "Agencia de Marketing Boom", web: "agenciaboom.mx" },
    { name: "Digital Valley", web: "digitalvalley.mx" },
    { name: "Kapital Creative", web: "kapitalcreative.com" },
    { name: "SEM Mexico", web: "semmexico.com" },
    { name: "Posicionamiento Web Mexico", web: "posicionamientoweb.mx" },
    { name: "Marketeros Latam Mexico", web: "marketeroslatam.com" },
    { name: "InboundCycle Mexico", web: "inboundcycle.com/mexico" },
    { name: "Interius", web: "interius.com.mx" },
    { name: "Zebra Advertising", web: "zebraadvertising.com.mx" },
    { name: "Crecimiento Digital", web: "crecimientodigital.mx" },
    { name: "Trece Bits Mexico", web: "trecebits.mx" },
    { name: "Impact Hub Mexico", web: "mexico.impacthub.net" },
    { name: "Glow Marketing", web: "glowmarketing.mx" },
    { name: "Funky Marketing Mexico", web: "funkymarketing.mx" },
    { name: "Inbound Emotion Mexico", web: "inboundemotion.mx" },
    { name: "Galería de Creativos", web: "galeriadecretivos.com" },
    { name: "Clickmedia", web: "clickmedia.mx" },
    { name: "Nativa Global", web: "nativaglobal.com" },
    { name: "Punto Rojo Media", web: "puntorojomedia.com" },
    { name: "Atlas Digital MX", web: "atlasdigital.mx" },
    { name: "Agencia Matrix", web: "agenciamatrix.mx" },
    { name: "Pixel Creativo MX", web: "pixelcreativo.mx" },
    { name: "Social Press MX", web: "socialpress.mx" },
    { name: "Coco Marketing", web: "cocomarketing.mx" },
    { name: "Fuel Digital", web: "fueldigital.mx" },
    { name: "Green Marketing Mexico", web: "greenmarketing.mx" },
    { name: "Agencia Naranja", web: "agencianaranja.mx" },
    { name: "Fast Brand Mexico", web: "fastbrand.mx" },
    { name: "Mr Marketing MX", web: "mrmarketing.mx" },
    { name: "Next Level MX", web: "nextlevel.mx" },
    { name: "Tribal Mexico", web: "tribal.com.mx" },
    { name: "Moove Digital MX", web: "moovedigital.mx" },
    { name: "Linio Marketing", web: "liniomarketing.mx" },
    { name: "Studio 57", web: "studio57.mx" },
    { name: "Red Creativa Mexico", web: "redcreativa.mx" },
    { name: "Prime Marketing MX", web: "primemarketing.mx" },
    { name: "Agencia Impulsa", web: "agenciaimpulsa.mx" },
    { name: "Scale Digital MX", web: "scaledigital.mx" },
    { name: "Mars Digital Mexico", web: "marsdigital.mx" },
    { name: "Bloom Digital MX", web: "bloomdigital.mx" },
    { name: "Wave Marketing MX", web: "wavemarketing.mx" },
    { name: "Fire Media Mexico", web: "firemedia.mx" },
    { name: "Nova Advertising MX", web: "novaadvertising.mx" },
    { name: "Apex Marketing MX", web: "apexmarketing.mx" },
    { name: "Core Digital Mexico", web: "coredigital.mx" },
    { name: "Innova Marketing MX", web: "innovamarketing.mx" },
    { name: "Media Lab Mexico", web: "medialab.mx" },
    { name: "Fusion Agencia MX", web: "fusionagencia.mx" },
    { name: "Zenith Mexico", web: "zenithmedia.com.mx" },
    { name: "Mindshare Mexico", web: "mindshareworld.com.mx" },
    { name: "Starcom Mexico", web: "starcom.com.mx" },
    { name: "OMD Mexico", web: "omd.com.mx" },
    { name: "PHD Mexico", web: "phdmedia.com.mx" },
    { name: "Carat Mexico", web: "carat.com.mx" },
    { name: "Initiative Mexico", web: "initiative.com.mx" },
    { name: "Vizeum Mexico", web: "vizeum.com.mx" },
    { name: "iProspect Mexico", web: "iprospect.com.mx" },
    { name: "Performics Mexico", web: "performics.com.mx" },
    { name: "Possible Mexico", web: "possible.com.mx" },
    { name: "Mullen Lowe Mexico", web: "mullenlowe.com.mx" },
    { name: "FCB Mexico", web: "fcb.com.mx" },
    { name: "VMLY&R Mexico", web: "vmlyr.com.mx" },
  ],
  spain: [
    { name: "Ogilvy España", web: "ogilvy.es" },
    { name: "McCann España", web: "mccann.es" },
    { name: "BBDO España", web: "bbdo.es" },
    { name: "DDB España", web: "ddb.es" },
    { name: "Publicis España", web: "publicis.es" },
    { name: "Havas España", web: "havas.es" },
    { name: "Leo Burnett España", web: "leoburnett.es" },
    { name: "Grey España", web: "grey.es" },
    { name: "Wunderman Thompson España", web: "wundermanthompson.es" },
    { name: "JWT España", web: "jwt.es" },
    { name: "Cyberclick", web: "cyberclick.es" },
    { name: "NeoAttack", web: "neoattack.com" },
    { name: "InboundCycle", web: "inboundcycle.com" },
    { name: "Factorial Digital", web: "factorialdigital.com" },
    { name: "Elogia", web: "elogia.net" },
    { name: "T2O Media", web: "t2omedia.com" },
    { name: "ROI UP Group", web: "roiup.es" },
    { name: "Kanlli", web: "kanlli.com" },
    { name: "Flat 101", web: "flat101.es" },
    { name: "SIDN Digital Thinking", web: "sidn.es" },
    { name: "Websa100", web: "websa100.com" },
    { name: "Baud", web: "baud.es" },
    { name: "Novicell", web: "novicell.es" },
    { name: "Incógnito", web: "agenciaincognito.com" },
    { name: "Artefacto Digital", web: "artefactodigital.com" },
    { name: "Secuoyas", web: "secuoyas.com" },
    { name: "Parnaso", web: "pfrankarnaso.es" },
    { name: "Contrapunto BBDO", web: "contrapuntobbdo.es" },
    { name: "Sra. Rushmore", web: "srarushmore.com" },
    { name: "Shackleton", web: "shfrackleton.com" },
    { name: "El Ruso de Rocky", web: "elrusoderocky.com" },
    { name: "PS21", web: "ps21.es" },
    { name: "Kitchen", web: "kitchen.es" },
    { name: "Apple Tree", web: "appletree.es" },
    { name: "Llorente y Cuenca (LLYC)", web: "llofrankrenteyfrankuenca.com" },
    { name: "Comunica +A", web: "comunicamas.es" },
    { name: "Social Mood", web: "40defiebre.com" },
    { name: "Roi Scroll", web: "roiscroll.com" },
    { name: "MarketiNet", web: "marketinet.com" },
    { name: "Human Level", web: "humanlevel.com" },
    { name: "Aula CM", web: "aulacm.com" },
    { name: "Nivel de Calidad", web: "niveldecalidad.com" },
    { name: "SocialBorn", web: "socialborn.com" },
    { name: "Btodigital", web: "bfranktodigital.com" },
    { name: "Summa Branding", web: "summa.es" },
    { name: "Morillas", web: "morillas.com" },
    { name: "Manifiesto", web: "manifiesto.biz" },
    { name: "Good Rebels", web: "goodrebels.com" },
    { name: "Making Science", web: "makingscience.com" },
    { name: "Internet Republica", web: "internetrepublica.com" },
    { name: "Digital Menta", web: "digitalmenta.com" },
    { name: "Hiberus Digital", web: "hiberus.com" },
    { name: "Lifting Group", web: "liftinggroup.com" },
    { name: "The Cocktail", web: "the-cocktail.com" },
    { name: "Wild Wild Web", web: "wildwildweb.es" },
    { name: "Sr Burns", web: "srburns.es" },
    { name: "Agencia B12", web: "agenciab12.com" },
    { name: "Digital Group", web: "digitalgroup.es" },
    { name: "BrainSINS", web: "brainsins.com" },
    { name: "Findasense", web: "findasense.com" },
    { name: "Multiplica", web: "multiplica.com" },
    { name: "Territorio Creativo", web: "territoriocreativo.es" },
    { name: "Hello Media Group", web: "hellomedia.es" },
    { name: "iCrossing Spain", web: "icrossing.es" },
    { name: "Dentsu Spain", web: "dentsu.es" },
    { name: "Zenith Spain", web: "zenithmedia.es" },
    { name: "Mindshare Spain", web: "mindshareworld.es" },
    { name: "Starcom Spain", web: "starcom.es" },
    { name: "OMD Spain", web: "omd.es" },
    { name: "PHD Spain", web: "phdmedia.es" },
    { name: "Carat Spain", web: "carat.es" },
    { name: "Initiative Spain", web: "initiative.es" },
    { name: "Alma Medialab", web: "almamedialab.com" },
    { name: "Prisa Brand Solutions", web: "prisabs.com" },
    { name: "Labelium España", web: "labelium.es" },
    { name: "WAM Global", web: "wfrankamglobal.com" },
    { name: "Bluecell", web: "bluecell.es" },
    { name: "Ondho", web: "ondho.com" },
    { name: "Adglow", web: "adglow.com" },
    { name: "Smartbrand", web: "smartbrand.es" },
    { name: "El Publicista", web: "elpublicista.es" },
    { name: "Atrevia", web: "atrevia.com" },
    { name: "Marco de Comunicación", web: "marcodecomunicacion.com" },
    { name: "Torres y Carrera", web: "torresycarrera.com" },
    { name: "128 Comunicación", web: "128comunicacion.com" },
    { name: "Trescom", web: "tfrankresfrankcom.es" },
    { name: "Nothingad", web: "nothingad.com" },
    { name: "Semrush Agency Spain", web: "semrush.es" },
    { name: "Eskimoz España", web: "eskimoz.es" },
    { name: "Gacelaweb", web: "gacelaweb.com" },
    { name: "K-Digital", web: "kdigital.es" },
    { name: "Jevnet", web: "jevnet.com" },
    { name: "Webpositer", web: "webpositer.com" },
    { name: "SEMrush Partner ES", web: "semrushpartner.es" },
    { name: "Bring Media", web: "bringmedia.es" },
    { name: "Digital Virgo España", web: "digitalvirgo.es" },
    { name: "Tribal Spain", web: "tribal.es" },
    { name: "MRM Spain", web: "mrm.es" },
    { name: "Rethink Marketing", web: "rethinkmarketing.es" },
    { name: "All Around", web: "allaround.es" },
    { name: "Sync Marketing Spain", web: "syncmarketing.es" },
  ],
};

// Now fetch each website and extract emails
async function extractEmails(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const res = await fetch(`https://${url}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      redirect: "follow",
    });
    clearTimeout(timeout);
    
    if (!res.ok) return { status: res.status, emails: [] };
    
    const html = await res.text();
    const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    const found = [...new Set((html.match(emailRegex) || []))];
    // Filter out common false positives
    const filtered = found.filter(e => 
      !e.includes("example.com") && 
      !e.includes("sentry") &&
      !e.includes("webpack") &&
      !e.includes("wixpress") &&
      !e.includes(".png") &&
      !e.includes(".jpg") &&
      !e.endsWith(".js") &&
      !e.includes("schema.org") &&
      e.length < 60
    );
    return { status: res.status, emails: filtered };
  } catch (e) {
    return { status: "error", emails: [], error: e.message };
  }
}

// Also try /contacto, /contact, /about pages
async function extractEmailsMultiPage(baseUrl) {
  const pages = [
    baseUrl,
    `${baseUrl}/contacto`,
    `${baseUrl}/contact`,
    `${baseUrl}/contactanos`,
    `${baseUrl}/about`,
    `${baseUrl}/nosotros`,
  ];
  
  const allEmails = new Set();
  
  // Try homepage first
  const home = await extractEmails(baseUrl);
  home.emails.forEach(e => allEmails.add(e));
  
  // If no emails found on homepage, try subpages
  if (allEmails.size === 0) {
    for (const page of pages.slice(1)) {
      const result = await extractEmails(page);
      result.emails.forEach(e => allEmails.add(e));
      if (allEmails.size > 0) break; // Stop once we find emails
    }
  }
  
  return { status: home.status, emails: [...allEmails] };
}

// Process all countries in parallel batches
async function processCountry(country, agencyList) {
  console.log(`\n=== ${country.toUpperCase()} (${agencyList.length} agencias) ===\n`);
  
  const results = [];
  const BATCH = 10;
  
  for (let i = 0; i < agencyList.length; i += BATCH) {
    const batch = agencyList.slice(i, i + BATCH);
    const promises = batch.map(async (agency) => {
      const result = await extractEmailsMultiPage(agency.web);
      const emailStr = result.emails.join(";");
      const icon = result.emails.length > 0 ? "📧" : "❌";
      console.log(`  ${icon} ${agency.name.padEnd(40)} ${agency.web.padEnd(35)} ${emailStr || "no email found"}`);
      return {
        country,
        name: agency.name,
        web: `https://${agency.web}`,
        emails: emailStr,
        status: result.status,
      };
    });
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  return results;
}

// Run all countries
const allResults = [];

for (const country of ["chile", "mexico", "spain"]) {
  const results = await processCountry(country, agencies[country]);
  allResults.push(...results);
}

// Save CSV
const header = "country,name,web,emails,status";
const rows = allResults.map(r => {
  const esc = s => `"${String(s).replace(/"/g, '""')}"`;
  return [r.country, esc(r.name), r.web, esc(r.emails), r.status].join(",");
});
writeFileSync("agencies_raw.csv", [header, ...rows].join("\n"));
writeFileSync("agencies_raw.json", JSON.stringify(allResults, null, 2));

// Summary
const withEmail = allResults.filter(r => r.emails.length > 0);
const byCountry = {};
allResults.forEach(r => {
  if (!byCountry[r.country]) byCountry[r.country] = { total: 0, withEmail: 0 };
  byCountry[r.country].total++;
  if (r.emails.length > 0) byCountry[r.country].withEmail++;
});

console.log("\n=== RESUMEN ===");
Object.entries(byCountry).forEach(([c, d]) => {
  console.log(`${c}: ${d.withEmail}/${d.total} con email`);
});
console.log(`TOTAL: ${withEmail.length}/${allResults.length} con email`);
