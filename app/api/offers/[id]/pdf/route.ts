/**
 * GET /api/offers/[id]/pdf — render the offer letter as a PDF.
 *
 * This is the document template that gets sent to DocuSign (EU datacentre)
 * for e-signature; the signing flow lives in lib/integrations/esign.ts,
 * which reuses the same renderer from lib/offerPdf.ts.
 */

import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail } from '@/lib/types';
import { canViewOffer, offerInclude } from '@/lib/offers';
import { renderOfferPdf } from '@/lib/offerPdf';

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

    const pdf = await renderOfferPdf(offer);
    const candidateSlug = `${offer.application.candidate.firstName}-${offer.application.candidate.lastName}`.toLowerCase();

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="offer-${candidateSlug}.pdf"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    console.error('GET /api/offers/[id]/pdf failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
