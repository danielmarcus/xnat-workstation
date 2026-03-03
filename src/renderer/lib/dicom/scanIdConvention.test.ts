import { describe, expect, it } from 'vitest';
import { getSourceScanId } from './scanIdConvention';

describe('getSourceScanId', () => {
  it('extracts source scan ids for SEG/RTSTRUCT/legacy prefixes', () => {
    expect(getSourceScanId('3004')).toBe('4');
    expect(getSourceScanId('3012')).toBe('12');
    expect(getSourceScanId('4107')).toBe('7');
    expect(getSourceScanId('5209')).toBe('9');
  });

  it('returns null for invalid scan ids and zero source id', () => {
    expect(getSourceScanId('3000')).toBeNull();
    expect(getSourceScanId('2999')).toBeNull();
    expect(getSourceScanId('abc')).toBeNull();
    expect(getSourceScanId('300')).toBeNull();
    expect(getSourceScanId('30000')).toBeNull();
  });
});
