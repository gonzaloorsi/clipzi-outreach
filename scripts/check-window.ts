// Shows which countries are currently in send window vs outside.
// Useful for sanity-checking the timezone gating before deploy.

import { config } from "dotenv";
config({ path: ".env.local" });
import {
  COUNTRY_TO_TZ,
  getLocalHour,
  parseSendWindow,
  isInSendWindow,
} from "../lib/timezone";

const window = parseSendWindow(process.env.SEND_WINDOW_HOURS);
const now = new Date();

console.log(`Now: ${now.toISOString()} (${now.toUTCString()})`);
console.log(`Send window: ${window.start}:00 - ${window.end}:00 local\n`);

const inWindow: { country: string; tz: string; hour: number }[] = [];
const outsideWindow: { country: string; tz: string; hour: number }[] = [];

for (const country of Object.keys(COUNTRY_TO_TZ)) {
  const hour = getLocalHour(country);
  const inside = isInSendWindow(country, window);
  const tz = COUNTRY_TO_TZ[country];
  if (inside === true) {
    inWindow.push({ country, tz, hour: hour! });
  } else if (inside === false) {
    outsideWindow.push({ country, tz, hour: hour! });
  }
}

console.log(`✅ IN WINDOW (${inWindow.length} countries):`);
console.table(
  inWindow
    .sort((a, b) => a.hour - b.hour)
    .map(({ country, tz, hour }) => ({ country, tz, local_hour: `${hour}:00` })),
);

console.log(`\n⛔ OUTSIDE WINDOW (${outsideWindow.length} countries):`);
console.table(
  outsideWindow
    .sort((a, b) => a.hour - b.hour)
    .map(({ country, tz, hour }) => ({ country, tz, local_hour: `${hour}:00` })),
);
