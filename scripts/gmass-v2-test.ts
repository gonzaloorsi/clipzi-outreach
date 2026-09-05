// GMass inbox placement test for the YouTube v2 email. Renders the real
// youtube-hot template (live heatmap for one video) and sends it to the 15
// GMass seed inboxes from one fleet sender, exactly like production would
// (plain text, lowercase subject, our own Message-ID). Read the placement at
// gmass.co → Inbox Test, grouped by subject "minuto mm:ss".
//
//   npx tsx scripts/gmass-v2-test.ts                 # es, from g@clipzi.video
//   npx tsx scripts/gmass-v2-test.ts --from g@clipzi.media --lang en

import { config } from "dotenv";
config({ path: ".env.local" });
import { Resend } from "resend";
import { fetchHeatmap, pickHotWindows, formatMmss } from "../lib/heatmap";
import { htmlToPlainText } from "../lib/email";
import { build as hotEs } from "../lib/templates/youtube-hot-es";
import { build as hotEn } from "../lib/templates/youtube-hot-en";
import { build as hotPt } from "../lib/templates/youtube-hot-pt";

const SEEDS = [
  "ajaygoel999@gmail.com", "test@chromecompete.com", "test@ajaygoel.org", "me@dropboxslideshow.com",
  "test@wordzen.com", "rajgoel8477@gmail.com", "rajanderson8477@gmail.com", "rajwilson8477@gmail.com",
  "briansmith8477@gmail.com", "oliviasmith8477@gmail.com", "ashsmith8477@gmail.com", "shellysmith8477@gmail.com",
  "ajay@madsciencekidz.com", "ajay2@ctopowered.com", "ajay@arena.tec.br",
];

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const from = flag("from") ?? "g@clipzi.video";
const lang = (flag("lang") ?? "es") as "es" | "en" | "pt";
const videoId = flag("video") ?? "yjwazQE1uvI";
const fromName = process.env.SENDER_NAME ?? "Gonzalo Orsi";

const markers = await fetchHeatmap(videoId);
const windows = markers ? pickHotWindows(markers) : [];
if (!windows.length) throw new Error("no heatmap for the test video");
const o = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`).then((r) => r.json());

const builder = { es: hotEs, en: hotEn, pt: hotPt }[lang];
const { subject: rawSubject, html } = builder({
  channelName: "Facundo Cabral",
  fromName,
  toEmail: "creator@example.com",
  country: lang === "es" ? "AR" : lang === "pt" ? "BR" : "US",
  hot: {
    source: "heatmap",
    videoTitle: o.title,
    mmss: formatMmss(windows[0].start),
    mmss2: windows[1] ? formatMmss(windows[1].start) : null,
    label: videoId === "yjwazQE1uvI" ? "No soy de aquí, ni soy de allá" : null,
  },
});
const subject = rawSubject.toLowerCase();
const text = htmlToPlainText(html);
const resend = new Resend(process.env.RESEND_API_KEY);
const domain = from.split("@")[1];

console.log(`from=${from} lang=${lang} subject="${subject}" seeds=${SEEDS.length}\n`);
let ok = 0;
for (const to of SEEDS) {
  const t0 = Date.now();
  const { data, error } = await resend.emails.send({
    from: `${fromName} <${from}>`,
    to: [to],
    subject,
    text,
    headers: { "Message-ID": `<${crypto.randomUUID()}@${domain}>` },
  });
  if (error) console.log(`  ✗ ${to.padEnd(30)} ${error.message ?? JSON.stringify(error)}`);
  else { ok++; console.log(`  ✓ ${to.padEnd(30)} ${Date.now() - t0}ms id=${data?.id}`); }
  await new Promise((r) => setTimeout(r, 300));
}
console.log(`\nsent ${ok}/${SEEDS.length}. Check gmass.co → Inbox Test, subject "${subject}".`);
