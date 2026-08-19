import type { AiReminderStatus } from '../../src/shared/types';

/** All statuses an AI reminder payload may carry (anything else → 'info') */
export const AI_REMINDER_STATUSES: readonly AiReminderStatus[] = [
  'success', 'failure', 'needs_input', 'review', 'progress',
];

/**
 * Statuses that create a hard reminder (full-screen window + chime,
 * persisted as an actionable task). Everything else stays as an
 * ephemeral in-memory card.
 */
export const HARD_REMINDER_STATUSES: readonly AiReminderStatus[] = [
  'success', 'needs_input', 'review',
];

/** A validated, normalized AI reminder payload */
export interface NormalizedAiReminder {
  source: string;
  title: string;
  status: AiReminderStatus;
  detail?: string;
  link?: string;
  /** epoch ms, normalized from seconds/ms */
  timestamp: number;
}

/**
 * Validate and normalize a raw webhook payload for kind:"ai".
 * Throws when `source` or `title` is missing/blank.
 *
 * Timestamp rule: values > 1e12 are treated as already-ms,
 * otherwise as seconds and multiplied by 1000.
 */
export function normalizeAiReminder(
  data: Record<string, unknown>
): NormalizedAiReminder {
  const source = String(data.source ?? '').trim();
  const title = String(data.title ?? '').trim();
  if (!source || !title) {
    throw new Error('ai reminder requires "source" and "title"');
  }

  const status: AiReminderStatus = AI_REMINDER_STATUSES.includes(
    data.status as AiReminderStatus
  )
    ? (data.status as AiReminderStatus)
    : 'info';

  const detail = data.detail != null ? String(data.detail) : undefined;
  const link = typeof data.link === 'string' ? data.link : undefined;

  const rawTs = typeof data.timestamp === 'number' ? data.timestamp : null;
  const timestamp =
    rawTs === null ? Date.now() : rawTs > 1e12 ? rawTs : rawTs * 1000;

  return { source, title, status, detail, link, timestamp };
}

/** Whether this status routes to the hard-reminder (actionable) path */
export function isHardReminderStatus(status: AiReminderStatus): boolean {
  return HARD_REMINDER_STATUSES.includes(status);
}
