import { describe, it, expect } from 'vitest';
import {
  normalizeAiReminder,
  isHardReminderStatus,
  HARD_REMINDER_STATUSES,
} from '../electron/timer/aiReminder';

describe('normalizeAiReminder', () => {
  it('throws when source is missing or blank', () => {
    expect(() => normalizeAiReminder({ title: 't' })).toThrow(/source/);
    expect(() => normalizeAiReminder({ source: '   ', title: 't' })).toThrow(/source/);
  });

  it('throws when title is missing or blank', () => {
    expect(() => normalizeAiReminder({ source: 'bot' })).toThrow(/title/);
    expect(() => normalizeAiReminder({ source: 'bot', title: '' })).toThrow(/title/);
  });

  it('defaults unknown and missing statuses to info', () => {
    expect(normalizeAiReminder({ source: 's', title: 't' }).status).toBe('info');
    expect(normalizeAiReminder({ source: 's', title: 't', status: 'bogus' }).status).toBe('info');
  });

  it('passes valid statuses through', () => {
    for (const status of ['success', 'failure', 'needs_input', 'review', 'progress'] as const) {
      expect(normalizeAiReminder({ source: 's', title: 't', status }).status).toBe(status);
    }
  });

  it('normalizes second timestamps to ms', () => {
    const seconds = 1_755_000_000; // ~2025-08
    expect(normalizeAiReminder({ source: 's', title: 't', timestamp: seconds }).timestamp)
      .toBe(seconds * 1000);
  });

  it('keeps millisecond timestamps as-is', () => {
    const ms = 1_755_000_000_000;
    expect(normalizeAiReminder({ source: 's', title: 't', timestamp: ms }).timestamp).toBe(ms);
  });

  it('falls back to now when timestamp is absent or not a number', () => {
    const before = Date.now();
    const a = normalizeAiReminder({ source: 's', title: 't' });
    const b = normalizeAiReminder({ source: 's', title: 't', timestamp: 'soon' });
    const after = Date.now();
    expect(a.timestamp).toBeGreaterThanOrEqual(before);
    expect(a.timestamp).toBeLessThanOrEqual(after);
    expect(b.timestamp).toBeGreaterThanOrEqual(before);
    expect(b.timestamp).toBeLessThanOrEqual(after);
  });

  it('stringifies non-null detail and drops non-string links', () => {
    const r = normalizeAiReminder({
      source: 's',
      title: 't',
      detail: 42,
      link: 123,
    });
    expect(r.detail).toBe('42');
    expect(r.link).toBeUndefined();

    const r2 = normalizeAiReminder({ source: 's', title: 't', detail: null, link: 'https://x' });
    expect(r2.detail).toBeUndefined();
    expect(r2.link).toBe('https://x');
  });

  it('trims source and title', () => {
    const r = normalizeAiReminder({ source: '  bot  ', title: '  did thing ' });
    expect(r.source).toBe('bot');
    expect(r.title).toBe('did thing');
  });
});

describe('isHardReminderStatus', () => {
  it('routes success / needs_input / review to hard reminders', () => {
    expect(isHardReminderStatus('success')).toBe(true);
    expect(isHardReminderStatus('needs_input')).toBe(true);
    expect(isHardReminderStatus('review')).toBe(true);
  });

  it('keeps failure / progress / info as ephemeral cards', () => {
    expect(isHardReminderStatus('failure')).toBe(false);
    expect(isHardReminderStatus('progress')).toBe(false);
    expect(isHardReminderStatus('info')).toBe(false);
  });

  it('stays in sync with the exported status list', () => {
    for (const s of HARD_REMINDER_STATUSES) {
      expect(isHardReminderStatus(s)).toBe(true);
    }
  });
});
