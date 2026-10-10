import { describe, expect, it } from 'vitest';
import { isPhiTag, PHI_OVERLAY_FIELDS } from './phi';

describe('isPhiTag', () => {
  it('the whole Patient group is PHI', () => {
    expect(isPhiTag('x00100010')).toBe(true); // Patient's Name
    expect(isPhiTag('X00100030')).toBe(true); // Birth Date, any case
    expect(isPhiTag('x00101010')).toBe(true); // Patient's Age
  });
  it('identifying study attributes are PHI; acquisition geometry is not', () => {
    expect(isPhiTag('x00080050')).toBe(true); // Accession
    expect(isPhiTag('x00080080')).toBe(true); // Institution
    expect(isPhiTag('x00080020')).toBe(true); // Study Date
    expect(isPhiTag('x00280010')).toBe(false); // Rows
    expect(isPhiTag('x00200032')).toBe(false); // Image Position
    expect(isPhiTag('x0008103e')).toBe(false); // Series Description
  });
  it('overlay PHI fields exclude XNAT labels', () => {
    expect(PHI_OVERLAY_FIELDS.has('patientName')).toBe(true);
    expect(PHI_OVERLAY_FIELDS.has('subjectLabel')).toBe(false);
  });
});
