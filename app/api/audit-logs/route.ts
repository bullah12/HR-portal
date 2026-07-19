/**
 * GET /api/audit-logs — paginated view of the append-only audit log for
 * DPO_AUDITOR and HR_ADMIN (enforced in middleware). Filters: entityType,
 * actorId, from/to date range. Read-only: there is deliberately no write
 * surface here — entries are only ever created by the actions themselves.
 */

import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const params = request.nextUrl.searchParams;

    const page = Number(params.get('page') ?? '1');
    const pageSize = Number(params.get('pageSize') ?? '25');
    if (!Number.isInteger(page) || page < 1) {
      return fail(400, 'VALIDATION_ERROR', 'page must be a positive integer.');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      return fail(400, 'VALIDATION_ERROR', `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`);
    }

    const where: Prisma.AuditLogWhereInput = {};
    const entityType = params.get('entityType');
    if (entityType) where.entityType = entityType;
    const actorId = params.get('actorId');
    if (actorId) where.actorId = actorId === 'system' ? null : actorId;

    const from = params.get('from');
    const to = params.get('to');
    const timestamp: Prisma.DateTimeFilter = {};
    if (from) {
      const parsed = new Date(from);
      if (Number.isNaN(parsed.getTime())) {
        return fail(400, 'VALIDATION_ERROR', 'from must be an ISO date.');
      }
      timestamp.gte = parsed;
    }
    if (to) {
      const parsed = new Date(to);
      if (Number.isNaN(parsed.getTime())) {
        return fail(400, 'VALIDATION_ERROR', 'to must be an ISO date.');
      }
      timestamp.lte = parsed;
    }
    if (timestamp.gte || timestamp.lte) where.timestamp = timestamp;

    const [total, entries, entityTypes] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, role: true } } },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.findMany({
        distinct: ['entityType'],
        select: { entityType: true },
        orderBy: { entityType: 'asc' },
      }),
    ]);

    return ok({
      entries: entries.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: entry.detail,
        timestamp: entry.timestamp.toISOString(),
        actor: entry.actor,
      })),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      entityTypes: entityTypes.map((row) => row.entityType),
    });
  } catch (error) {
    console.error('GET /api/audit-logs failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
