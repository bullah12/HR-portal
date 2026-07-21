/**
 * Shared test environment. Everything is hermetic: local/dev integration
 * modes only (no provider env vars are ever set here), a dedicated upload
 * dir, and a test AUTH_SECRET for JWT round-trips.
 *
 * DATABASE_URL must point at a DISPOSABLE Postgres database (integration
 * tests wipe it): hr_portal_test locally, the service container in CI.
 */

process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-0123456789abcdef-0123456789abcdef';
process.env.CV_UPLOAD_DIR = process.env.CV_UPLOAD_DIR ?? 'uploads/test-cv';
process.env.ONBOARDING_UPLOAD_DIR = process.env.ONBOARDING_UPLOAD_DIR ?? 'uploads/test-onboarding';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/hr_portal_test?schema=public';

// Guard against a provider var leaking in from the shell: integrations must
// run in local mode so tests never make real HTTP calls.
for (const name of [
  'BROADBEAN_API_URL',
  'BROADBEAN_API_KEY',
  'ZINC_API_URL',
  'ZINC_API_KEY',
  'MS_GRAPH_TENANT_ID',
  'MS_GRAPH_CLIENT_ID',
  'MS_GRAPH_CLIENT_SECRET',
  'DOCUSIGN_BASE_URL',
  'DOCUSIGN_ACCOUNT_ID',
  'DOCUSIGN_ACCESS_TOKEN',
  'SLACK_WEBHOOK_URL',
  'SMTP_HOST',
]) {
  delete process.env[name];
}
// Webhook secrets are stubbed per-test (vi.stubEnv) where signatures matter.
delete process.env.ZINC_WEBHOOK_SECRET;
delete process.env.DOCUSIGN_WEBHOOK_SECRET;
