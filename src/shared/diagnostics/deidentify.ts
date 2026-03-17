const DICOM_UID_RE = /\b\d+(?:\.\d+){5,}\b/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const XNAT_EXPERIMENT_RE = /\b[A-Z]{2,}\d+_E\d+\b/g;
const XNAT_GENERIC_ID_RE = /\bXNAT_[A-Z]\d+\b/g;

const USER_PATH_RE = /\/Users\/[^/\s]+/g;
const WINDOWS_USER_PATH_RE = /[A-Za-z]:\\Users\\[^\\\s]+/g;

const URL_RE = /\bhttps?:\/\/[^\s'"<>]+/gi;
const COOKIE_TOKEN_RE = /(JSESSIONID=)[^;,\s]+/gi;
const BEARER_RE = /(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi;
const CSRF_RE = /((?:csrf(?:Token)?|XNAT_CSRF)\s*[=:]\s*)[A-Za-z0-9._-]+/gi;

function deidentifyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname ? parsed.pathname.split('/').filter(Boolean).slice(0, 2).join('/') : '';
    const normalizedPath = path ? `/${path}/...` : '';
    return `${parsed.protocol}//<host-redacted>${normalizedPath}${parsed.search ? '?<query-redacted>' : ''}`;
  } catch {
    return '<url-redacted>';
  }
}

export function deidentifyText(input: string): string {
  if (!input) return input;

  return input
    .replace(URL_RE, (url) => deidentifyUrl(url))
    .replace(EMAIL_RE, '<email-redacted>')
    .replace(COOKIE_TOKEN_RE, '$1<token-redacted>')
    .replace(BEARER_RE, '$1<token-redacted>')
    .replace(CSRF_RE, '$1<token-redacted>')
    .replace(USER_PATH_RE, '/Users/<user>')
    .replace(WINDOWS_USER_PATH_RE, 'C:\\Users\\<user>')
    .replace(UUID_RE, '<uuid-redacted>')
    .replace(DICOM_UID_RE, '<dicom-uid-redacted>')
    .replace(XNAT_EXPERIMENT_RE, '<xnat-experiment-id>')
    .replace(XNAT_GENERIC_ID_RE, 'XNAT_<id>')
    .replace(IPV4_RE, '<ip-redacted>');
}
