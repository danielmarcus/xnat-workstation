/**
 * E2E Environment Variable Helpers
 *
 * Validates that required XNAT connection variables are set.
 * Values are loaded from .env.e2e by playwright.config.ts via dotenv.
 */

export interface E2EConfig {
  xnatUrl: string;
  xnatUser: string;
  xnatPassword: string;
  testProject: string;
  testSubject: string;
  testSession: string;
  testScan?: string;
}

export function getE2EConfig(): E2EConfig {
  const required = {
    XNAT_URL: process.env.XNAT_URL,
    XNAT_USER: process.env.XNAT_USER,
    XNAT_PASSWORD: process.env.XNAT_PASSWORD,
    XNAT_TEST_PROJECT: process.env.XNAT_TEST_PROJECT,
    XNAT_TEST_SUBJECT: process.env.XNAT_TEST_SUBJECT,
    XNAT_TEST_SESSION: process.env.XNAT_TEST_SESSION,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(
      `Missing required E2E environment variables: ${missing.join(', ')}.\n`
      + 'Copy .env.e2e.example to .env.e2e and fill in your values.',
    );
  }

  return {
    xnatUrl: required.XNAT_URL!,
    xnatUser: required.XNAT_USER!,
    xnatPassword: required.XNAT_PASSWORD!,
    testProject: required.XNAT_TEST_PROJECT!,
    testSubject: required.XNAT_TEST_SUBJECT!,
    testSession: required.XNAT_TEST_SESSION!,
    testScan: process.env.XNAT_TEST_SCAN || undefined,
  };
}
