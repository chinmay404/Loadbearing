import { describe, expect, it } from 'vitest';
import { numberTiles, splitStory } from './BriefPanel';

describe('the brief reads in order of need', () => {
  it('leads with two sentences and folds the rest', () => {
    const { lead, rest } = splitStory('One box runs it all. It rebooted last week. Marketing booked TV. Fix it.');
    expect(lead).toBe('One box runs it all. It rebooted last week.');
    expect(rest).toBe('Marketing booked TV. Fix it.');
  });
  it('keeps a short prompt whole', () => {
    expect(splitStory('Build a URL shortener.').rest).toBe('');
  });
  it('turns spec keys into labelled numbers with units', () => {
    const [peak, p99, avail] = numberTiles({ peakRps: 900, p99Ms: 300, availability: '99.9% — currently nowhere near it' });
    expect(peak).toMatchObject({ label: 'Peak', value: '900', unit: 'rps' });
    expect(p99).toMatchObject({ label: 'P99', value: '300', unit: 'ms' });
    expect(avail).toMatchObject({ label: 'Availability', value: '99.9%', note: 'currently nowhere near it' });
  });
});
