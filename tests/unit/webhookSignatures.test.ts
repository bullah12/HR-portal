import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyZincSignature } from '@/lib/integrations/backgroundCheck';
import { verifyDocusignSignature } from '@/lib/integrations/esign';

const BODY = JSON.stringify({ checkId: 'chk-1', status: 'clear' });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Zinc webhook signature (HMAC-SHA256 hex)', () => {
  it('is recorded-not-enforced when no secret is configured', () => {
    const result = verifyZincSignature(BODY, 'anything');
    expect(result).toEqual({ verified: false, required: false });
  });

  it('verifies a correctly signed body', () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', 'zinc-secret');
    const signature = createHmac('sha256', 'zinc-secret').update(BODY).digest('hex');
    expect(verifyZincSignature(BODY, signature)).toEqual({ verified: true, required: true });
  });

  it('rejects a wrong signature and a missing header when a secret is set', () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', 'zinc-secret');
    const wrong = createHmac('sha256', 'other-secret').update(BODY).digest('hex');
    expect(verifyZincSignature(BODY, wrong)).toEqual({ verified: false, required: true });
    expect(verifyZincSignature(BODY, null)).toEqual({ verified: false, required: true });
  });

  it('rejects when the body was tampered with after signing', () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', 'zinc-secret');
    const signature = createHmac('sha256', 'zinc-secret').update(BODY).digest('hex');
    expect(verifyZincSignature(BODY + ' ', signature).verified).toBe(false);
  });
});

describe('DocuSign Connect signature (HMAC-SHA256 base64)', () => {
  it('is recorded-not-enforced when no secret is configured', () => {
    expect(verifyDocusignSignature(BODY, 'anything')).toEqual({ verified: false, required: false });
  });

  it('verifies a correctly signed body (base64, not hex)', () => {
    vi.stubEnv('DOCUSIGN_WEBHOOK_SECRET', 'docusign-secret');
    const base64 = createHmac('sha256', 'docusign-secret').update(BODY).digest('base64');
    expect(verifyDocusignSignature(BODY, base64)).toEqual({ verified: true, required: true });

    const hex = createHmac('sha256', 'docusign-secret').update(BODY).digest('hex');
    expect(verifyDocusignSignature(BODY, hex).verified).toBe(false);
  });

  it('rejects wrong signatures and missing headers when a secret is set', () => {
    vi.stubEnv('DOCUSIGN_WEBHOOK_SECRET', 'docusign-secret');
    const wrong = createHmac('sha256', 'other').update(BODY).digest('base64');
    expect(verifyDocusignSignature(BODY, wrong)).toEqual({ verified: false, required: true });
    expect(verifyDocusignSignature(BODY, null)).toEqual({ verified: false, required: true });
  });
});
