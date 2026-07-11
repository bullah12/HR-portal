/**
 * /api/onboarding/[candidateId]/tasks
 *  - GET:   the onboarding checklist + documents + progress.
 *           Public with ?token=<plan.accessToken> (candidate view, staff
 *           details stripped) or staff-authenticated by candidate id.
 *  - PATCH: update a task's status — HR only (spec: "editable by HR,
 *           viewable by candidate"). Recomputes plan progress.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { isAccessError, recomputeProgress, resolveOnboardingAccess, toPlanDto } from '@/lib/onboarding';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { candidateId: string } }) {
  try {
    const access = await resolveOnboardingAccess(
      params.candidateId,
      request.nextUrl.searchParams.get('token'),
      getAuthContext(request),
    );
    if (isAccessError(access)) {
      return fail(access.status, access.code, access.message);
    }

    return ok(toPlanDto(access.plan, access.kind));
  } catch (error) {
    console.error('GET /api/onboarding/[candidateId]/tasks failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const patchSchema = z.object({
  taskId: z.string().min(1),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']),
});

export async function PATCH(request: NextRequest, { params }: { params: { candidateId: string } }) {
  try {
    // Middleware only routes staff here (PATCH has no public token mode).
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
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid task update payload.', parsed.error.flatten().fieldErrors);
    }

    const access = await resolveOnboardingAccess(params.candidateId, null, auth);
    if (isAccessError(access)) {
      return fail(access.status, access.code, access.message);
    }

    const task = access.plan.tasks.find((candidate) => candidate.id === parsed.data.taskId);
    if (!task) {
      return fail(404, 'TASK_NOT_FOUND', 'This task does not belong to the candidate’s onboarding plan.');
    }

    await prisma.onboardingTask.update({
      where: { id: task.id },
      data: {
        status: parsed.data.status,
        completedAt: parsed.data.status === 'COMPLETED' ? new Date() : null,
      },
    });
    const progressPercent = await recomputeProgress(access.plan.id);

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'onboarding_task.status_changed',
        entityType: 'OnboardingTask',
        entityId: task.id,
        detail: { from: task.status, to: parsed.data.status, planId: access.plan.id },
      },
    });

    return ok({ taskId: task.id, status: parsed.data.status, progressPercent });
  } catch (error) {
    console.error('PATCH /api/onboarding/[candidateId]/tasks failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
