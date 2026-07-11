/**
 * POST /api/webhooks/backgroundCheck — inbound status events from the
 * background check provider (Zinc).
 *
 * Contract: verify the HMAC signature (x-webhook-signature, hex), persist
 * the event, respond 202 immediately, and process asynchronously — the
 * provider gets a fast ACK regardless of how long our side takes.
 * (Production moves the processing hop onto SQS per spec section 5; the
 * persisted WebhookEvent row is the durable record either way.)
 */

import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/types';
import { processBackgroundCheckEvent, verifyZincSignature } from '@/lib/integrations/backgroundCheck';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const verification = verifyZincSignature(rawBody, request.headers.get('x-webhook-signature'));
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
        provider: 'zinc',
        eventType: String((payload as Record<string, unknown>).status ?? 'check.updated'),
        payload: payload as object,
        signatureVerified: verification.verified,
      },
    });

    // Fire-and-forget: the 202 goes out now; failures are recorded on the
    // WebhookEvent row for inspection/replay.
    void processBackgroundCheckEvent(event.id).catch((error) =>
      console.error(`Deferred processing of webhook event ${event.id} crashed:`, error),
    );

    return ok({ received: true, eventId: event.id }, 202);
  } catch (error) {
    console.error('POST /api/webhooks/backgroundCheck failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
