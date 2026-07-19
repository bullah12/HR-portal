/**
 * GET /api/jobs/[id]/ranking — the ATS score ranking for a job with bias
 * controls applied (masked candidates are anonymised, lib/ranking.ts).
 * Hiring managers may only rank their own requisitions.
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { buildJobRanking } from '@/lib/ranking';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const job = await prisma.job.findUnique({ where: { id: params.id }, select: { id: true, title: true, ownerId: true } });
    if (!job) {
      return fail(404, 'JOB_NOT_FOUND', 'No job exists with this id.');
    }
    if (auth.role === 'HIRING_MANAGER' && job.ownerId !== auth.userId) {
      return fail(403, 'FORBIDDEN', 'Hiring managers may only view rankings for their own requisitions.');
    }

    const ranking = await buildJobRanking(job.id);
    return ok({
      jobId: job.id,
      jobTitle: job.title,
      ranking,
      note: 'Scores are decision-support only. Advance/reject decisions must be recorded by a human (GDPR Art. 22).',
    });
  } catch (error) {
    console.error('GET /api/jobs/[id]/ranking failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
