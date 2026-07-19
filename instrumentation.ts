/**
 * Server startup checks (docs/PLAN.md §8 Q9): outside development, missing
 * webhook secrets mean inbound vendor webhooks are accepted UNSIGNED —
 * loudly warn at boot. Development keeps the convenience silently.
 */

export async function register(): Promise<void> {
  if (process.env.NODE_ENV === 'development') return;

  const missing = ['ZINC_WEBHOOK_SECRET', 'DOCUSIGN_WEBHOOK_SECRET'].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    console.warn(
      `⚠️  SECURITY WARNING: ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
        'Inbound vendor webhooks will be accepted WITHOUT signature verification. ' +
        'Set the secret(s) before exposing this deployment (see README "Production env checklist").',
    );
  }
}
