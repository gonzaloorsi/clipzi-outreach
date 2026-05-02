// Timezone gating — only send when it's a sensible business hour in the
// recipient's local timezone. Avoids the "spam at 3 AM" effect that hurts
// deliverability and reply rates.
//
// Strategy:
//   - Map each country code to a primary IANA timezone.
//   - For multi-timezone countries (US, BR, CA, AU, RU), pick the timezone
//     of the creator-economy hub (Eastern US, Sao Paulo, Toronto, Sydney,
//     Moscow). Approximation, but better than no constraint.
//   - DST is handled automatically by Intl.DateTimeFormat.
//   - Countries we don't have mapped: caller decides (we return null and the
//     route lets nulls pass through unconditionally).
//
// To add a new country: append to COUNTRY_TO_TZ. Find the right IANA name
// at https://en.wikipedia.org/wiki/List_of_tz_database_time_zones

export const COUNTRY_TO_TZ: Record<string, string> = {
  // ─── Americas ──────────────────────────────────────────────────────────
  // Spanish-speaking
  AR: "America/Argentina/Buenos_Aires",
  BO: "America/La_Paz",
  CL: "America/Santiago",
  CO: "America/Bogota",
  CR: "America/Costa_Rica",
  CU: "America/Havana",
  DO: "America/Santo_Domingo",
  EC: "America/Guayaquil",
  GT: "America/Guatemala",
  HN: "America/Tegucigalpa",
  MX: "America/Mexico_City",
  NI: "America/Managua",
  PA: "America/Panama",
  PE: "America/Lima",
  PR: "America/Puerto_Rico",
  PY: "America/Asuncion",
  SV: "America/El_Salvador",
  UY: "America/Montevideo",
  VE: "America/Caracas",
  // Portuguese
  BR: "America/Sao_Paulo", // multi-tz; SP is the creator-economy hub
  // English-speaking Americas
  CA: "America/Toronto", // multi-tz; ET is dominant for business
  US: "America/New_York", // multi-tz; ET dominant for business email
  JM: "America/Jamaica",
  TT: "America/Port_of_Spain",
  // ─── Europe ────────────────────────────────────────────────────────────
  AT: "Europe/Vienna",
  BE: "Europe/Brussels",
  BG: "Europe/Sofia",
  CH: "Europe/Zurich",
  CZ: "Europe/Prague",
  DE: "Europe/Berlin",
  DK: "Europe/Copenhagen",
  EE: "Europe/Tallinn",
  ES: "Europe/Madrid",
  FI: "Europe/Helsinki",
  FR: "Europe/Paris",
  GB: "Europe/London",
  GR: "Europe/Athens",
  HR: "Europe/Zagreb",
  HU: "Europe/Budapest",
  IE: "Europe/Dublin",
  IS: "Atlantic/Reykjavik",
  IT: "Europe/Rome",
  LT: "Europe/Vilnius",
  LU: "Europe/Luxembourg",
  LV: "Europe/Riga",
  MT: "Europe/Malta",
  NL: "Europe/Amsterdam",
  NO: "Europe/Oslo",
  PL: "Europe/Warsaw",
  PT: "Europe/Lisbon",
  RO: "Europe/Bucharest",
  RS: "Europe/Belgrade",
  SE: "Europe/Stockholm",
  SI: "Europe/Ljubljana",
  SK: "Europe/Bratislava",
  TR: "Europe/Istanbul",
  UA: "Europe/Kyiv",
  RU: "Europe/Moscow", // multi-tz; Moscow is dominant
  // ─── Asia / Pacific ────────────────────────────────────────────────────
  AE: "Asia/Dubai",
  AU: "Australia/Sydney", // multi-tz; AEST/AEDT is creator hub
  BD: "Asia/Dhaka",
  CN: "Asia/Shanghai",
  HK: "Asia/Hong_Kong",
  ID: "Asia/Jakarta",
  IL: "Asia/Jerusalem",
  IN: "Asia/Kolkata",
  JP: "Asia/Tokyo",
  KR: "Asia/Seoul",
  MY: "Asia/Kuala_Lumpur",
  NZ: "Pacific/Auckland",
  PH: "Asia/Manila",
  PK: "Asia/Karachi",
  SA: "Asia/Riyadh",
  SG: "Asia/Singapore",
  TH: "Asia/Bangkok",
  TW: "Asia/Taipei",
  VN: "Asia/Ho_Chi_Minh",
  // ─── Africa ────────────────────────────────────────────────────────────
  EG: "Africa/Cairo",
  GH: "Africa/Accra",
  KE: "Africa/Nairobi",
  MA: "Africa/Casablanca",
  NG: "Africa/Lagos",
  ZA: "Africa/Johannesburg",
};

/**
 * Get the current local hour (0-23) for a country's primary timezone.
 * Returns null if the country isn't mapped.
 */
export function getLocalHour(country: string | null | undefined): number | null {
  if (!country) return null;
  const tz = COUNTRY_TO_TZ[country.toUpperCase()];
  if (!tz) return null;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    });
    const hourStr = fmt.format(new Date());
    const hour = Number(hourStr);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return null;
    return hour;
  } catch {
    return null;
  }
}

export interface SendWindow {
  start: number; // inclusive, 0-23
  end: number; // exclusive, 0-23
}

/**
 * Parse SEND_WINDOW_HOURS env var (e.g. "9-18") into a SendWindow.
 * Defaults to 9-18 if unset or invalid. start < end always (no overnight).
 */
export function parseSendWindow(envValue: string | undefined): SendWindow {
  const fallback: SendWindow = { start: 9, end: 18 };
  if (!envValue) return fallback;
  const match = envValue.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return fallback;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (
    Number.isNaN(start) ||
    Number.isNaN(end) ||
    start < 0 ||
    end > 24 ||
    start >= end
  ) {
    return fallback;
  }
  return { start, end };
}

/**
 * Is it currently a sensible time to send to recipients in this country?
 * Returns true iff the country's local hour is in [start, end).
 *
 * For unknown / unmapped countries, returns null (caller decides).
 */
export function isInSendWindow(
  country: string | null | undefined,
  window: SendWindow,
): boolean | null {
  const hour = getLocalHour(country);
  if (hour === null) return null;
  return hour >= window.start && hour < window.end;
}

/**
 * Returns the list of country codes whose primary timezone is currently
 * in the given send window. Use this to build a SQL `WHERE country IN (...)`
 * filter before fetching candidates — much cheaper than per-channel filtering.
 */
export function activeCountries(window: SendWindow): string[] {
  const active: string[] = [];
  for (const country of Object.keys(COUNTRY_TO_TZ)) {
    if (isInSendWindow(country, window) === true) {
      active.push(country);
    }
  }
  return active;
}
