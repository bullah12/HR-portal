/**
 * GET /api/offers/[id] — fetch one offer with candidate, job, comp band,
 * and the approval chain. Visibility follows lib/offers.ts role rules.
 */

import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { canViewOffer, offerInclude, toOfferDto } from '@/lib/offers';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
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
