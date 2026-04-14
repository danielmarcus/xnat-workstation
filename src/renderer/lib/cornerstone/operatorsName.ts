import type { XnatConnectionInfo } from '@shared/types/xnat';

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanNamePart(value: unknown): string {
  return typeof value === 'string' ? normalizeWhitespace(value) : '';
}

function canonicalizeOperatorName(value: string): string {
  return normalizeWhitespace(
    normalizeWhitespace(value).replace(/[\^,]+/g, ' '),
  ).toLowerCase();
}

function extractOperatorValues(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === 'string') {
    return value
      .split('\\')
      .map(normalizeWhitespace)
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractOperatorValues);
  }

  if (typeof value === 'object') {
    const alphabetic = (value as { Alphabetic?: unknown }).Alphabetic;
    if (typeof alphabetic === 'string') {
      return extractOperatorValues(alphabetic);
    }
  }

  return [];
}

export function formatOperatorsNameForConnection(
  connection: XnatConnectionInfo | null | undefined,
): string | null {
  if (!connection) return null;

  const firstName = cleanNamePart(connection.firstName);
  const lastName = cleanNamePart(connection.lastName);

  if (firstName || lastName) {
    if (firstName && lastName) {
      return `${lastName}, ${firstName}`;
    }
    return lastName || firstName;
  }

  const username = cleanNamePart(connection.username);
  return username || null;
}

export function upsertOperatorsName(
  existingValue: unknown,
  currentOperatorName: string | null,
): string | undefined {
  const existingValues = extractOperatorValues(existingValue);
  const nextName = currentOperatorName ? normalizeWhitespace(currentOperatorName) : '';

  if (!nextName) {
    return existingValues.length > 0 ? existingValues.join('\\') : undefined;
  }

  if (existingValues.length === 0) {
    return nextName;
  }

  const canonicalNext = canonicalizeOperatorName(nextName);
  const alreadyPresent = existingValues.some(
    (value) => canonicalizeOperatorName(value) === canonicalNext,
  );

  if (alreadyPresent) {
    return existingValues.join('\\');
  }

  return [...existingValues, nextName].join('\\');
}
