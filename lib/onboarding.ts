/**
 * Shared onboarding helpers: plan resolution with dual access modes and
 * DTO mapping.
 *
 * Access modes (spec constraint: public candidate link, no login):
 *  - candidate: the request carries ?token=<plan.accessToken>. The route
 *    param may be the candidate id or the token itself — both resolve to
 *    the same plan, and the token alone grants access to that plan only.
 *  - staff: no token; middleware has already enforced the staff role and
 *    the param is treated as a candidate id.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AuthContext } from '@/lib/auth';

export const planInclude = {
  application: {
    include: {
      candidate: { select: { id: true, firstName: true, lastName: true, email: true } },
      job: { select: { id: true, title: true, location: true } },
    },
  },
  tasks: {
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    include: { owner: { select: { id: true, name: true } } },
  },
  documents: { orderBy: { uploadedAt: 'desc' } },
} satisfies Prisma.OnboardingPlanInclude;

export type PlanWithRelations = Prisma.OnboardingPlanGetPayload<{ include: typeof planInclude }>;

export type OnboardingAccess =
  | { kind: 'candidate'; plan: PlanWithRelations }
  | { kind: 'staff'; plan: PlanWithRelations; auth: AuthContext };

export type OnboardingAccessError = { status: number; code: string; message: string };

export async function resolveOnboardingAccess(
  routeParam: string,
  token: string | null,
  auth: AuthContext | null,
): Promise<OnboardingAccess | OnboardingAccessError> {
  if (token) {
    const plan = await prisma.onboardingPlan.findUnique({
      where: { accessToken: token },
      include: planInclude,
    });
    // The param must belong to the same plan the token unlocks.
    if (!plan || (routeParam !== token && routeParam !== plan.application.candidate.id)) {
      return { status: 404, code: 'PLAN_NOT_FOUND', message: 'This onboarding link is invalid or has been revoked.' };
    }
    return { kind: 'candidate', plan };
  }

  if (!auth) {
    return { status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required.' };
  }

  const plan = await prisma.onboardingPlan.findFirst({
    where: { application: { candidateId: routeParam } },
    orderBy: { createdAt: 'desc' },
    include: planInclude,
  });
  if (!plan) {
    return { status: 404, code: 'PLAN_NOT_FOUND', message: 'No onboarding plan exists for this candidate.' };
  }
  return { kind: 'staff', plan, auth };
}

export function isAccessError(value: OnboardingAccess | OnboardingAccessError): value is OnboardingAccessError {
  return 'status' in value;
}

/** progressPercent = completed tasks / all tasks. */
export async function recomputeProgress(planId: string): Promise<number> {
  const [total, completed] = await Promise.all([
    prisma.onboardingTask.count({ where: { planId } }),
    prisma.onboardingTask.count({ where: { planId, status: 'COMPLETED' } }),
  ]);
  const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);
  await prisma.onboardingPlan.update({ where: { id: planId }, data: { progressPercent } });
  return progressPercent;
}

export function toPlanDto(plan: PlanWithRelations, access: 'candidate' | 'staff') {
  return {
    planId: plan.id,
    candidateId: plan.application.candidate.id,
    candidateName: `${plan.application.candidate.firstName} ${plan.application.candidate.lastName}`,
    jobTitle: plan.application.job.title,
    jobLocation: plan.application.job.location,
    startDate: plan.startDate.toISOString(),
    checklistTemplate: plan.checklistTemplate,
    progressPercent: plan.progressPercent,
    tasks: plan.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      category: task.category,
      status: task.status,
      requiresDocument: task.requiresDocument,
      dueDate: task.dueDate.toISOString(),
      docRef: task.docRef,
      completedAt: task.completedAt?.toISOString() ?? null,
      // Task owners are internal staff — not shown on the candidate link.
      owner: access === 'staff' ? task.owner : undefined,
    })),
    documents: plan.documents.map((document) => ({
      id: document.id,
      name: document.name,
      status: document.status,
      uploadedAt: document.uploadedAt.toISOString(),
      taskId: document.taskId,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      fileRef: access === 'staff' ? document.fileRef : undefined,
    })),
  };
}
