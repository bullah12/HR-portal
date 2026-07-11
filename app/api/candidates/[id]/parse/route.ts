/**
 * POST /api/candidates/[id]/parse — parse the candidate's latest CV for a
 * job and store the ATS score.
 *
 * Body: { "jobId": "..." }
 *
 * Returns the extracted fields, the weighted score breakdown, ranked
 * matched skills, and the job's current ranking. Candidate identities in
 * the ranking respect the masked-view bias controls (spec section 3):
 * masked candidates appear as an anonymous label, never by name.
 *
 * Idempotent: re-parsing the same CV upserts the same ParseResult /
 * CandidateScore rows and yields the same score.
 */

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { parseAndScoreApplication, ParseServiceError } from '@/services/cvParser';

export const runtime = 'nodejs';

const bodySchema = z.object({
  jobId: z.string().min(1),
});

interface RankingEntry {
  rank: number;
  applicationId: string;
  candidateLabel: string;
  totalScore: number;
  capApplied: boolean;
  stage: string;
}

async function buildJobRanking(jobId: string): Promise<RankingEntry[]> {
  const scores = await prisma.candidateScore.findMany({
    where: { application: { jobId } },
    orderBy: [{ totalScore: 'desc' }, { applicationId: 'asc' }],
    include: {
      application: { include: { candidate: true } },
    },
  });

  return scores.map((score, index) => {
    const { candidate } = score.application;
    return {
      rank: index + 1,
      applicationId: score.applicationId,
      // Bias controls: masked candidates are anonymised in ranking views.
      candidateLabel: candidate.maskedInRankingView
        ? `Candidate ${score.applicationId.slice(-6).toUpperCase()}`
        : `${candidate.firstName} ${candidate.lastName}`,
      totalScore: score.totalScore,
      capApplied: score.capApplied,
      stage: score.application.stage,
    };
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
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

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'jobId is required.', parsed.error.flatten().fieldErrors);
    }

    let result;
    try {
      result = await parseAndScoreApplication(params.id, parsed.data.jobId, auth.userId);
    } catch (error) {
      if (error instanceof ParseServiceError) {
        return fail(error.status, error.code, error.message);
      }
      throw error;
    }

    const ranking = await buildJobRanking(parsed.data.jobId);

    return ok({
      applicationId: result.applicationId,
      candidateId: result.candidateId,
      jobId: result.jobId,
      cvDocument: result.cvDocument,
      parserVersion: result.parserVersion,
      extractedFields: result.extractedFields,
      totalScore: result.totalScore,
      breakdown: result.breakdown,
      rankedSkills: result.rankedSkills,
      ranking,
      note: 'Scores are decision-support only. Advance/reject decisions must be recorded by a human (GDPR Art. 22).',
    });
  } catch (error) {
    console.error('POST /api/candidates/[id]/parse failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
