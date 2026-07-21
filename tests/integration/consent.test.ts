/**
 * Consent-expiry automation (Phase 6): candidates whose every active
 * ConsentRecord is past expiresAt flip to EXPIRED with audit entries;
 * everyone else is untouched. Idempotent across re-runs.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { expireOverdueConsents } from '@/lib/consent';
import { resetDb } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

let overdueId: string;
let validId: string;
let mixedId: string;
let withdrawnId: string;

beforeAll(async () => {
  await resetDb();

  overdueId = (
    await prisma.candidate.create({
      data: {
        firstName: 'Olivia', lastName: 'Overdue', email: 'olivia.overdue@mail.example',
        source: 'JOB_BOARD', consentStatus: 'GRANTED',
        consentRecords: {
          create: [{ purpose: 'APPLICATION_PROCESSING', grantedAt: daysAgo(400), expiresAt: daysAgo(35) }],
        },
      },
    })
  ).id;

  validId = (
    await prisma.candidate.create({
      data: {
        firstName: 'Valentin', lastName: 'Valid', email: 'valentin.valid@mail.example',
        source: 'REFERRAL', consentStatus: 'GRANTED',
        consentRecords: {
          create: [{ purpose: 'APPLICATION_PROCESSING', grantedAt: daysAgo(10), expiresAt: new Date(Date.now() + 300 * DAY_MS) }],
        },
      },
    })
  ).id;

  // One expired record but another still valid — must NOT expire.
  mixedId = (
    await prisma.candidate.create({
      data: {
        firstName: 'Mia', lastName: 'Mixed', email: 'mia.mixed@mail.example',
        source: 'AGENCY', consentStatus: 'GRANTED',
        consentRecords: {
          create: [
            { purpose: 'APPLICATION_PROCESSING', grantedAt: daysAgo(400), expiresAt: daysAgo(30) },
            { purpose: 'TALENT_POOL', grantedAt: daysAgo(10), expiresAt: new Date(Date.now() + 300 * DAY_MS) },
          ],
        },
      },
    })
  ).id;

  // Already withdrawn — never touched by expiry.
  withdrawnId = (
    await prisma.candidate.create({
      data: {
        firstName: 'Wanda', lastName: 'Withdrawn', email: 'wanda.withdrawn@mail.example',
        source: 'CAREERS_PAGE', consentStatus: 'WITHDRAWN',
        consentRecords: {
          create: [{ purpose: 'APPLICATION_PROCESSING', grantedAt: daysAgo(400), expiresAt: daysAgo(30), withdrawnAt: daysAgo(100) }],
        },
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('consent-expiry automation', () => {
  it('expires only candidates whose every active consent is overdue, with audit entries', async () => {
    const result = await expireOverdueConsents();
    expect(result.expiredCandidates).toBe(1);
    expect(result.expiredRecords).toBe(1);

    const statuses = Object.fromEntries(
      (await prisma.candidate.findMany({ select: { id: true, consentStatus: true } })).map((candidate) => [
        candidate.id,
        candidate.consentStatus,
      ]),
    );
    expect(statuses[overdueId]).toBe('EXPIRED');
    expect(statuses[validId]).toBe('GRANTED');
    expect(statuses[mixedId]).toBe('GRANTED');
    expect(statuses[withdrawnId]).toBe('WITHDRAWN');

    const recordAudit = await prisma.auditLog.findMany({ where: { action: 'consent.expired' } });
    expect(recordAudit).toHaveLength(1);
    expect(recordAudit[0].actorId).toBeNull(); // system action

    const candidateAudit = await prisma.auditLog.findMany({ where: { action: 'candidate.consent_expired' } });
    expect(candidateAudit).toHaveLength(1);
    expect(candidateAudit[0].entityId).toBe(overdueId);
  });

  it('is idempotent — a second run changes nothing and writes no new audits', async () => {
    const result = await expireOverdueConsents();
    expect(result.expiredCandidates).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'consent.expired' } })).toBe(1);
  });

  it('consent records are never deleted', async () => {
    expect(await prisma.consentRecord.count()).toBe(5);
  });
});
