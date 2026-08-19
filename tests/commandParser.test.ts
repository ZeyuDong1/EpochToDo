import { describe, it, expect } from 'vitest';
import { parseCommand } from '../src/renderer/hooks/useCommandParser';

describe('parseCommand', () => {
  it('returns EMPTY for blank input', () => {
    expect(parseCommand('')).toEqual({ type: 'EMPTY' });
    expect(parseCommand('   ')).toEqual({ type: 'EMPTY' });
  });

  it('parses memo syntax', () => {
    expect(parseCommand('> some note')).toEqual({ type: 'MEMO', memo: 'some note' });
  });

  it('parses type prefixes', () => {
    expect(parseCommand('+ task').type).toBe('REMINDER');
    expect(parseCommand('% task').type).toBe('TRAINING');
    expect(parseCommand('# task').type).toBe('COMPLETE');
    expect(parseCommand('! task').type).toBe('FOCUS');
    expect(parseCommand('plain task').type).toBe('CREATE');
  });

  it('converts time to seconds with s/m/h units, defaulting to minutes', () => {
    expect(parseCommand('task @30s').time).toBe(30);
    expect(parseCommand('task @25m').time).toBe(1500);
    expect(parseCommand('task @ 25m').time).toBe(1500);
    expect(parseCommand('task @2h').time).toBe(7200);
    expect(parseCommand('task @7').time).toBe(420);
  });

  it('removes the time token from the main text', () => {
    const cmd = parseCommand('write report @45m');
    expect(cmd.main).toBe('write report');
    expect(cmd.time).toBe(2700);
  });

  it('infers REMINDER when a plain task carries a time', () => {
    const cmd = parseCommand('洗衣服@5m');
    expect(cmd.type).toBe('REMINDER');
    expect(cmd.main).toBe('洗衣服');
    expect(cmd.time).toBe(300);
  });

  it('infers SUSPEND for a bare time with no task text', () => {
    expect(parseCommand('@ 25m').type).toBe('SUSPEND');
    expect(parseCommand('@25m').type).toBe('SUSPEND');
  });

  it('extracts project with $', () => {
    const cmd = parseCommand('fix bug $EpochToDo');
    expect(cmd.project).toBe('EpochToDo');
    expect(cmd.main).toBe('fix bug');
  });

  it('extracts GPU with backtick and forces TRAINING', () => {
    const cmd = parseCommand('pretrain llama`A100');
    expect(cmd.gpu).toBe('A100');
    expect(cmd.type).toBe('TRAINING');
    expect(cmd.isTraining).toBe(true);
    expect(cmd.main).toBe('pretrain llama');
  });

  it('does not force TRAINING when an explicit non-FOCUS prefix was given', () => {
    const cmd = parseCommand('+ status update`A100');
    expect(cmd.type).toBe('REMINDER');
    expect(cmd.gpu).toBe('A100');
  });

  it('splits main!sub', () => {
    const cmd = parseCommand('main part!sub part');
    expect(cmd.main).toBe('main part');
    expect(cmd.sub).toBe('sub part');
  });

  it('parses subtask syntax with colon search for CREATE and FOCUS', () => {
    const cmd = parseCommand('child task: parent search');
    expect(cmd.isSubtask).toBe(true);
    expect(cmd.parentSearch).toBe('parent search');
    expect(cmd.main).toBe('child task');

    const focus = parseCommand('! child: parent');
    expect(focus.isSubtask).toBe(true);
    expect(focus.parentSearch).toBe('parent');
  });

  it('keeps colons in the text for non-subtask types', () => {
    const cmd = parseCommand('+ ratio 3:2');
    expect(cmd.isSubtask).toBe(false);
    expect(cmd.parentSearch).toBeUndefined();
    expect(cmd.main).toBe('ratio 3:2');
  });

  it('treats a trailing colon as a subtask with no parent search', () => {
    const cmd = parseCommand('child:');
    expect(cmd.isSubtask).toBe(true);
    expect(cmd.parentSearch).toBeUndefined();
    expect(cmd.main).toBe('child');
  });

  it('parses the full kitchen-sink command', () => {
    const cmd = parseCommand('! finetune bert`A100 @90m $LLM!v2');
    // GPU presence upgrades FOCUS to TRAINING per spec
    expect(cmd.type).toBe('TRAINING');
    expect(cmd.gpu).toBe('A100');
    expect(cmd.time).toBe(5400);
    expect(cmd.project).toBe('LLM');
    expect(cmd.main).toBe('finetune bert');
    expect(cmd.sub).toBe('v2');
  });
});
