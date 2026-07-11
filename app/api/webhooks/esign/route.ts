/**
 * POST /api/webhooks/esign — DocuSign Connect envelope events
 * (completed / declined / voided).
 *
 * Same contract as the background check webhook: HMAC verification
 * (x-docusign-signature-1, base64), persist, 202 immediately, process
 * asynchronously with the outcome recorded on the WebhookEvent row.
 */

import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/types';
import { processEsignEvent, verifyDocusignSignature } from '@/lib/integrations/esign';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const verification = verifyDocusignSignature(rawBody, request.headers.get('x-docusign-signature-1'));
    if (verification.required && !verification.verified) {
      return fail(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed.');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return fail(400, 'INVALID_JSON', 'Webhook body must be valid JSON.');
    }
    if (typeof payload !== 'object' || payload === null) {
      return fail(400, 'INVALID_PAYLOAD', 'Webhook body must be a JSON object.');
    }

    const event = await prisma.webhookEvent.create({
      data: {
        provider: 'docusign',
        eventType: String((payload as Record<string, unknown>).event ?? 'envelope.updated'),
        payload: payload as object,
        signatureVerified: verification.verified,
      },
    });

    void processEsignEvent(event.id).catch((error) =>
      console.error(`Deferred processing of webhook event ${event.id} crashed:`, error),
    );

    return ok({ received: true, eventId: event.id }, 202);
  } catch (error) {
    console.error('POST /api/webhooks/esign failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
