/**
 * Background checks via Zinc (spec section 6: EU-compliant referencing /
 * right-to-work). Two halves:
 *
 *  - startBackgroundCheck: orders a check with the provider and records a
 *    BackgroundCheck row (REQUESTED -> IN_PROGRESS).
 *  - processBackgroundCheckEvent: consumes a persisted WebhookEvent from
 *    the provider (status transitions to CLEAR / CONSIDER / FAILED),
 *    invoked asynchronously by the webhook route.
 *
 * Real mode when ZINC_API_URL + ZINC_API_KEY are set; local mode otherwise.
 * Webhook signatures are HMAC-SHA256 (hex) of the raw body with
 * ZINC_WEBHOOK_SECRET.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { fetchWithRetry, IntegrationError } from '@/lib/integrations/http';
import { notifyBackgroundCheckCompleted } from '@/lib/integrations/slack';

export class BackgroundCheckFlowError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BackgroundCheckFlowError';
  }
}

const CHECK_PACKAGES = ['right-to-work', 'references', 'right-to-work-and-references'] as const;
export type CheckPackage = (typeof CHECK_PACKAGES)[number];

const CHECKABLE_STAGES = ['INTERVIEW', 'OFFER', 'HIRED'] as const;

async function orderProviderCheck(input: {
  candidateName: string;
  candidateEmail: string;
  package: CheckPackage;
}): Promise<string> {
  const baseUrl = process.env.ZINC_API_URL;
  const apiKey = process.env.ZINC_API_KEY;

  if (!baseUrl || !apiKey) {
    return `local-chk-${randomUUID().slice(0, 12)}`;
  }

  const response = await fetchWithRetry('zinc', `${baseUrl.replace(/\/$/, '')}/checks`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      candidate: { name: input.candidateName, email: input.candidateEmail },
      package: input.package,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new IntegrationError('zinc', `Check order failed with ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }

  const body = (await response.json()) as { id?: string };
  if (!body.id) {
    throw new IntegrationError('zinc', 'Provider response did not include a check id.');
  }
  return body.id;
}

export async function startBackgroundCheck(
  candidateId: string,
  jobId: string,
  checkPackage: string,
  actorUserId: string,
) {
  if (!(CHECK_PACKAGES as readonly string[]).includes(checkPackage)) {
    throw new BackgroundCheckFlowError(400, 'INVALID_PACKAGE', `package must be one of: ${CHECK_PACKAGES.join(', ')}.`);
  }

  const application = await prisma.application.findUnique({
    where: { candidateId_jobId: { candidateId, jobId } },
    include: { candidate: true, backgroundChecks: true },
  });
  if (!application) {
    throw new BackgroundCheckFlowError(404, 'APPLICATION_NOT_FOUND', 'No application exists for this candidate and job.');
  }
  if (!(CHECKABLE_STAGES as readonly string[]).includes(application.stage)) {
    throw new BackgroundCheckFlowError(
      422,
      'INVALID_STAGE',
      `Background checks run from the interview stage onwards (application is ${application.stage}).`,
    );
  }
  const open = application.backgroundChecks.find(
    (check) => check.package === checkPackage && (check.status === 'REQUESTED' || check.status === 'IN_PROGRESS'),
  );
  if (open) {
    throw new BackgroundCheckFlowError(409, 'CHECK_ALREADY_OPEN', `A ${checkPackage} check is already in progress.`, );
  }

  const externalId = await orderProviderCheck({
    candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`,
    candidateEmail: application.candidate.email,
    package: checkPackage as CheckPackage,
  });

  const check = await prisma.backgroundCheck.create({
    data: {
      applicationId: application.id,
      externalId,
      package: checkPackage,
      status: 'IN_PROGRESS',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: actorUserId,
      action: 'background_check.ordered',
      entityType: 'BackgroundCheck',
      entityId: check.id,
      detail: {
        applicationId: application.id,
        package: checkPackage,
        externalId,
        provider: process.env.ZINC_API_URL ? 'zinc' : 'local',
      },
    },
  });

  return {
    id: check.id,
    externalId: check.externalId,
    package: check.package,
    status: check.status,
    requestedAt: check.requestedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Webhook side
// ---------------------------------------------------------------------------

export interface SignatureVerification {
  verified: boolean;
  /** False when no secret is configured (dev) — recorded, not enforced. */
  required: boolean;
}

export function verifyZincSignature(rawBody: string, signatureHeader: string | null): SignatureVerification {
  const secret = process.env.ZINC_WEBHOOK_SECRET;
  if (!secret) {
    return { verified: false, required: false };
  }
  if (!signatureHeader) {
    return { verified: false, required: true };
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = Buffer.from(signatureHeader);
  const wanted = Buffer.from(expected);
  const verified = provided.length === wanted.length && timingSafeEqual(provided, wanted);
  return { verified, required: true };
}

const STATUS_MAP: Record<string, 'CLEAR' | 'CONSIDER' | 'FAILED'> = {
  clear: 'CLEAR',
  consider: 'CONSIDER',
  failed: 'FAILED',
};

/** Processes one persisted webhook event; called asynchronously. */
export async function processBackgroundCheckEvent(eventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  try {
    const payload = event.payload as { checkId?: string; status?: string; report?: unknown };
    if (!payload.checkId || !payload.status) {
      throw new Error('Payload must include checkId and status.');
    }
    const mapped = STATUS_MAP[payload.status.toLowerCase()];
    if (!mapped) {
      throw new Error(`Unknown check status "${payload.status}".`);
    }

    const check = await prisma.backgroundCheck.findUnique({
      where: { externalId: payload.checkId },
      include: {
        application: {
          include: {
            candidate: { select: { firstName: true, lastName: true } },
            job: { select: { title: true } },
          },
        },
      },
    });
    if (!check) {
      throw new Error(`No background check with externalId "${payload.checkId}".`);
    }

    await prisma.$transaction([
      prisma.backgroundCheck.update({
        where: { id: check.id },
        data: {
          status: mapped,
          completedAt: new Date(),
          result: (payload.report ?? { status: payload.status }) as Prisma.InputJsonValue,
        },
      }),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'background_check.completed',
          entityType: 'BackgroundCheck',
          entityId: check.id,
          detail: { externalId: check.externalId, status: mapped, via: 'webhook' },
        },
      }),
    ]);

    await notifyBackgroundCheckCompleted({
      candidateName: `${check.application.candidate.firstName} ${check.application.candidate.lastName}`,
      jobTitle: check.application.job.title,
      package: check.package,
      outcome: mapped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', error: message.slice(0, 500), processedAt: new Date() },
    });
    console.error(`Background check webhook event ${event.id} failed:`, message);
  }
}
