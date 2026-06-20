import type { AiReminderStatus } from '../../shared/types';

export function aiStatusPill(status: AiReminderStatus): { label: string; className: string } {
  switch (status) {
    case 'success':
      return { label: '✓', className: 'bg-emerald-500/20 text-emerald-300' };
    case 'failure':
      return { label: '✕', className: 'bg-rose-500/20 text-rose-300' };
    case 'needs_input':
      return { label: '!', className: 'bg-amber-500/20 text-amber-300' };
    case 'review':
      return { label: '?', className: 'bg-violet-500/20 text-violet-300' };
    case 'progress':
      return { label: '⋯', className: 'bg-cyan-500/20 text-cyan-300' };
    case 'info':
    default:
      return { label: 'i', className: 'bg-cyan-500/20 text-cyan-300' };
  }
}

export function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return '刚刚';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
