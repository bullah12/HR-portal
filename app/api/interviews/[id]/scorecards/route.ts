/**
 * /api/interviews/[id]/scorecards
 *  - GET:  list the scorecards submitted for an interview. Interviewers and
 *          hiring managers may only read scorecards of interviews they
 *          paneled; HR admins and recruiters see all.
 *  - POST: submit the caller's scorecard for an interview. The caller must
 *          be a panelist on the interview (or HR_ADMIN); one scorecard per
 *          (interview, interviewer) per the schema's unique constraint.
 *          Ratings are a criterion → 1-5 map; the submission is audited.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';

export const runtime = 'nodejs';

const RECOMMENDATIONS = ['STRONG_YES', 'YES', 'NO', 'STRONG_NO'] as const;

const scorecardInclude = {
  interviewer: { select: { id: true, name: true, role: true } },
} satisfies Prisma.ScorecardInclude;

type ScorecardWithInterviewer = Prisma.ScorecardGetPayload<{ include: typeof scorecardInclude }>;

function toScorecardDto(scorecard: ScorecardWithInterviewer) {
  return {
    id: scorecard.id,
    interviewId: scorecard.interviewId,
    interviewer: scorecard.interviewer,
    ratings: scorecard.ratings,
    recommendation: scorecard.recommendation,
    notes: scorecard.notes,
    submittedAt: scorecard.submittedAt.toISOString(),
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const interview = await prisma.interview.findUnique({
      where: { id: params.id },
      include: { panelists: { select: { id: true } } },
    });
    if (!interview) {
      return fail(404, 'INTERVIEW_NOT_FOUND', 'No interview exists with this id.');
    }

    // Panel-scoped visibility, mirroring GET /api/interviews.
    if (
      (auth.role === 'INTERVIEWER' || auth.role === 'HIRING_MANAGER') &&
      !interview.panelists.some((panelist) => panelist.id === auth.userId)
    ) {
      return fail(403, 'FORBIDDEN', 'You may only view scorecards for interviews you paneled.');
    }

    const scorecards = await prisma.scorecard.findMany({
      where: { interviewId: params.id },
      include: scorecardInclude,
      orderBy: { submittedAt: 'asc' },
    });

    return ok(scorecards.map(toScorecardDto));
  } catch (error) {
    console.error('GET /api/interviews/[id]/scorecards failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const submitScorecardSchema = z.object({
  ratings: z
    .record(z.string().trim().min(1).max(60), z.number().int().min(1).max(5))
    .refine((map) => Object.keys(map).length >= 1 && Object.keys(map).length <= 20, {
      message: 'Provide between 1 and 20 rated criteria.',
    }),
  recommendation: z.enum(RECOMMENDATIONS),
  notes: z.string().trim().max(4000).optional(),
});

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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

    const parsed = submitScorecardSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid scorecard payload.', parsed.error.flatten().fieldErrors);
    }

    const interview = await prisma.interview.findUnique({
      where: { id: params.id },
      include: { panelists: { select: { id: true } } },
    });
    if (!interview) {
      return fail(404, 'INTERVIEW_NOT_FOUND', 'No interview exists with this id.');
    }

    const isPanelist = interview.panelists.some((panelist) => panelist.id === auth.userId);
    if (!isPanelist && auth.role !== 'HR_ADMIN') {
      return fail(403, 'NOT_A_PANELIST', 'Only panelists on this interview (or HR admins) may submit a scorecard.');
    }

    if (interview.status === 'CANCELLED') {
      return fail(422, 'INTERVIEW_CANCELLED', 'Scorecards cannot be submitted for a cancelled interview.');
    }

    let scorecard: ScorecardWithInterviewer;
    try {
      scorecard = await prisma.scorecard.create({
        data: {
          interviewId: interview.id,
          interviewerId: auth.userId,
          ratings: parsed.data.ratings,
          recommendation: parsed.data.recommendation,
          notes: parsed.data.notes ?? null,
        },
        include: scorecardInclude,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return fail(409, 'ALREADY_SUBMITTED', 'You have already submitted a scorecard for this interview.');
      }
      throw error;
    }

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'scorecard.submitted',
        entityType: 'Scorecard',
        entityId: scorecard.id,
        detail: {
          interviewId: interview.id,
          applicationId: interview.applicationId,
          recommendation: parsed.data.recommendation,
          criteria: Object.keys(parsed.data.ratings),
          decisionBy: 'human',
        },
      },
    });

    return ok(toScorecardDto(scorecard), 201);
  } catch (error) {
    console.error('POST /api/interviews/[id]/scorecards failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
