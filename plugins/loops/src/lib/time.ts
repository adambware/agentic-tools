// Strict ISO-8601 timestamps. Date.parse is lenient: "Sep 28" is 2001, a zone-less time is read
// in the host's zone, and 02-30 or 24:00 roll over into the next month or day. Any of these would
// put a record in the wrong window without tripping a parse counter.

const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch ms of an ISO-8601 timestamp with a zone and a real calendar time; undefined otherwise. */
export function parseIso(s: string): number | undefined {
  const m = ISO_WITH_ZONE.exec(s);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const real =
    t.getUTCFullYear() === y &&
    t.getUTCMonth() === mo - 1 &&
    t.getUTCDate() === d &&
    t.getUTCHours() === h &&
    t.getUTCMinutes() === mi;
  const ms = Date.parse(s);
  return real && Number.isFinite(ms) ? ms : undefined;
}
