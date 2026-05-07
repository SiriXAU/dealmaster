/**
 * Pure scheduling helpers for filter profiles.
 *
 * A profile schedule looks like:
 *   {
 *     timezone: 'Australia/Sydney',
 *     mode: 'realtime' | 'digest' | 'quiet',
 *     quietHours: [{ from: '22:00', to: '07:00' }, ...],   // optional
 *     digestAt: '08:00',                                    // local time
 *   }
 *
 * Notes:
 *  - Time math uses Intl.DateTimeFormat with a timezone, not Date math, so DST
 *    transitions in the profile timezone are handled correctly.
 *  - `quietHours.from` may be greater than `quietHours.to` to cross midnight.
 *  - Missing or malformed schedules collapse to realtime mode.
 */

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHHMM(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(HHMM_RE);
  if (!m) return null;
  return { h: Number(m[1]), m: Number(m[2]) };
}

/**
 * Returns the profile timezone if it parses as a valid IANA zone, else null.
 */
export function validateTimezone(tz) {
  if (typeof tz !== 'string' || tz.length === 0) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/**
 * Returns the wall-clock { hour, minute } for `now` (ms) in the given timezone.
 */
export function wallClock(now, timezone) {
  const tz = validateTimezone(timezone) ?? 'UTC';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  let h = 0, mi = 0;
  for (const p of parts) {
    if (p.type === 'hour')   h  = Number(p.value);
    if (p.type === 'minute') mi = Number(p.value);
  }
  // Some locales render midnight as "24"; normalise back to 0.
  if (h === 24) h = 0;
  return { hour: h, minute: mi };
}

/**
 * True if `now` falls within the [from, to) window for the given timezone.
 * Windows that cross midnight (from > to) are supported.
 */
export function inWindow(now, from, to, timezone) {
  const f = parseHHMM(from);
  const t = parseHHMM(to);
  if (!f || !t) return false;
  const wc = wallClock(now, timezone);
  const cur = wc.hour * 60 + wc.minute;
  const start = f.h * 60 + f.m;
  const end   = t.h * 60 + t.m;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // crosses midnight — e.g. 22:00 → 07:00
  return cur >= start || cur < end;
}

function normaliseSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object') return null;
  const timezone = validateTimezone(schedule.timezone) ?? 'UTC';
  const mode     = ['realtime', 'digest', 'quiet'].includes(schedule.mode) ? schedule.mode : 'realtime';
  const quietHours = Array.isArray(schedule.quietHours)
    ? schedule.quietHours.filter(w => w && parseHHMM(w.from) && parseHHMM(w.to))
    : [];
  const digestAt = parseHHMM(schedule.digestAt) ? schedule.digestAt : '08:00';
  return { timezone, mode, quietHours, digestAt };
}

/**
 * Returns the effective delivery mode for a profile right now.
 * 'realtime' → fire immediately
 * 'digest'   → enqueue, flush at digestAt
 * 'quiet'    → enqueue, flush when window ends or when mode flips back to realtime
 */
export function currentMode(profile, now = Date.now()) {
  const sch = normaliseSchedule(profile?.schedule);
  if (!sch) return 'realtime';

  // An explicit `quiet` mode wins regardless of windows.
  if (sch.mode === 'quiet') return 'quiet';

  // Quiet hours always silence the profile, even when mode is realtime/digest.
  for (const win of sch.quietHours) {
    if (inWindow(now, win.from, win.to, sch.timezone)) return 'quiet';
  }

  return sch.mode;
}

/**
 * Returns the timestamp (ms) of the next digestAt boundary for this profile,
 * or null if the profile has no digest configured.
 */
export function nextDigestAt(profile, now = Date.now()) {
  const sch = normaliseSchedule(profile?.schedule);
  if (!sch) return null;
  const target = parseHHMM(sch.digestAt);
  if (!target) return null;

  // Walk forward in 15-minute steps until we land in the target wall-clock
  // minute for the profile timezone. This is robust across DST shifts.
  const STEP = 60 * 1000;
  // Quick path: scan up to 25 hours of minutes.
  for (let i = 1; i <= 25 * 60; i++) {
    const cand = now + i * STEP;
    const wc = wallClock(cand, sch.timezone);
    if (wc.hour === target.h && wc.minute === target.m) return cand;
  }
  return null;
}

/**
 * Returns the timestamp (ms) when the current quiet window ends, or null if
 * the profile is not in a quiet window right now.
 */
export function quietWindowEnd(profile, now = Date.now()) {
  const sch = normaliseSchedule(profile?.schedule);
  if (!sch) return null;
  const STEP = 60 * 1000;
  // Currently quiet?
  if (currentMode(profile, now) !== 'quiet') return null;
  // Walk forward until the mode flips back to non-quiet.
  for (let i = 1; i <= 25 * 60; i++) {
    const cand = now + i * STEP;
    if (currentMode(profile, cand) !== 'quiet') return cand;
  }
  return null;
}
