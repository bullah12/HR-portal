/**
 * ATS score ranking for one job, with bias controls (spec section 3):
 * candidates flagged maskedInRankingView appear as an anonymous label —
 * never by name — and no other identifying fields (location, contact
 * details) are ever exposed in ranking entries.
 */

import { prisma } from '@/lib/prisma';

export interface RankingEntry {
  rank: number;
  applicationId: string;
  candidateLabel: string;
  masked: boolean;
  totalScore: number;
  capApplied: boolean;
  stage: string;
}

export async function buildJobRanking(jobId: string): Promise<RankingEntry[]> {
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
      candidateLabel: candidate.maskedInRankingView
        ? `Candidate ${score.applicationId.slice(-6).toUpperCase()}`
        : `${candidate.firstName} ${candidate.lastName}`,
      masked: candidate.maskedInRankingView,
      totalScore: score.totalScore,
      capApplied: score.capApplied,
      stage: score.application.stage,
    };
  });
}
