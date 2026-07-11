/**
 * /api/interviews
 *  - GET:  list interviews for the caller. Recruiters/HR admins see all
 *          (with filters); hiring managers and interviewers see only
 *          interviews where they sit on the panel (spec section 1:
 *          "view assigned candidate packet only").
 *  - POST: schedule an interview (recruiter/HR admin). Runs panel conflict
 *          detection, creates the calendar event + Teams link (spec
 *          section 6), renders the candidate confirmation email template
 *          (no send — Phase 2b wiring), and audits the action.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { getCalendarProvider, CalendarError } from '@/lib/calendar';
import { renderInterviewConfirmationEmail } from '@/lib/email';
import { notifyInterviewScheduled } from '@/lib/integrations/slack';

export const runtime = 'nodejs';

const INTERVIEW_TYPES = ['PHONE_SCREEN', 'TECHNICAL', 'PANEL', 'HIRING_MANAGER', 'FINAL'] as const;
const INTERVIEW_STATUSES = ['SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
const ACTIVE_STATUSES = ['SCHEDULED', 'RESCHEDULED'] as const;

const interviewInclude = {
  application: {
    include: {
      candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
      job: { select: { id: true, title: true, location: true } },
    },
  },
  panelists: { select: { id: true, name: true, email: true, role: true } },
  _count: { select: { scorecards: true } },
} satisfies Prisma.InterviewInclude;

type InterviewWithRelations = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;

function toInterviewDto(interview: InterviewWithRelations) {
  return {
    id: interview.id,
    type: interview.type,
    status: interview.status,
    slotStart: interview.slotStart.toISOString(),
    slotEnd: interview.slotEnd.toISOString(),
    videoLink: interview.videoLink,
    calendarEventId: interview.calendarEventId,
    application: {
      id: interview.application.id,
      stage: interview.application.stage,
      candidate: {
        id: interview.application.candidate.id,
        name: `${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`,
      },
      job: interview.application.job,
    },
    panelists: interview.panelists,
    scorecardCount: interview._count.scorecards,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    if (status !== null && !INTERVIEW_STATUSES.includes(status as (typeof INTERVIEW_STATUSES)[number])) {
      return fail(400, 'VALIDATION_ERROR', `status must be one of: ${INTERVIEW_STATUSES.join(', ')}.`);
    }

    const where: Prisma.InterviewWhereInput = {};
    if (status) where.status = status as (typeof INTERVIEW_STATUSES)[number];
    if (params.get('applicationId')) where.applicationId = params.get('applicationId') as string;
    if (params.get('upcoming') === 'true') where.slotStart = { gte: new Date() };

    // Interviewers and hiring managers only ever see their own panels.
    if (auth.role === 'INTERVIEWER' || auth.role === 'HIRING_MANAGER') {
      where.panelists = { some: { id: auth.userId } };
    }

    const interviews = await prisma.interview.findMany({
      where,
      include: interviewInclude,
      orderBy: { slotStart: 'asc' },
    });

    return ok(interviews.map(toInterviewDto));
  } catch (error) {
    console.error('GET /api/interviews failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const createInterviewSchema = z
  .object({
    applicationId: z.string().min(1).optional(),
    candidateId: z.string().min(1).optional(),
    jobId: z.string().min(1).optional(),
    type: z.enum(INTERVIEW_TYPES),
    slotStart: z.string().datetime({ offset: true }),
    slotEnd: z.string().datetime({ offset: true }),
    panelistIds: z.array(z.string().min(1)).min(1).max(8),
  })
  .refine((data) => data.applicationId || (data.candidateId && data.jobId), {
    message: 'Provide applicationId, or candidateId and jobId together.',
    path: ['applicationId'],
  });

const UNSCHEDULABLE_STAGES = ['KNOCKOUT_FAILED', 'REJECTED', 'WITHDRAWN', 'HIRED'] as const;

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

    const parsed = createInterviewSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid interview payload.', parsed.error.flatten().fieldErrors);
    }

    const slotStart = new Date(parsed.data.slotStart);
    const slotEnd = new Date(parsed.data.slotEnd);
    if (slotEnd <= slotStart) {
      return fail(400, 'VALIDATION_ERROR', 'slotEnd must be after slotStart.');
    }
    if (slotStart <= new Date()) {
      return fail(400, 'VALIDATION_ERROR', 'Interviews must be scheduled in the future.');
    }

    const application = await prisma.application.findUnique({
      where: parsed.data.applicationId
        ? { id: parsed.data.applicationId }
        : {
            candidateId_jobId: {
              candidateId: parsed.data.candidateId as string,
              jobId: parsed.data.jobId as string,
            },
          },
      include: { candidate: true, job: true },
    });
    if (!application) {
      return fail(404, 'APPLICATION_NOT_FOUND', 'No application exists for this candidate and job.');
    }
    if ((UNSCHEDULABLE_STAGES as readonly string[]).includes(application.stage)) {
      return fail(422, 'INVALID_STAGE', `Cannot schedule an interview for an application in stage ${application.stage}.`);
    }

    const panelistIds = [...new Set(parsed.data.panelistIds)];
    const panelists = await prisma.user.findMany({ where: { id: { in: panelistIds } } });
    if (panelists.length !== panelistIds.length) {
      return fail(404, 'PANELIST_NOT_FOUND', 'One or more panelistIds do not match staff users.');
    }

    // Panel conflict detection (spec section 2): overlapping active
    // interviews for any requested panelist block the slot.
    const conflicts = await prisma.interview.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        slotStart: { lt: slotEnd },
        slotEnd: { gt: slotStart },
        panelists: { some: { id: { in: panelistIds } } },
      },
      include: { panelists: { select: { id: true, name: true } } },
    });
    if (conflicts.length > 0) {
      return fail(409, 'PANEL_CONFLICT', 'One or more panelists already have an interview in this slot.', {
        conflicts: conflicts.map((conflict) => ({
          interviewId: conflict.id,
          slotStart: conflict.slotStart.toISOString(),
          slotEnd: conflict.slotEnd.toISOString(),
          panelists: conflict.panelists
            .filter((panelist) => panelistIds.includes(panelist.id))
            .map((panelist) => panelist.name),
        })),
      });
    }

    // Calendar event + Teams link (spec section 6). Attendees: candidate +
    // panel. Failure here aborts scheduling — an interview without an
    // invite would silently never happen.
    const calendar = getCalendarProvider();
    let calendarEvent;
    try {
      calendarEvent = await calendar.createEvent({
        subject: `Interview (${parsed.data.type.replaceAll('_', ' ').toLowerCase()}): ${application.candidate.firstName} ${application.candidate.lastName} — ${application.job.title}`,
        body: `Interview for the ${application.job.title} role.\nCandidate: ${application.candidate.firstName} ${application.candidate.lastName}\nPanel: ${panelists.map((panelist) => panelist.name).join(', ')}`,
        start: slotStart,
        end: slotEnd,
        attendees: [
          { email: application.candidate.email, name: `${application.candidate.firstName} ${application.candidate.lastName}` },
          ...panelists.map((panelist) => ({ email: panelist.email, name: panelist.name })),
        ],
        createOnlineMeeting: true,
      });
    } catch (error) {
      const message = error instanceof CalendarError ? error.message : 'Calendar provider unavailable.';
      return fail(502, 'CALENDAR_ERROR', `Interview not scheduled: ${message}`);
    }

    const interview = await prisma.interview.create({
      data: {
        applicationId: application.id,
        type: parsed.data.type,
        slotStart,
        slotEnd,
        videoLink: calendarEvent.videoLink,
        calendarEventId: calendarEvent.eventId,
        panelists: { connect: panelistIds.map((id) => ({ id })) },
      },
      include: interviewInclude,
    });

    // Scheduling is a human pipeline action — advance early-stage
    // applications to INTERVIEW and audit it.
    const stageAdvanced = ['APPLIED', 'SCREENING', 'SHORTLISTED'].includes(application.stage);
    if (stageAdvanced) {
      await prisma.application.update({
        where: { id: application.id },
        data: { stage: 'INTERVIEW' },
      });
    }

    const email = renderInterviewConfirmationEmail({
      candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`,
      candidateEmail: application.candidate.email,
      jobTitle: application.job.title,
      interviewType: parsed.data.type,
      slotStart,
      slotEnd,
      videoLink: calendarEvent.videoLink,
      panelistNames: panelists.map((panelist) => panelist.name),
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'interview.scheduled',
        entityType: 'Interview',
        entityId: interview.id,
        detail: {
          applicationId: application.id,
          type: parsed.data.type,
          slotStart: slotStart.toISOString(),
          calendarProvider: calendarEvent.provider,
          calendarEventId: calendarEvent.eventId,
          stageAdvanced,
          emailRendered: true,
          decisionBy: 'human',
        },
      },
    });

    // Best-effort Slack ping — sendSlackMessage never throws.
    await notifyInterviewScheduled({
      candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`,
      jobTitle: application.job.title,
      type: parsed.data.type,
      slotStart,
      panelistNames: panelists.map((panelist) => panelist.name),
    });

    return ok(
      {
        interview: toInterviewDto({
          ...interview,
          application: {
            ...interview.application,
            stage: stageAdvanced ? 'INTERVIEW' : interview.application.stage,
          },
        }),
        calendar: {
          provider: calendarEvent.provider,
          eventId: calendarEvent.eventId,
          videoLink: calendarEvent.videoLink,
        },
        // Rendered template only — delivery via AWS SES arrives in Phase 2b.
        emailPreview: email,
      },
      201,
    );
  } catch (error) {
    console.error('POST /api/interviews failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
