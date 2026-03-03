import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './normalizeServerUrl';

describe('normalizeServerUrl', () => {
  it('adds https and removes trailing slash', () => {
    expect(normalizeServerUrl('cnda.wustl.edu/')).toBe('https://cnda.wustl.edu');
  });

  it('keeps existing protocol', () => {
    expect(normalizeServerUrl('http://localhost:8080/path')).toBe('http://localhost:8080/path');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeServerUrl('   ')).toBe('');
  });
});
