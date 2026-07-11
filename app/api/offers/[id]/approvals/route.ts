/**
 * POST /api/offers/[id]/approvals — record the caller's decision on their
 * pending approval step (spec: "sequential approval chain, then
 * e-signature"). Steps decide strictly in sequence; when the last step
 * approves, the offer becomes APPROVED and moves to SENT so the candidate
 * link can accept it. A rejection rejects the whole offer.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { offerInclude, toOfferDto } from '@/lib/offers';

export const runtime = 'nodejs';

const bodySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid approval payload.', parsed.error.flatten().fieldErrors);
    }

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      include: { approvals: { orderBy: { sequence: 'asc' } } },
    });
    if (!offer) {
      return fail(404, 'OFFER_NOT_FOUND', 'No offer exists with this id.');
    }
    if (offer.approvalState !== 'PENDING_APPROVAL') {
      return fail(409, 'NOT_PENDING', `This offer is ${offer.approvalState}, not awaiting approval.`);
    }

    const step = offer.approvals.find(
      (approval) => approval.approverId === auth.userId && approval.decision === 'PENDING',
    );
    if (!step) {
      return fail(403, 'NOT_AN_APPROVER', 'You have no pending approval step on this offer.');
    }

    const blocking = offer.approvals.find(
      (approval) => approval.sequence < step.sequence && approval.decision !== 'APPROVED',
    );
    if (blocking) {
      return fail(409, 'OUT_OF_SEQUENCE', `Approval step ${blocking.sequence} must be decided first.`);
    }

    const isLastStep = offer.approvals.every(
      (approval) => approval.id === step.id || approval.sequence < step.sequence
        ? true
        : approval.decision === 'APPROVED',
    );

    await prisma.$transaction([
      prisma.offerApproval.update({
        where: { id: step.id },
        data: { decision: parsed.data.decision, comment: parsed.data.comment, decidedAt: new Date() },
      }),
      prisma.offer.update({
        where: { id: offer.id },
        data:
          parsed.data.decision === 'REJECTED'
            ? { approvalState: 'REJECTED' }
            : isLastStep
              ? { approvalState: 'APPROVED', signatureStatus: 'SENT' }
              : {},
      }),
      prisma.auditLog.create({
        data: {
          actorId: auth.userId,
          action: 'offer.approval_decided',
          entityType: 'Offer',
          entityId: offer.id,
          detail: {
            sequence: step.sequence,
            decision: parsed.data.decision,
            comment: parsed.data.comment ?? null,
            finalStep: isLastStep,
          },
        },
      }),
    ]);

    const updated = await prisma.offer.findUniqueOrThrow({
      where: { id: offer.id },
      include: offerInclude,
    });
    return ok(toOfferDto(updated));
  } catch (error) {
    console.error('POST /api/offers/[id]/approvals failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
