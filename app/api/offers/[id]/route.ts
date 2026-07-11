/**
 * GET /api/offers/[id] — fetch one offer.
 *
 * Two access modes:
 *  - Staff (default): full DTO with approvals; visibility per lib/offers.ts.
 *  - Candidate (?token=<offer.accessToken>): public, no login — returns a
 *    candidate-safe view (terms + decision state, no internal approver
 *    details) so the offer link can render the acceptance page.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { canViewOffer, offerInclude, toOfferDto } from '@/lib/offers';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (token) {
      const offer = await prisma.offer.findUnique({
        where: { id: params.id },
        include: {
          application: {
            include: {
              candidate: { select: { firstName: true, lastName: true } },
              job: { select: { title: true, location: true } },
              onboardingPlan: { select: { accessToken: true } },
            },
          },
        },
      });
      if (!offer || offer.accessToken !== token) {
        return fail(404, 'OFFER_NOT_FOUND', 'This offer link is invalid or has been revoked.');
      }

      const expired = offer.expiresAt <= new Date() && offer.candidateDecision === 'PENDING';
      return ok({
        id: offer.id,
        candidateName: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
        jobTitle: offer.application.job.title,
        jobLocation: offer.application.job.location,
        baseSalary: Number(offer.baseSalary),
        currency: offer.currency,
        bonusPercent: offer.bonusPercent === null ? null : Number(offer.bonusPercent),
        startDate: offer.startDate.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
        candidateDecision: offer.candidateDecision,
        candidateDecidedAt: offer.candidateDecidedAt?.toISOString() ?? null,
        // The offer only becomes acceptable once the approval chain is done.
        readyToDecide: offer.approvalState === 'APPROVED' && offer.candidateDecision === 'PENDING' && !expired,
        expired,
        onboardingToken:
          offer.candidateDecision === 'ACCEPTED'
            ? offer.application.onboardingPlan?.accessToken ?? null
            : null,
      });
    }

    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      include: offerInclude,
    });
    if (!offer) {
      return fail(404, 'OFFER_NOT_FOUND', 'No offer exists with this id.');
    }
    if (!canViewOffer(auth, offer)) {
      return fail(403, 'FORBIDDEN', 'You do not have access to this offer.');
    }

    return ok(toOfferDto(offer));
  } catch (error) {
    console.error('GET /api/offers/[id] failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
