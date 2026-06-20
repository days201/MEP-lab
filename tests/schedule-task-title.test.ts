import { describe, expect, it } from 'vitest';
import {
  buildScheduledTaskFallbackTitle,
  buildScheduledTaskTitle,
  summarizeSchedulePrompt,
} from '../src/shared/schedule/task-title';

describe('scheduled task title', () => {
  it('always prefixes with [Scheduled Task]', () => {
    expect(buildScheduledTaskTitle('organize today tasks')).toBe(
      '[Scheduled Task] organize today tasks'
    );
  });

  it('normalizes whitespace and line breaks', () => {
    expect(buildScheduledTaskTitle('  First line\n\nSecond line   Third line  ')).toBe('[Scheduled Task] First line Second line Third line');
  });

  it('strips duplicated schedule prefix', () => {
    expect(buildScheduledTaskTitle('[Scheduled Task] Daily summary')).toBe('[Scheduled Task] Daily summary');
  });

  it('truncates very long prompt summary', () => {
    const longPrompt = 'a'.repeat(70);
    expect(summarizeSchedulePrompt(longPrompt)).toBe(`${'a'.repeat(45)}...`);
  });

  it('falls back for empty prompt', () => {
    expect(buildScheduledTaskTitle('   ')).toBe('[Scheduled Task] Untitled Task');
  });

  it('builds fallback title from prompt summary', () => {
    expect(buildScheduledTaskFallbackTitle('Find Agent papers from the past week')).toBe(
      '[Scheduled Task] Find Agent papers from the past week'
    );
  });
});
