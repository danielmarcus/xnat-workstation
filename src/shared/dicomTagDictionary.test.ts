import { describe, expect, it } from 'vitest';
import {
  DICOM_TAG_DICTIONARY,
  DICOM_TAG_GROUPS_ORDER,
  formatTagKey,
  isPrivateTag,
} from './dicomTagDictionary';

describe('dicomTagDictionary', () => {
  it('contains stable ordering for display groups', () => {
    expect(DICOM_TAG_GROUPS_ORDER).toEqual([
      'Patient',
      'Study',
      'Series',
      'Equipment',
      'Acquisition',
      'Frame of Reference',
      'Image',
      'Other',
    ]);
  });

  it('includes canonical tags with expected metadata shape', () => {
    expect(DICOM_TAG_DICTIONARY.x00100010).toEqual(
      expect.objectContaining({
        name: "Patient's Name",
        keyword: 'PatientName',
        vr: 'PN',
        group: 'Patient',
      }),
    );
    expect(DICOM_TAG_DICTIONARY.x00280010).toEqual(
      expect.objectContaining({
        name: 'Rows',
        keyword: 'Rows',
        vr: 'US',
        group: 'Image',
      }),
    );
    expect(DICOM_TAG_DICTIONARY.x00080070).toEqual(
      expect.objectContaining({
        name: 'Manufacturer',
        group: 'Equipment',
      }),
    );
  });

  it('keeps every dictionary entry in a declared display group', () => {
    const groups = new Set(DICOM_TAG_GROUPS_ORDER);
    const entries = Object.values(DICOM_TAG_DICTIONARY);
    expect(entries.length).toBeGreaterThan(250);

    for (const entry of entries) {
      expect(groups.has(entry.group)).toBe(true);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.keyword.length).toBeGreaterThan(0);
      expect(entry.vr.length).toBeGreaterThan(0);
    }
  });

  it('formats tag keys into standard DICOM representation', () => {
    expect(formatTagKey('x00100010')).toBe('(0010,0010)');
    expect(formatTagKey('x7fe00010')).toBe('(7FE0,0010)');
    expect(formatTagKey('invalid')).toBe('invalid');
  });

  it('detects private tags from odd group numbers', () => {
    expect(isPrivateTag('x00090010')).toBe(true);
    expect(isPrivateTag('x00110001')).toBe(true);
    expect(isPrivateTag('x00100010')).toBe(false);
    expect(isPrivateTag('x0002')).toBe(false);
  });
});
