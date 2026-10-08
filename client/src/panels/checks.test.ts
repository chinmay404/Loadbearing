import { describe, expect, it } from 'vitest';
import { splitMessage } from './ChecksPanel';

describe('a finding reads as a headline first', () => {
  it('splits at the dash into what is wrong and why', () => {
    const { head, why } = splitMessage('Load Balancer balances across a single Web Client — one instance is not redundancy.');
    expect(head).toBe('Load Balancer balances across a single Web Client');
    expect(why).toBe('One instance is not redundancy.');
  });
  it('falls back to the first sentence', () => {
    expect(splitMessage('No flows are declared. Name your paths.').head).toBe('No flows are declared');
  });
  it('keeps a one-sentence message whole', () => {
    expect(splitMessage('A queue nobody consumes.')).toEqual({ head: 'A queue nobody consumes', why: '' });
  });
});
