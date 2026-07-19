/**
 * E-signature via DocuSign, EU datacentre (spec section 6: offer and
 * contract signing). Two halves:
 *
 *  - sendOfferForSignature: renders the offer letter PDF and creates a
 *    DocuSign envelope addressed to the candidate; records the envelope id
 *    and flips the offer to SENT.
 *  - processEsignEvent: consumes persisted DocuSign Connect webhook events
 *    (completed / declined / voided) and updates the offer's signature
 *    status. Invoked asynchronously by the webhook route.
 *
 * Real mode when the DOCUSIGN_* env vars are set; local mode otherwise.
 * Connect signatures are HMAC-SHA256 (base64) of the raw body with
 * DOCUSIGN_WEBHOOK_SECRET.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { fetchWithRetry, IntegrationError } from '@/lib/integrations/http';
import { offerInclude } from '@/lib/offers';
import { renderOfferPdf } from '@/lib/offerPdf';
import { notifyOfferSigned } from '@/lib/integrations/slack';
import { renderOfferSentForSignatureEmail, sendEmail } from '@/lib/email';
import type { SignatureVerification } from '@/lib/integrations/backgroundCheck';

export class EsignFlowError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EsignFlowError';
  }
}

interface EnvelopeInput {
  documentBase64: string;
  documentName: string;
  signerName: string;
  signerEmail: string;
  emailSubject: string;
}

async function createEnvelope(input: EnvelopeInput): Promise<string> {
  const baseUrl = process.env.DOCUSIGN_BASE_URL;
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const accessToken = process.env.DOCUSIGN_ACCESS_TOKEN;

  if (!baseUrl || !accountId || !accessToken) {
    return `local-env-${randomUUID().slice(0, 12)}`;
  }

  const response = await fetchWithRetry(
    'docusign',
    `${baseUrl.replace(/\/$/, '')}/v2.1/accounts/${encodeURIComponent(accountId)}/envelopes`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        emailSubject: input.emailSubject,
        status: 'sent',
        documents: [
          {
            documentBase64: input.documentBase64,
            name: input.documentName,
            fileExtension: 'pdf',
            documentId: '1',
          },
        ],
        recipients: {
          signers: [
            {
              email: input.signerEmail,
              name: input.signerName,
              recipientId: '1',
              routingOrder: '1',
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new IntegrationError('docusign', `Envelope creation failed with ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }

  const body = (await response.json()) as { envelopeId?: string };
  if (!body.envelopeId) {
    throw new IntegrationError('docusign', 'Provider response did not include an envelopeId.');
  }
  return body.envelopeId;
}

export async function sendOfferForSignature(offerId: string, actorUserId: string) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    include: offerInclude,
  });
  if (!offer) {
    throw new EsignFlowError(404, 'OFFER_NOT_FOUND', 'No offer exists with this id.');
  }
  if (offer.approvalState !== 'APPROVED') {
    throw new EsignFlowError(422, 'NOT_APPROVED', 'Only fully approved offers can be sent for signature.');
  }
  if (offer.signatureStatus === 'SIGNED') {
    throw new EsignFlowError(409, 'ALREADY_SIGNED', 'This offer has already been signed.');
  }

  const pdf = await renderOfferPdf(offer);
  const candidate = offer.application.candidate;

  const envelopeId = await createEnvelope({
    documentBase64: pdf.toString('base64'),
    documentName: `Offer — ${offer.application.job.title}.pdf`,
    signerName: `${candidate.firstName} ${candidate.lastName}`,
    signerEmail: candidate.email,
    emailSubject: `Your offer from Acme Corp — ${offer.application.job.title}`,
  });

  const updated = await prisma.offer.update({
    where: { id: offer.id },
    data: { esignEnvelopeId: envelopeId, signatureStatus: 'SENT' },
  });

  // Notify the candidate with the tokenized offer link (dual-mode email:
  // SMTP when configured, logged locally otherwise; never throws).
  const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const delivery = await sendEmail(
    renderOfferSentForSignatureEmail({
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      candidateEmail: candidate.email,
      jobTitle: offer.application.job.title,
      offerUrl: `${baseUrl}/offers?offer=${offer.id}&token=${offer.accessToken}`,
      expiresAt: offer.expiresAt,
    }),
  );

  await prisma.auditLog.create({
    data: {
      actorId: actorUserId,
      action: 'offer.sent_for_signature',
      entityType: 'Offer',
      entityId: offer.id,
      detail: {
        envelopeId,
        provider: process.env.DOCUSIGN_BASE_URL ? 'docusign' : 'local',
        signer: candidate.email,
        emailDelivery: { mode: delivery.mode, delivered: delivery.delivered },
      },
    },
  });

  return {
    offerId: updated.id,
    envelopeId,
    signatureStatus: updated.signatureStatus,
    signer: { name: `${candidate.firstName} ${candidate.lastName}`, email: candidate.email },
  };
}

// ---------------------------------------------------------------------------
// Webhook side (DocuSign Connect)
// ---------------------------------------------------------------------------

export function verifyDocusignSignature(rawBody: string, signatureHeader: string | null): SignatureVerification {
  const secret = process.env.DOCUSIGN_WEBHOOK_SECRET;
  if (!secret) {
    return { verified: false, required: false };
  }
  if (!signatureHeader) {
    return { verified: false, required: true };
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
  const provided = Buffer.from(signatureHeader);
  const wanted = Buffer.from(expected);
  const verified = provided.length === wanted.length && timingSafeEqual(provided, wanted);
  return { verified, required: true };
}

const EVENT_MAP: Record<string, 'SIGNED' | 'DECLINED' | 'EXPIRED'> = {
  'envelope-completed': 'SIGNED',
  'recipient-declined': 'DECLINED',
  'envelope-declined': 'DECLINED',
  'envelope-voided': 'EXPIRED',
  'envelope-expired': 'EXPIRED',
};

/** Processes one persisted DocuSign event; called asynchronously. */
export async function processEsignEvent(eventId: string): Promise<void> {
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } });
  try {
    const payload = event.payload as { envelopeId?: string; event?: string };
    if (!payload.envelopeId || !payload.event) {
      throw new Error('Payload must include envelopeId and event.');
    }
    const mapped = EVENT_MAP[payload.event.toLowerCase()];
    if (!mapped) {
      throw new Error(`Unhandled DocuSign event "${payload.event}".`);
    }

    const offer = await prisma.offer.findUnique({
      where: { esignEnvelopeId: payload.envelopeId },
      include: {
        application: {
          include: {
            candidate: { select: { firstName: true, lastName: true } },
            job: { select: { title: true } },
          },
        },
      },
    });
    if (!offer) {
      throw new Error(`No offer with envelope "${payload.envelopeId}".`);
    }

    await prisma.$transaction([
      prisma.offer.update({
        where: { id: offer.id },
        data: {
          signatureStatus: mapped,
          signedAt: mapped === 'SIGNED' ? new Date() : offer.signedAt,
        },
      }),
      prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'offer.signature_status_changed',
          entityType: 'Offer',
          entityId: offer.id,
          detail: { envelopeId: payload.envelopeId, event: payload.event, signatureStatus: mapped, via: 'webhook' },
        },
      }),
    ]);

    if (mapped === 'SIGNED') {
      await notifyOfferSigned({
        candidateName: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
        jobTitle: offer.application.job.title,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: 'FAILED', error: message.slice(0, 500), processedAt: new Date() },
    });
    console.error(`E-sign webhook event ${event.id} failed:`, message);
  }
}
