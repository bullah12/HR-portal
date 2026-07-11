/**
 * POST /api/interviews/[id]/cancel — cancel a scheduled interview.
 *
 * Marks the interview CANCELLED and removes the calendar event. The DB
 * cancellation always wins: if the calendar provider fails, the interview
 * is still cancelled and the response reports calendarRemoved: false so
 * the recruiter can clean the invite up manually.
 */

import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { getCalendarProvider } from '@/lib/calendar';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const interview = await prisma.interview.findUnique({
      where: { id: params.id },
      include: {
        application: {
          include: {
            candidate: { select: { firstName: true, lastName: true } },
            job: { select: { title: true } },
          },
        },
      },
    });
    if (!interview) {
      return fail(404, 'INTERVIEW_NOT_FOUND', 'No interview exists with this id.');
    }
    if (interview.status === 'CANCELLED') {
      return fail(409, 'ALREADY_CANCELLED', 'This interview has already been cancelled.');
    }
    if (interview.status === 'COMPLETED') {
      return fail(422, 'ALREADY_COMPLETED', 'A completed interview cannot be cancelled.');
    }

    const updated = await prisma.interview.update({
      where: { id: interview.id },
      data: { status: 'CANCELLED' },
    });

    let calendarRemoved = false;
    if (interview.calendarEventId) {
      try {
        await getCalendarProvider().deleteEvent(interview.calendarEventId);
        calendarRemoved = true;
      } catch (error) {
        console.error(`Calendar removal failed for interview ${interview.id}:`, error);
      }
    }

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'interview.cancelled',
        entityType: 'Interview',
        entityId: interview.id,
        detail: {
          applicationId: interview.applicationId,
          calendarEventId: interview.calendarEventId,
          calendarRemoved,
        },
      },
    });

    return ok({
      id: updated.id,
      status: updated.status,
      candidate: `${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`,
      jobTitle: interview.application.job.title,
      calendarRemoved,
    });
  } catch (error) {
    console.error('POST /api/interviews/[id]/cancel failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
