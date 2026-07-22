import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { getAuthContext } from '@/lib/auth';
import type { TodayDashboardDto } from '@/lib/dashboard';
import { prisma } from '@/lib/prisma';
import { fail, ok } from '@/lib/types';

export const runtime = 'nodejs';

const DAY_MS = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  dayStart: z.string().datetime({ offset: true }),
  dayEnd: z.string().datetime({ offset: true }),
});

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const parsed = querySchema.safeParse({
      dayStart: request.nextUrl.searchParams.get('dayStart'),
      dayEnd: request.nextUrl.searchParams.get('dayEnd'),
    });
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'dayStart and dayEnd must be ISO timestamps.');
    }

    const dayStart = new Date(parsed.data.dayStart);
    const dayEnd = new Date(parsed.data.dayEnd);
    if (dayEnd <= dayStart || dayEnd.getTime() - dayStart.getTime() > 2 * DAY_MS) {
      return fail(400, 'VALIDATION_ERROR', 'The requested dashboard window is invalid.');
    }

    const canSeeRecruiting = auth.role === 'HR_ADMIN' || auth.role === 'RECRUITER';
    const canSeeInterviews = canSeeRecruiting || auth.role === 'HIRING_MANAGER' || auth.role === 'INTERVIEWER';
    const canSeeApprovals =
      canSeeRecruiting || auth.role === 'HIRING_MANAGER' || auth.role === 'FINANCE_APPROVER';

    const interviewWhere: Prisma.InterviewWhereInput = {
      slotStart: { gte: dayStart, lt: dayEnd },
    };
    if (auth.role === 'HIRING_MANAGER' || auth.role === 'INTERVIEWER') {
      interviewWhere.panelists = { some: { id: auth.userId } };
    }

    const overdueWhere: Prisma.OnboardingTaskWhereInput = {
      dueDate: { lt: new Date() },
      status: { not: 'COMPLETED' },
    };
    if (auth.role === 'HIRING_MANAGER') {
      overdueWhere.ownerId = auth.userId;
    }

    const [approvalRows, interviewRows, recentCvRows, overdueRows] = await Promise.all([
      canSeeApprovals
        ? prisma.offerApproval.findMany({
            where: {
              approverId: auth.userId,
              decision: 'PENDING',
              offer: { approvalState: 'PENDING_APPROVAL' },
            },
            include: {
              offer: {
                include: {
                  application: {
                    include: {
                      candidate: { select: { firstName: true, lastName: true } },
                      job: { select: { title: true } },
                    },
                  },
                  approvals: {
                    orderBy: { sequence: 'asc' },
                    select: { sequence: true, decision: true },
                  },
                },
              },
            },
            orderBy: { sequence: 'asc' },
          })
        : Promise.resolve([]),
      canSeeInterviews
        ? prisma.interview.findMany({
            where: interviewWhere,
            include: {
              application: {
                include: {
                  candidate: { select: { firstName: true, lastName: true } },
                  job: { select: { title: true } },
                },
              },
              panelists: { select: { name: true } },
            },
            orderBy: { slotStart: 'asc' },
          })
        : Promise.resolve([]),
      canSeeRecruiting
        ? prisma.cVDocument.findMany({
            where: { uploadDate: { gte: new Date(Date.now() - DAY_MS) } },
            include: {
              application: {
                include: {
                  candidate: { select: { id: true, firstName: true, lastName: true } },
                  job: { select: { id: true, title: true } },
                },
              },
            },
            orderBy: { uploadDate: 'desc' },
          })
        : Promise.resolve([]),
      canSeeRecruiting || auth.role === 'HIRING_MANAGER'
        ? prisma.onboardingTask.findMany({
            where: overdueWhere,
            include: {
              plan: {
                include: {
                  application: {
                    include: {
                      candidate: { select: { id: true, firstName: true, lastName: true } },
                      job: { select: { title: true } },
                    },
                  },
                },
              },
            },
            orderBy: { dueDate: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const dashboard: TodayDashboardDto = {
      approvals: approvalRows
        .filter((approval) =>
          approval.offer.approvals
            .filter((step) => step.sequence < approval.sequence)
            .every((step) => step.decision === 'APPROVED'),
        )
        .map((approval) => ({
          offerId: approval.offerId,
          candidateName: `${approval.offer.application.candidate.firstName} ${approval.offer.application.candidate.lastName}`,
          jobTitle: approval.offer.application.job.title,
          baseSalary: Number(approval.offer.baseSalary),
          currency: approval.offer.currency,
          sequence: approval.sequence,
        })),
      interviews: interviewRows.map((interview) => ({
        id: interview.id,
        type: interview.type,
        status: interview.status,
        slotStart: interview.slotStart.toISOString(),
        slotEnd: interview.slotEnd.toISOString(),
        videoLink: interview.videoLink,
        candidateName: `${interview.application.candidate.firstName} ${interview.application.candidate.lastName}`,
        jobTitle: interview.application.job.title,
        panelists: interview.panelists.map((panelist) => panelist.name),
      })),
      recentCvs: recentCvRows.map((document) => ({
        documentId: document.id,
        candidateId: document.application.candidate.id,
        candidateName: `${document.application.candidate.firstName} ${document.application.candidate.lastName}`,
        jobId: document.application.job.id,
        jobTitle: document.application.job.title,
        uploadedAt: document.uploadDate.toISOString(),
      })),
      overdueTasks: overdueRows.map((task) => ({
        taskId: task.id,
        candidateId: task.plan.application.candidate.id,
        candidateName: `${task.plan.application.candidate.firstName} ${task.plan.application.candidate.lastName}`,
        jobTitle: task.plan.application.job.title,
        title: task.title,
        dueDate: task.dueDate.toISOString(),
        status: task.status,
      })),
    };

    return ok(dashboard);
  } catch (error) {
    console.error('GET /api/today failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
