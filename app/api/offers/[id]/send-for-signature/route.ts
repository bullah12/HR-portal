/**
 * POST /api/offers/[id]/send-for-signature — render the offer letter and
 * create the DocuSign envelope for the candidate to sign. Requires a fully
 * approved offer. Signature outcomes arrive via /api/webhooks/esign.
 */

import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { EsignFlowError, sendOfferForSignature } from '@/lib/integrations/esign';
import { IntegrationError } from '@/lib/integrations/http';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const result = await sendOfferForSignature(params.id, auth.userId);
    return ok(result, 201);
  } catch (error) {
    if (error instanceof EsignFlowError) {
      return fail(error.status, error.code, error.message);
    }
    if (error instanceof IntegrationError) {
      return fail(502, 'PROVIDER_ERROR', error.message);
    }
    console.error('POST /api/offers/[id]/send-for-signature failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
