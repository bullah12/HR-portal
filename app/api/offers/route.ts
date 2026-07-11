/**
 * /api/offers
 *  - GET:  list offers visible to the caller (role rules in lib/offers.ts).
 *  - POST: create an offer for an application (recruiter/HR admin).
 *          Compensation is validated against the job's comp band (spec:
 *          "offer templates with comp-band validation") and an optional
 *          sequential approval chain is created (spec: "sequential
 *          approval chain, then e-signature").
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { canViewOffer, offerInclude, toOfferDto } from '@/lib/offers';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_DAYS = 14;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const offers = await prisma.offer.findMany({
      include: offerInclude,
      orderBy: { createdAt: 'desc' },
    });

    return ok(offers.filter((offer) => canViewOffer(auth, offer)).map(toOfferDto));
  } catch (error) {
    console.error('GET /api/offers failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const createOfferSchema = z
  .object({
    applicationId: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    baseSalary: z.number().positive(),
    bonusPercent: z.number().min(0).max(100).optional(),
    startDate: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    /** Sequential approval chain, in order. Defaults to the job owner. */
    approverIds: z.array(z.string().min(1)).max(5).optional(),
  })
  .refine((data) => data.applicationId || (data.candidateId && data.jobId), {
    message: 'Provide applicationId, or candidateId and jobId together.',
    path: ['applicationId'],
  });

const UNOFFERABLE_STAGES = ['KNOCKOUT_FAILED', 'REJECTED', 'WITHDRAWN'] as const;

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const parsed = createOfferSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid offer payload.', parsed.error.flatten().fieldErrors);
    }

    const startDate = new Date(parsed.data.startDate);
    if (startDate <= new Date()) {
      return fail(400, 'VALIDATION_ERROR', 'startDate must be in the future.');
    }
    const expiresAt = parsed.data.expiresAt
      ? new Date(parsed.data.expiresAt)
      : new Date(Date.now() + DEFAULT_EXPIRY_DAYS * DAY_MS);
    if (expiresAt <= new Date()) {
      return fail(400, 'VALIDATION_ERROR', 'expiresAt must be in the future.');
    }

    const application = await prisma.application.findUnique({
      where: parsed.data.applicationId
        ? { id: parsed.data.applicationId }
        : {
            candidateId_jobId: {
              candidateId: parsed.data.candidateId as string,
              jobId: parsed.data.jobId as string,
            },
          },
      include: { candidate: true, job: true, offer: true },
    });
    if (!application) {
      return fail(404, 'APPLICATION_NOT_FOUND', 'No application exists for this candidate and job.');
    }
    if ((UNOFFERABLE_STAGES as readonly string[]).includes(application.stage)) {
      return fail(422, 'INVALID_STAGE', `Cannot create an offer for an application in stage ${application.stage}.`);
    }
    if (application.offer) {
      return fail(409, 'OFFER_EXISTS', 'An offer already exists for this application.', {
        offerId: application.offer.id,
      });
    }

    // Comp-band validation (spec section 2).
    const bandMin = Number(application.job.compBandMin);
    const bandMax = Number(application.job.compBandMax);
    if (parsed.data.baseSalary < bandMin || parsed.data.baseSalary > bandMax) {
      return fail(422, 'COMP_OUT_OF_BAND', 'Base salary is outside the job compensation band.', {
        compBand: { min: bandMin, max: bandMax, currency: application.job.compBandCurrency },
        requested: parsed.data.baseSalary,
      });
    }

    const approverIds = [...new Set(parsed.data.approverIds ?? [application.job.ownerId])];
    const approvers = await prisma.user.findMany({ where: { id: { in: approverIds } } });
    if (approvers.length !== approverIds.length) {
      return fail(404, 'APPROVER_NOT_FOUND', 'One or more approverIds do not match staff users.');
    }

    const offer = await prisma.offer.create({
      data: {
        applicationId: application.id,
        baseSalary: parsed.data.baseSalary,
        currency: application.job.compBandCurrency,
        bonusPercent: parsed.data.bonusPercent,
        startDate,
        expiresAt,
        approvalState: 'PENDING_APPROVAL',
        signatureStatus: 'NOT_SENT',
        approvals: {
          create: approverIds.map((approverId, index) => ({
            sequence: index + 1,
            approverId,
            decision: 'PENDING',
          })),
        },
      },
      include: offerInclude,
    });

    // Extending an offer is a human pipeline decision — advance the stage.
    const stageAdvanced = application.stage !== 'OFFER' && application.stage !== 'HIRED';
    if (stageAdvanced) {
      await prisma.application.update({
        where: { id: application.id },
        data: { stage: 'OFFER' },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'offer.created',
        entityType: 'Offer',
        entityId: offer.id,
        detail: {
          applicationId: application.id,
          baseSalary: parsed.data.baseSalary,
          currency: application.job.compBandCurrency,
          approvalChain: approverIds,
          stageAdvanced,
          decisionBy: 'human',
        },
      },
    });

    const dto = toOfferDto(offer);
    if (stageAdvanced) {
      dto.application.stage = 'OFFER';
    }
    return ok(dto, 201);
  } catch (error) {
    console.error('POST /api/offers failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
