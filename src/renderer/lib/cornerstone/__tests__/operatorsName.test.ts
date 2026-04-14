import { describe, expect, it } from 'vitest';
import {
  formatOperatorsNameForConnection,
  upsertOperatorsName,
} from '../operatorsName';

describe('operatorsName helpers', () => {
  it('formats the current user as "Last, First" when both name parts are present', () => {
    expect(formatOperatorsNameForConnection({
      serverUrl: 'https://xnat.example',
      username: 'jdoe',
      firstName: 'Jane',
      lastName: 'Doe',
      connectedAt: 1,
    })).toBe('Doe, Jane');
  });

  it('appends the current user after a different existing OperatorsName value', () => {
    expect(upsertOperatorsName('Existing User', 'Doe, Jane')).toBe('Existing User\\Doe, Jane');
  });

  it('does not duplicate the same person when the existing value uses DICOM PN formatting', () => {
    expect(upsertOperatorsName({ Alphabetic: 'Doe^Jane' }, 'Doe, Jane')).toBe('Doe^Jane');
  });
});
