/**
 * PATCH /api/jobs/[id] — edit a job's core fields and/or move it through
 * its status lifecycle (DRAFT → PENDING_APPROVAL → PUBLISHED → CLOSED),
 * setting publishedAt/closedAt on the way. HR admin / recruiter only
 * (middleware); every change writes an audit entry.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok, toJobDto, JOB_STATUSES, type JobStatus } from '@/lib/types';

export const runtime = 'nodejs';

const jobInclude = { _count: { select: { applications: true } } } satisfies Prisma.JobInclude;

/**
 * Forward-only lifecycle. DRAFT may publish directly (matching POST
 * /api/jobs, which can create a job already PUBLISHED), and any pre-closed
 * status may close.
 */
const STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'PUBLISHED', 'CLOSED'],
  PENDING_APPROVAL: ['PUBLISHED', 'CLOSED'],
  PUBLISHED: ['CLOSED'],
  CLOSED: [],
};

const updateJobSchema = z
  .object({
    title: z.string().min(3).max(120).optional(),
    description: z.string().min(10).optional(),
    location: z.string().min(2).max(120).optional(),
    mustHaveSkills: z.array(z.string().trim().min(1)).min(1).optional(),
    niceToHaveSkills: z.array(z.string().trim().min(1)).optional(),
    minExperienceYears: z.number().int().min(0).max(50).optional(),
    compBandMin: z.number().positive().optional(),
    compBandMax: z.number().positive().optional(),
    compBandCurrency: z.string().length(3).toUpperCase().optional(),
    status: z.enum(JOB_STATUSES).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update.',
  });

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
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

    const parsed = updateJobSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid job update payload.', parsed.error.flatten().fieldErrors);
    }
    const updates = parsed.data;

    const job = await prisma.job.findUnique({ where: { id: params.id } });
    if (!job) {
      return fail(404, 'JOB_NOT_FOUND', 'No job exists with this id.');
    }

    // Closed requisitions are read-only history.
    if (job.status === 'CLOSED') {
      return fail(422, 'JOB_CLOSED', 'A closed job can no longer be edited.');
    }

    const nextMin = updates.compBandMin ?? Number(job.compBandMin);
    const nextMax = updates.compBandMax ?? Number(job.compBandMax);
    if (nextMax < nextMin) {
      return fail(400, 'VALIDATION_ERROR', 'compBandMax must be greater than or equal to compBandMin.');
    }

    const statusChange = updates.status !== undefined && updates.status !== job.status;
    if (statusChange && !STATUS_TRANSITIONS[job.status].includes(updates.status as JobStatus)) {
      return fail(
        422,
        'INVALID_TRANSITION',
        `Cannot move a job from ${job.status} to ${updates.status}. Allowed: ${
          STATUS_TRANSITIONS[job.status].join(', ') || 'none'
        }.`,
      );
    }

    const data: Prisma.JobUpdateInput = {};
    if (updates.title !== undefined) data.title = updates.title;
    if (updates.description !== undefined) data.description = updates.description;
    if (updates.location !== undefined) data.location = updates.location;
    if (updates.mustHaveSkills !== undefined) data.mustHaveSkills = updates.mustHaveSkills;
    if (updates.niceToHaveSkills !== undefined) data.niceToHaveSkills = updates.niceToHaveSkills;
    if (updates.minExperienceYears !== undefined) data.minExperienceYears = updates.minExperienceYears;
    if (updates.compBandMin !== undefined) data.compBandMin = updates.compBandMin;
    if (updates.compBandMax !== undefined) data.compBandMax = updates.compBandMax;
    if (updates.compBandCurrency !== undefined) data.compBandCurrency = updates.compBandCurrency;
    if (statusChange) {
      data.status = updates.status;
      if (updates.status === 'PUBLISHED' && !job.publishedAt) data.publishedAt = new Date();
      if (updates.status === 'CLOSED') data.closedAt = new Date();
    }

    const changedFields = Object.keys(data);
    const updated = await prisma.job.update({
      where: { id: job.id },
      data,
      include: jobInclude,
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: statusChange ? `job.status_changed` : 'job.updated',
        entityType: 'Job',
        entityId: job.id,
        detail: {
          changedFields,
          ...(statusChange ? { from: job.status, to: updates.status } : {}),
        },
      },
    });

    return ok(toJobDto(updated));
  } catch (error) {
    console.error('PATCH /api/jobs/[id] failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
