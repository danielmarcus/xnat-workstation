import { describe, expect, it } from 'vitest';
import { deidentifyText } from './deidentify';

describe('deidentifyText', () => {
  it('redacts URL host and query parameters', () => {
    const input = 'fetch https://xnat.example.org/data/archive/experiments?token=abc123';
    const output = deidentifyText(input);
    expect(output).toContain('https://<host-redacted>/data/archive/...?<query-redacted>');
    expect(output).not.toContain('xnat.example.org');
    expect(output).not.toContain('token=abc123');
  });

  it('redacts tokens, emails, user paths, ids, and IP addresses', () => {
    const input = [
      'email=dev@example.com',
      'Authorization: Bearer top-secret',
      'JSESSIONID=abc123',
      'csrfToken=abcdef',
      '/Users/dan/Documents/private',
      'C:\\Users\\dan\\Desktop\\file',
      'uuid=123e4567-e89b-12d3-a456-426614174000',
      'dicom=1.2.840.10008.5.1.4.1.1.2',
      'xnatExp=PROJECT1_E123',
      'xnatGen=XNAT_E9999',
      'ip=192.168.1.55',
    ].join(' | ');

    const output = deidentifyText(input);

    expect(output).toContain('<email-redacted>');
    expect(output).toContain('Authorization: Bearer <token-redacted>');
    expect(output).toContain('JSESSIONID=<token-redacted>');
    expect(output).toContain('csrfToken=<token-redacted>');
    expect(output).toContain('/Users/<user>/Documents/private');
    expect(output).toContain('C:\\Users\\<user>\\Desktop\\file');
    expect(output).toContain('<uuid-redacted>');
    expect(output).toContain('<dicom-uid-redacted>');
    expect(output).toContain('<xnat-experiment-id>');
    expect(output).toContain('XNAT_<id>');
    expect(output).toContain('<ip-redacted>');

    expect(output).not.toContain('dev@example.com');
    expect(output).not.toContain('top-secret');
    expect(output).not.toContain('192.168.1.55');
  });

  it('leaves benign text unchanged', () => {
    const input = 'viewer loaded successfully with 3 panels';
    expect(deidentifyText(input)).toBe(input);
  });
});
