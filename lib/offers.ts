/**
 * Shared offer helpers used by /api/offers, /api/offers/[id], and
 * /api/offers/[id]/pdf: the include shape, DTO mapping, and per-record
 * visibility rules (spec section 1).
 */

import { Prisma } from '@prisma/client';
import type { AuthContext } from '@/lib/auth';

export const offerInclude = {
  application: {
    include: {
      candidate: { select: { id: true, firstName: true, lastName: true, email: true, location: true } },
      job: {
        select: {
          id: true,
          title: true,
          location: true,
          ownerId: true,
          compBandMin: true,
          compBandMax: true,
          compBandCurrency: true,
        },
      },
    },
  },
  approvals: {
    orderBy: { sequence: 'asc' },
    include: { approver: { select: { id: true, name: true, role: true } } },
  },
} satisfies Prisma.OfferInclude;

export type OfferWithRelations = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

/**
 * Who may see an offer (spec section 1): HR admins and recruiters see all;
 * hiring managers see offers on their own requisitions or where they are
 * an approver; finance approvers see offers they must approve.
 */
export function canViewOffer(auth: AuthContext, offer: OfferWithRelations): boolean {
  if (auth.role === 'HR_ADMIN' || auth.role === 'RECRUITER') return true;
  const isApprover = offer.approvals.some((approval) => approval.approver.id === auth.userId);
  if (auth.role === 'FINANCE_APPROVER') return isApprover;
  if (auth.role === 'HIRING_MANAGER') {
    return isApprover || offer.application.job.ownerId === auth.userId;
  }
  return false;
}

export function toOfferDto(offer: OfferWithRelations) {
  return {
    id: offer.id,
    baseSalary: Number(offer.baseSalary),
    currency: offer.currency,
    bonusPercent: offer.bonusPercent === null ? null : Number(offer.bonusPercent),
    startDate: offer.startDate.toISOString(),
    approvalState: offer.approvalState,
    signatureStatus: offer.signatureStatus,
    expiresAt: offer.expiresAt.toISOString(),
    signedAt: offer.signedAt?.toISOString() ?? null,
    createdAt: offer.createdAt.toISOString(),
    application: {
      id: offer.application.id,
      stage: offer.application.stage,
      candidate: {
        id: offer.application.candidate.id,
        name: `${offer.application.candidate.firstName} ${offer.application.candidate.lastName}`,
        email: offer.application.candidate.email,
      },
      job: {
        id: offer.application.job.id,
        title: offer.application.job.title,
        location: offer.application.job.location,
        compBand: {
          min: Number(offer.application.job.compBandMin),
          max: Number(offer.application.job.compBandMax),
          currency: offer.application.job.compBandCurrency,
        },
      },
    },
    approvals: offer.approvals.map((approval) => ({
      sequence: approval.sequence,
      decision: approval.decision,
      comment: approval.comment,
      decidedAt: approval.decidedAt?.toISOString() ?? null,
      approver: approval.approver,
    })),
  };
}
