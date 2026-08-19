import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../src/store/useStore';
import type { AiReminder } from '../src/shared/types';

const mk = (id: string, overrides: Partial<AiReminder> = {}): AiReminder => ({
  id,
  source: 'Claude Code',
  title: `task-${id}`,
  status: 'success',
  timestamp: 1_000,
  ...overrides,
});

describe('aiReminders store slice', () => {
  beforeEach(() => {
    useStore.setState({ aiReminders: [] });
  });

  it('prepends new reminders (newest first)', () => {
    useStore.getState().addAiReminder(mk('a'));
    useStore.getState().addAiReminder(mk('b'));
    const list = useStore.getState().aiReminders;
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('keeps at most 20 reminders (FIFO drop from the tail)', () => {
    for (let i = 0; i < 25; i++) {
      useStore.getState().addAiReminder(mk(`r${i}`));
    }
    const list = useStore.getState().aiReminders;
    expect(list).toHaveLength(20);
    expect(list[0].id).toBe('r24'); // newest kept
    expect(list[19].id).toBe('r5'); // oldest dropped
  });

  it('removes a single reminder by id', () => {
    useStore.setState({ aiReminders: [mk('a'), mk('b')] });
    useStore.getState().removeAiReminder('a');
    expect(useStore.getState().aiReminders.map((r) => r.id)).toEqual(['b']);
  });

  it('dismissAiReply clears the same reply but keeps action-required statuses', () => {
    useStore.setState({
      aiReminders: [
        mk('n1', { title: 'deploy', status: 'needs_input' }),
        mk('p1', { title: 'deploy', status: 'progress' }),
        mk('f1', { title: 'deploy', status: 'failure' }),
        mk('r1', { title: 'deploy', status: 'review' }),
        mk('other', { title: 'other-task', status: 'progress' }),
      ],
    });
    useStore.getState().dismissAiReply('Claude Code', 'deploy');
    const remaining = useStore.getState().aiReminders.map((r) => r.id);
    // needs_input / review survive, progress / failure of the same reply are cleared,
    // and unrelated replies are untouched
    expect(remaining).toEqual(['n1', 'r1', 'other']);
  });

  it('dismissAiReply does not match other sources', () => {
    useStore.setState({
      aiReminders: [mk('a', { source: 'Cursor', title: 'deploy', status: 'progress' })],
    });
    useStore.getState().dismissAiReply('Claude Code', 'deploy');
    expect(useStore.getState().aiReminders).toHaveLength(1);
  });

  it('clearAiReminders empties the list', () => {
    useStore.setState({ aiReminders: [mk('a'), mk('b')] });
    useStore.getState().clearAiReminders();
    expect(useStore.getState().aiReminders).toHaveLength(0);
  });
});
