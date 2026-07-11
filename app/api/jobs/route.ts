/**
 * /api/jobs
 *  - GET:  list jobs (hiring managers see only their own requisitions).
 *  - POST: create a job posting (HR admin / recruiter — enforced in middleware).
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok, toJobDto, JOB_STATUSES } from '@/lib/types';

export const runtime = 'nodejs';

const jobInclude = { _count: { select: { applications: true } } } satisfies Prisma.JobInclude;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const statusParam = request.nextUrl.searchParams.get('status');
    if (statusParam !== null && !JOB_STATUSES.includes(statusParam as (typeof JOB_STATUSES)[number])) {
      return fail(400, 'VALIDATION_ERROR', `status must be one of: ${JOB_STATUSES.join(', ')}.`);
    }

    const where: Prisma.JobWhereInput = {};
    if (statusParam) {
      where.status = statusParam as (typeof JOB_STATUSES)[number];
    }
    // Spec section 1: hiring managers see their own requisitions only.
    if (auth.role === 'HIRING_MANAGER') {
      where.ownerId = auth.userId;
    }

    const jobs = await prisma.job.findMany({
      where,
      include: jobInclude,
      orderBy: { createdAt: 'desc' },
    });

    return ok(jobs.map(toJobDto));
  } catch (error) {
    console.error('GET /api/jobs failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const createJobSchema = z
  .object({
    title: z.string().min(3).max(120),
    description: z.string().min(10),
    location: z.string().min(2).max(120),
    mustHaveSkills: z.array(z.string().trim().min(1)).min(1),
    niceToHaveSkills: z.array(z.string().trim().min(1)).default([]),
    minExperienceYears: z.number().int().min(0).max(50).default(0),
    compBandMin: z.number().positive(),
    compBandMax: z.number().positive(),
    compBandCurrency: z.string().length(3).toUpperCase().default('EUR'),
    status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED']).default('DRAFT'),
  })
  .refine((data) => data.compBandMax >= data.compBandMin, {
    message: 'compBandMax must be greater than or equal to compBandMin',
    path: ['compBandMax'],
  });

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

    const parsed = createJobSchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid job payload.', parsed.error.flatten().fieldErrors);
    }

    const job = await prisma.job.create({
      data: {
        title: parsed.data.title,
        description: parsed.data.description,
        location: parsed.data.location,
        mustHaveSkills: parsed.data.mustHaveSkills,
        niceToHaveSkills: parsed.data.niceToHaveSkills,
        minExperienceYears: parsed.data.minExperienceYears,
        compBandMin: parsed.data.compBandMin,
        compBandMax: parsed.data.compBandMax,
        compBandCurrency: parsed.data.compBandCurrency,
        status: parsed.data.status,
        publishedAt: parsed.data.status === 'PUBLISHED' ? new Date() : null,
        ownerId: auth.userId,
      },
      include: jobInclude,
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'job.created',
        entityType: 'Job',
        entityId: job.id,
        detail: { title: job.title, status: job.status },
      },
    });

    return ok(toJobDto(job), 201);
  } catch (error) {
    console.error('POST /api/jobs failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
