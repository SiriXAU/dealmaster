import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseHHMM, validateTimezone, inWindow, currentMode, nextDigestAt, quietWindowEnd } from '../src/scheduler.js';

describe('parseHHMM', () => {
  it('parses valid times', () => {
    assert.deepStrictEqual(parseHHMM('00:00'), { h: 0, m: 0 });
    assert.deepStrictEqual(parseHHMM('22:30'), { h: 22, m: 30 });
    assert.deepStrictEqual(parseHHMM('23:59'), { h: 23, m: 59 });
  });

  it('rejects malformed times', () => {
    assert.strictEqual(parseHHMM('24:00'), null);
    assert.strictEqual(parseHHMM('7:00'),  null);  // need leading zero
    assert.strictEqual(parseHHMM('07:0'),  null);
    assert.strictEqual(parseHHMM('abc'),   null);
    assert.strictEqual(parseHHMM(null),    null);
  });
});

describe('validateTimezone', () => {
  it('accepts valid IANA zones', () => {
    assert.strictEqual(validateTimezone('UTC'), 'UTC');
    assert.strictEqual(validateTimezone('Australia/Sydney'), 'Australia/Sydney');
  });

  it('rejects invalid input', () => {
    assert.strictEqual(validateTimezone('Not/A/Zone'), null);
    assert.strictEqual(validateTimezone(''), null);
    assert.strictEqual(validateTimezone(null), null);
  });
});

describe('inWindow', () => {
  // 2026-05-01 03:00 UTC -> Sydney is +10 (no DST), so 13:00 Sydney
  // Use UTC zone for predictable arithmetic.
  const t = (h, m) => Date.UTC(2026, 4, 1, h, m, 0);

  it('matches a daytime window', () => {
    assert.ok(inWindow(t(10, 0), '09:00', '17:00', 'UTC'));
    assert.ok(!inWindow(t(8,  0), '09:00', '17:00', 'UTC'));
    assert.ok(!inWindow(t(17, 0), '09:00', '17:00', 'UTC')); // half-open
  });

  it('matches a window that crosses midnight', () => {
    assert.ok(inWindow(t(23, 0), '22:00', '07:00', 'UTC'));
    assert.ok(inWindow(t(1,  0), '22:00', '07:00', 'UTC'));
    assert.ok(!inWindow(t(8,  0), '22:00', '07:00', 'UTC'));
  });

  it('returns false for malformed inputs', () => {
    assert.strictEqual(inWindow(t(10, 0), 'bad', '17:00', 'UTC'), false);
  });
});

describe('currentMode', () => {
  it('returns realtime when no schedule is configured', () => {
    assert.strictEqual(currentMode({}, Date.UTC(2026, 4, 1, 10)), 'realtime');
    assert.strictEqual(currentMode({ schedule: null }, Date.UTC(2026, 4, 1, 10)), 'realtime');
  });

  it('returns quiet inside a quiet window even when mode is realtime', () => {
    const profile = {
      schedule: { mode: 'realtime', timezone: 'UTC', quietHours: [{ from: '22:00', to: '07:00' }] }
    };
    assert.strictEqual(currentMode(profile, Date.UTC(2026, 4, 1, 1, 0)), 'quiet');
    assert.strictEqual(currentMode(profile, Date.UTC(2026, 4, 1, 8, 0)), 'realtime');
  });

  it('explicit quiet mode wins regardless of windows', () => {
    const profile = { schedule: { mode: 'quiet', timezone: 'UTC', quietHours: [] } };
    assert.strictEqual(currentMode(profile, Date.UTC(2026, 4, 1, 12)), 'quiet');
  });

  it('digest mode outside quiet hours is digest', () => {
    const profile = { schedule: { mode: 'digest', timezone: 'UTC', quietHours: [] } };
    assert.strictEqual(currentMode(profile, Date.UTC(2026, 4, 1, 12)), 'digest');
  });
});

describe('nextDigestAt', () => {
  it('returns same-day target when called before it', () => {
    const profile = { schedule: { mode: 'digest', timezone: 'UTC', digestAt: '08:00', quietHours: [] } };
    const now = Date.UTC(2026, 4, 1, 6, 0);
    const next = nextDigestAt(profile, now);
    assert.ok(next > now);
    assert.ok(next - now <= 3 * 60 * 60 * 1000); // within 3 hours
  });

  it('returns next-day target when called after it', () => {
    const profile = { schedule: { mode: 'digest', timezone: 'UTC', digestAt: '08:00', quietHours: [] } };
    const now = Date.UTC(2026, 4, 1, 12, 0);
    const next = nextDigestAt(profile, now);
    assert.ok(next > now);
    assert.ok(next - now > 12 * 60 * 60 * 1000); // > 12 hours away
  });

  it('returns null without a schedule', () => {
    assert.strictEqual(nextDigestAt({}, Date.now()), null);
  });
});

describe('quietWindowEnd', () => {
  it('returns the end of the current quiet window', () => {
    const profile = {
      schedule: { mode: 'realtime', timezone: 'UTC', quietHours: [{ from: '22:00', to: '07:00' }] }
    };
    const now = Date.UTC(2026, 4, 1, 1, 0); // currently quiet
    const end = quietWindowEnd(profile, now);
    assert.ok(end > now);
    assert.ok(end - now <= 7 * 60 * 60 * 1000);
  });

  it('returns null when not in a quiet window', () => {
    const profile = {
      schedule: { mode: 'realtime', timezone: 'UTC', quietHours: [{ from: '22:00', to: '07:00' }] }
    };
    assert.strictEqual(quietWindowEnd(profile, Date.UTC(2026, 4, 1, 12)), null);
  });
});
