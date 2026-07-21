/**
 * POST /api/offers/[id]/accept — the candidate accepts or declines their
 * offer via the tokenized link (no login; the token in the body is the
 * offer's accessToken).
 *
 * Acceptance (spec offer + onboarding stages):
 *  - requires a fully approved, unexpired, undecided offer
 *  - moves the application to HIRED
 *  - creates the onboarding plan with the standard checklist (documents,
 *    IT provisioning, training) and returns the public onboarding link
 *  - closes out other active applications on the job ("auto-notify and
 *    close out other active candidates on acceptance"), audited as a
 *    system action triggered by the acceptance
 *
 * Decline moves the application to WITHDRAWN. E-signature (DocuSign) is
 * Phase 3 — signatureStatus is not touched here.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/types';
import { notifyOfferAccepted } from '@/lib/integrations/slack';
import { renderOfferAcceptedEmail, sendEmail } from '@/lib/email';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

const bodySchema = z.object({
  token: z.string().min(1),
  decision: z.enum(['ACCEPTED', 'DECLINED']),
});

interface TaskTemplate {
  title: string;
  category: 'DOCUMENTS' | 'IT_PROVISIONING' | 'TRAINING' | 'OTHER';
  requiresDocument: boolean;
  /** Days relative to the start date (negative = before day one). */
  dueOffsetDays: number;
}

const STANDARD_CHECKLIST: TaskTemplate[] = [
  { title: 'Sign employment contract', category: 'DOCUMENTS', requiresDocument: true, dueOffsetDays: -14 },
  { title: 'Complete employee data form', category: 'DOCUMENTS', requiresDocument: true, dueOffsetDays: -10 },
  { title: 'Submit tax forms and bank details', category: 'DOCUMENTS', requiresDocument: true, dueOffsetDays: -7 },
  { title: 'Sign non-disclosure agreement (NDA)', category: 'DOCUMENTS', requiresDocument: true, dueOffsetDays: -7 },
  { title: 'IT provisioning: accounts and equipment', category: 'IT_PROVISIONING', requiresDocument: false, dueOffsetDays: -3 },
  { title: 'Complete security & compliance training', category: 'TRAINING', requiresDocument: false, dueOffsetDays: 5 },
];

const ACTIVE_STAGES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER'] as const;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'token and decision are required.', parsed.error.flatten().fieldErrors);
    }

    const offer = await prisma.offer.findUnique({
      where: { id: params.id },
      include: {
        application: { include: { candidate: true, job: true, onboardingPlan: true } },
      },
    });
    // Same response for a wrong id and a wrong token — no offer probing.
    if (!offer || offer.accessToken !== parsed.data.token) {
      return fail(404, 'OFFER_NOT_FOUND', 'This offer link is invalid or has been revoked.');
    }

    if (offer.candidateDecision !== 'PENDING') {
      return fail(409, 'ALREADY_DECIDED', `This offer was already ${offer.candidateDecision.toLowerCase()}.`);
    }
    if (offer.expiresAt <= new Date()) {
      return fail(410, 'OFFER_EXPIRED', 'This offer has expired. Please contact the recruitment team.');
    }
    if (offer.approvalState !== 'APPROVED') {
      return fail(422, 'NOT_APPROVED', 'This offer is not open for acceptance yet.');
    }

    const decidedAt = new Date();

    if (parsed.data.decision === 'DECLINED') {
      await prisma.$transaction([
        prisma.offer.update({
          where: { id: offer.id },
          data: { candidateDecision: 'DECLINED', candidateDecidedAt: decidedAt },
        }),
        prisma.application.update({
          where: { id: offer.applicationId },
          data: { stage: 'WITHDRAWN' },
        }),
        prisma.auditLog.create({
          data: {
            actorId: null,
            action: 'offer.declined_by_candidate',
            entityType: 'Offer',
            entityId: offer.id,
            detail: { applicationId: offer.applicationId, decidedAt: decidedAt.toISOString() },
          },
        }),
      ]);
      return ok({ decision: 'DECLINED', applicationStage: 'WITHDRAWN' });
    }

    // --- Acceptance ---
    const otherActive = await prisma.application.findMany({
      where: {
        jobId: offer.application.jobId,
        id: { not: offer.applicationId },
        stage: { in: [...ACTIVE_STAGES] },
      },
      select: { id: true },
    });

    const startDate = offer.startDate;
    const jobOwnerId = offer.application.job.ownerId;

    const [, , plan] = await prisma.$transaction([
      prisma.offer.update({
        where: { id: offer.id },
        data: { candidateDecision: 'ACCEPTED', candidateDecidedAt: decidedAt },
      }),
      prisma.application.update({
        where: { id: offer.applicationId },
        data: { stage: 'HIRED' },
      }),
      offer.application.onboardingPlan
        ? prisma.onboardingPlan.update({
            where: { id: offer.application.onboardingPlan.id },
            data: {},
          })
        : prisma.onboardingPlan.create({
            data: {
              applicationId: offer.applicationId,
              startDate,
              checklistTemplate: 'standard-onboarding-v1',
              tasks: {
                create: STANDARD_CHECKLIST.map((template) => ({
                  title: template.title,
                  category: template.category,
                  requiresDocument: template.requiresDocument,
                  dueDate: new Date(startDate.getTime() + template.dueOffsetDays * DAY_MS),
                  ownerId: jobOwnerId,
                })),
              },
            },
          }),
      ...otherActive.map((application) =>
        prisma.application.update({
          where: { id: application.id },
          data: {
            stage: 'REJECTED',
            rejectionReason: 'Position filled — another candidate accepted the offer.',
          },
        }),
      ),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'offer.accepted_by_candidate',
          entityType: 'Offer',
          entityId: offer.id,
          detail: {
            applicationId: offer.applicationId,
            decidedAt: decidedAt.toISOString(),
            closedOutApplications: otherActive.map((application) => application.id),
            trigger: 'candidate-acceptance',
          },
        },
      }),
    ]);

    // Welcome email with the onboarding link (dual-mode: SMTP when
    // configured, logged locally otherwise; never throws).
    const baseUrl = (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    await sendEmail(
      renderOfferAcceptedEmail({
        candidateName: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
        candidateEmail: offer.application.candidate.email,
        jobTitle: offer.application.job.title,
        startDate: offer.startDate,
        onboardingUrl: `${baseUrl}/onboarding/${plan.accessToken}`,
      }),
    );

    // Best-effort Slack ping — sendSlackMessage never throws.
    await notifyOfferAccepted({
      candidateName: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
      jobTitle: offer.application.job.title,
      startDate: offer.startDate,
    });

    return ok({
      decision: 'ACCEPTED',
      applicationStage: 'HIRED',
      onboardingToken: plan.accessToken,
      onboardingUrl: `/onboarding/${plan.accessToken}`,
      closedOutApplications: otherActive.length,
    });
  } catch (error) {
    console.error('POST /api/offers/[id]/accept failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
