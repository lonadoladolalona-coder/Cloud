/** 3500 -> "00:03.500" (the format the guides require for shot cut times). */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/**
 * Accepts "MM:SS.mmm", "M:SS", or plain seconds ("3.5"). Returns ms, or null if unparseable.
 */
export function parseTimecode(input: string): number | null {
  const s = input.trim();
  let m = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(s);
  if (m) {
    const [, mm, ss, frac] = m;
    if (Number(ss) >= 60) return null;
    return Number(mm) * 60000 + Number(ss) * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0);
  }
  m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (m) {
    const [, ss, frac] = m;
    return Number(ss) * 1000 + (frac ? Number(frac.padEnd(3, '0')) : 0);
  }
  return null;
}

/** Duration as the guides print it in alignment instructions: always two decimals ("8.00"). */
export function formatSeconds2(sec: number): string {
  return sec.toFixed(2);
}
