/**
 * /api/candidates
 *  - GET:  list candidate records (HR admin / recruiter only).
 *  - POST: create a candidate. GDPR consent to application processing is
 *          captured at creation (spec section 2) and recorded as a
 *          ConsentRecord with an expiry.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok, toCandidateDto, CANDIDATE_SOURCES } from '@/lib/types';
import { notifyNewCandidate } from '@/lib/integrations/slack';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSING_CONSENT_DAYS = 365;
const TALENT_POOL_CONSENT_DAYS = 730;

const candidateInclude = {
  _count: { select: { applications: true } },
} satisfies Prisma.CandidateInclude;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const sourceParam = request.nextUrl.searchParams.get('source');
    if (sourceParam !== null && !CANDIDATE_SOURCES.includes(sourceParam as (typeof CANDIDATE_SOURCES)[number])) {
      return fail(400, 'VALIDATION_ERROR', `source must be one of: ${CANDIDATE_SOURCES.join(', ')}.`);
    }

    const candidates = await prisma.candidate.findMany({
      where: sourceParam ? { source: sourceParam as (typeof CANDIDATE_SOURCES)[number] } : undefined,
      include: candidateInclude,
      orderBy: { createdAt: 'desc' },
    });

    return ok(candidates.map(toCandidateDto));
  } catch (error) {
    console.error('GET /api/candidates failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const createCandidateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().email().toLowerCase(),
  phone: z.string().trim().min(5).max(30).optional(),
  location: z.string().trim().min(2).max(120).optional(),
  source: z.enum(CANDIDATE_SOURCES),
  consent: z.object({
    // Processing consent is mandatory at apply time (GDPR, spec section 2).
    processingAccepted: z.literal(true),
    talentPoolAccepted: z.boolean().default(false),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }

    const parsed = createCandidateSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid candidate payload.', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const consentRecords: Prisma.ConsentRecordCreateWithoutCandidateInput[] = [
      {
        purpose: 'APPLICATION_PROCESSING',
        grantedAt: now,
        expiresAt: new Date(now.getTime() + PROCESSING_CONSENT_DAYS * DAY_MS),
      },
    ];
    if (parsed.data.consent.talentPoolAccepted) {
      consentRecords.push({
        purpose: 'TALENT_POOL',
        grantedAt: now,
        expiresAt: new Date(now.getTime() + TALENT_POOL_CONSENT_DAYS * DAY_MS),
      });
    }

    let candidate;
    try {
      candidate = await prisma.candidate.create({
        data: {
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          email: parsed.data.email,
          phone: parsed.data.phone,
          location: parsed.data.location,
          source: parsed.data.source,
          consentStatus: 'GRANTED',
          maskedInRankingView: true,
          consentRecords: { create: consentRecords },
        },
        include: candidateInclude,
      });
    } catch (error) {
      // Duplicate-candidate detection: email is unique on Candidate.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return fail(409, 'DUPLICATE_CANDIDATE', 'A candidate with this email already exists.');
      }
      throw error;
    }

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'candidate.created',
        entityType: 'Candidate',
        entityId: candidate.id,
        detail: { source: candidate.source, consentStatus: candidate.consentStatus },
      },
    });

    // Best-effort Slack ping — sendSlackMessage never throws.
    await notifyNewCandidate({
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      source: candidate.source,
    });

    return ok(toCandidateDto(candidate), 201);
  } catch (error) {
    console.error('POST /api/candidates failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
