import { describe, expect, it } from 'vitest';
import type { ProblemSummary } from '@loadbearing/shared';
import { startHereRows } from './startHere';

const sheet = (id: string, track?: ProblemSummary['track']): ProblemSummary => ({
  id,
  title: id,
  level: 1,
  domain: 'x',
  concepts: [],
  ...(track ? { track } : {}),
});

describe('startHereRows', () => {
  const problems = [
    sheet('l1-image-upload-service'),
    sheet('l1-start-ai-chat-basics', { topic: 'ai-chat', stage: 'basics', next: 'l1-start-ai-chat-step-up' }),
    sheet('l1-start-photo-upload-step-up', { topic: 'photo-upload', stage: 'step-up', next: 'l1-image-upload-service' }),
    sheet('l1-start-photo-upload-basics', { topic: 'photo-upload', stage: 'basics', next: 'l1-start-photo-upload-step-up' }),
  ];

  it('makes one row per topic, in the ladder order, with both stages and where it leads', () => {
    const rows = startHereRows(problems);
    expect(rows.map((r) => r.topic)).toEqual(['photo-upload', 'ai-chat']);
    expect(rows[0]).toMatchObject({
      title: 'Photo upload',
      basics: { id: 'l1-start-photo-upload-basics' },
      stepUp: { id: 'l1-start-photo-upload-step-up' },
      next: { id: 'l1-image-upload-service' },
    });
    expect(rows[1]!.stepUp).toBeUndefined();
  });

  it('is empty when no sheet is on the ladder', () => {
    expect(startHereRows([sheet('a'), sheet('b')])).toEqual([]);
  });
});
