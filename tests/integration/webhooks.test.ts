/**
 * Webhook contract against the disposable database: HMAC-verified payloads
 * are persisted as WebhookEvent rows, ACKed 202, processed asynchronously,
 * and drive the BackgroundCheck status transition + audit entry. Signed
 * locally — no real provider involved.
 */

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST as backgroundCheckWebhook } from '@/app/api/webhooks/backgroundCheck/route';
import { createUser, resetDb, waitFor } from './helpers';

const SECRET = 'test-zinc-secret';

function signedRequest(payload: unknown, options: { signature?: string } = {}): Request {
  const body = JSON.stringify(payload);
  const signature = options.signature ?? createHmac('sha256', SECRET).update(body).digest('hex');
  return new Request('http://localhost:3000/api/webhooks/backgroundCheck', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-signature': signature },
    body,
  });
}

let externalId: string;

beforeAll(async () => {
  await resetDb();
  const recruiter = await createUser('RECRUITER', 'Webhook Recruiter');
  const job = await prisma.job.create({
    data: {
      title: 'Webhook Test Job',
      description: 'Job used by webhook tests.',
      location: 'Remote (EU)',
      mustHaveSkills: ['TypeScript'],
      compBandMin: 50000,
      compBandMax: 70000,
      status: 'PUBLISHED',
      ownerId: recruiter.id,
    },
  });
  const candidate = await prisma.candidate.create({
    data: {
      firstName: 'Check',
      lastName: 'Subject',
      email: 'check.subject@mail.example',
      source: 'JOB_BOARD',
      consentStatus: 'GRANTED',
    },
  });
  const application = await prisma.application.create({
    data: { candidateId: candidate.id, jobId: job.id, stage: 'OFFER' },
  });
  externalId = `local-chk-test-1`;
  await prisma.backgroundCheck.create({
    data: {
      externalId,
      package: 'standard',
      status: 'IN_PROGRESS',
      applicationId: application.id,
    },
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe('background check webhook (locally signed payloads)', () => {
  it('rejects a bad signature when a secret is configured, persisting nothing', async () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', SECRET);
    const response = await backgroundCheckWebhook(
      signedRequest({ checkId: externalId, status: 'clear' }, { signature: 'deadbeef' }),
    );
    expect(response.status).toBe(401);
    expect(await prisma.webhookEvent.count()).toBe(0);
  });

  it('ACKs 202, persists the event, processes async, and flips the check to CLEAR', async () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', SECRET);
    const response = await backgroundCheckWebhook(
      signedRequest({ checkId: externalId, status: 'clear', report: { notes: 'all good' } }),
    );
    expect(response.status).toBe(202);
    const { data } = await response.json();
    expect(data.received).toBe(true);

    const event = await waitFor(async () => {
      const row = await prisma.webhookEvent.findUnique({ where: { id: data.eventId } });
      return row && row.status === 'PROCESSED' ? row : null;
    });
    expect(event.provider).toBe('zinc');
    expect(event.signatureVerified).toBe(true);

    const check = await prisma.backgroundCheck.findUniqueOrThrow({ where: { externalId } });
    expect(check.status).toBe('CLEAR');
    expect(check.completedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { action: 'background_check.completed' } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBeNull(); // system action
  });

  it('records a FAILED event (not a crash) for an unknown checkId', async () => {
    vi.stubEnv('ZINC_WEBHOOK_SECRET', SECRET);
    const response = await backgroundCheckWebhook(signedRequest({ checkId: 'nope', status: 'clear' }));
    expect(response.status).toBe(202);
    const { data } = await response.json();

    const event = await waitFor(async () => {
      const row = await prisma.webhookEvent.findUnique({ where: { id: data.eventId } });
      return row && row.status === 'FAILED' ? row : null;
    });
    expect(event.error).toContain('nope');
  });

  it('accepts unsigned events in dev mode (no secret), recording signatureVerified=false', async () => {
    vi.unstubAllEnvs();
    delete process.env.ZINC_WEBHOOK_SECRET;
    const body = JSON.stringify({ checkId: externalId, status: 'consider' });
    const response = await backgroundCheckWebhook(
      new Request('http://localhost:3000/api/webhooks/backgroundCheck', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }),
    );
    expect(response.status).toBe(202);
    const { data } = await response.json();
    const event = await waitFor(async () => {
      const row = await prisma.webhookEvent.findUnique({ where: { id: data.eventId } });
      return row && row.status === 'PROCESSED' ? row : null;
    });
    expect(event.signatureVerified).toBe(false);

    const check = await prisma.backgroundCheck.findUniqueOrThrow({ where: { externalId } });
    expect(check.status).toBe('CONSIDER');
  });
});
