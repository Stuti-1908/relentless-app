/**
 * Worldwide IANA timezone helpers.
 *
 * Replaces the old US-only hardcoded list (Bug 2 — every non-US client was silently
 * defaulted to America/New_York). Uses Intl.supportedValuesOf("timeZone") where available
 * (~400+ zones, all modern browsers + Node 18+), with a hardcoded worldwide fallback for
 * older runtimes.
 */

// Fallback list (~100 zones) covering all continents, for runtimes without
// Intl.supportedValuesOf (older Safari, some embedded webviews).
const FALLBACK_TIMEZONES: string[] = [
  "UTC",
  // Americas
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/Caracas",
  "America/Halifax",
  "America/St_Johns",
  "America/Guatemala",
  "America/Panama",
  // Europe
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Vienna",
  "Europe/Prague",
  "Europe/Warsaw",
  "Europe/Budapest",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Copenhagen",
  "Europe/Helsinki",
  "Europe/Athens",
  "Europe/Bucharest",
  "Europe/Sofia",
  "Europe/Kyiv",
  "Europe/Moscow",
  "Europe/Istanbul",
  // Africa
  "Africa/Casablanca",
  "Africa/Algiers",
  "Africa/Tunis",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Abidjan",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "Africa/Addis_Ababa",
  "Africa/Khartoum",
  "Africa/Kinshasa",
  "Africa/Dar_es_Salaam",
  // Middle East
  "Asia/Jerusalem",
  "Asia/Beirut",
  "Asia/Amman",
  "Asia/Baghdad",
  "Asia/Riyadh",
  "Asia/Kuwait",
  "Asia/Qatar",
  "Asia/Dubai",
  "Asia/Tehran",
  // Asia
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Colombo",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Yangon",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Ho_Chi_Minh",
  "Asia/Phnom_Penh",
  "Asia/Vientiane",
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Ulaanbaatar",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Yekaterinburg",
  "Asia/Novosibirsk",
  "Asia/Vladivostok",
  // Oceania
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
  "Pacific/Guam",
  "Pacific/Port_Moresby",
  // Atlantic / Indian Ocean
  "Atlantic/Reykjavik",
  "Atlantic/Azores",
  "Atlantic/Cape_Verde",
  "Indian/Mauritius",
  "Indian/Maldives",
];

/**
 * All available IANA timezone identifiers, worldwide. Uses the runtime's own
 * supported set when available (most complete + always current), otherwise
 * falls back to a ~100-zone worldwide list.
 */
export function getAllTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === "function") {
      const zones = Intl.supportedValuesOf("timeZone");
      if (Array.isArray(zones) && zones.length > 0) return zones;
    }
  } catch {
    /* fall through to fallback list */
  }
  return FALLBACK_TIMEZONES;
}

/**
 * Validates that a string is a real IANA timezone identifier the current
 * runtime recognizes (works in both browser and Node).
 */
export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Human-friendly label for a timezone, e.g. "(UTC+05:30) Asia/Kolkata".
 * Computes the LIVE offset (accounts for current DST state) via Intl.
 */
export function tzLabel(tz: string): string {
  const offset = getOffsetLabel(tz);
  return offset ? `(${offset}) ${tz}` : tz;
}

function getOffsetLabel(tz: string): string | null {
  for (const tzName of ["shortOffset", "longOffset"] as const) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: tzName,
      }).formatToParts(new Date());
      const part = parts.find((p) => p.type === "timeZoneName");
      if (part?.value) {
        // "shortOffset"/"longOffset" yield things like "GMT+5:30" or "GMT+05:30" — normalize to UTC±HH:MM.
        const m = part.value.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
        if (m) {
          const sign = m[1].startsWith("-") ? "-" : "+";
          const hh = Math.abs(parseInt(m[1], 10)).toString().padStart(2, "0");
          const mm = (m[2] ?? "00").padStart(2, "0");
          return `UTC${sign}${hh}:${mm}`;
        }
        if (part.value === "GMT") return "UTC+00:00";
      }
    } catch {
      /* try next / fall through */
    }
  }
  return null;
}

/**
 * Offset in minutes for a timezone right now — used for sorting the picker
 * (UTC-12 ... UTC+14) so the list reads like a familiar timezone dropdown.
 */
export function tzOffsetMinutes(tz: string): number {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUTC = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    return Math.round((asUTC - now.getTime()) / 60000);
  } catch {
    return 0;
  }
}
