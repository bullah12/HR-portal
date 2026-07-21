/**
 * Consent-expiry automation (docs/PLAN.md §7 Phase 6).
 *
 * ConsentRecords carry their own expiresAt; the aggregate GDPR state lives
 * on Candidate.consentStatus. A candidate whose every non-withdrawn record
 * is past expiry no longer has a valid processing basis → their status
 * flips to EXPIRED, and each overdue record plus the transition is written
 * to the audit log (actor null = system action).
 *
 * Idempotent: candidates already EXPIRED or WITHDRAWN are skipped, so a
 * scheduled re-run never double-audits. Records are never deleted (GDPR
 * evidence trail).
 */

// Relative import so ts-node (scripts/expire-consents.ts) resolves it
// without the Next.js "@/" path alias.
import { prisma } from './prisma';

export interface ConsentExpiryResult {
  checkedCandidates: number;
  expiredCandidates: number;
  expiredRecords: number;
}

export async function expireOverdueConsents(now: Date = new Date()): Promise<ConsentExpiryResult> {
  // Candidates that still claim a live consent basis.
  const candidates = await prisma.candidate.findMany({
    where: { consentStatus: { in: ['PENDING', 'GRANTED'] } },
    include: { consentRecords: true },
  });

  let expiredCandidates = 0;
  let expiredRecords = 0;

  for (const candidate of candidates) {
    const activeRecords = candidate.consentRecords.filter((record) => record.withdrawnAt === null);
    if (activeRecords.length === 0) continue;

    const overdue = activeRecords.filter((record) => record.expiresAt <= now);
    if (overdue.length !== activeRecords.length) continue; // some consent still valid

    await prisma.$transaction([
      prisma.candidate.update({
        where: { id: candidate.id },
        data: { consentStatus: 'EXPIRED' },
      }),
      ...overdue.map((record) =>
        prisma.auditLog.create({
          data: {
            actorId: null,
            action: 'consent.expired',
            entityType: 'ConsentRecord',
            entityId: record.id,
            detail: {
              candidateId: candidate.id,
              purpose: record.purpose,
              expiresAt: record.expiresAt.toISOString(),
              via: 'scheduled-expiry',
            },
          },
        }),
      ),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'candidate.consent_expired',
          entityType: 'Candidate',
          entityId: candidate.id,
          detail: {
            from: candidate.consentStatus,
            to: 'EXPIRED',
            expiredRecordIds: overdue.map((record) => record.id),
            via: 'scheduled-expiry',
          },
        },
      }),
    ]);

    expiredCandidates += 1;
    expiredRecords += overdue.length;
  }

  return { checkedCandidates: candidates.length, expiredCandidates, expiredRecords };
}
