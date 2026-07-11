/**
 * GET /api/users — staff directory (id, name, role, department) for
 * recruiter tooling such as picking interview panelists and offer
 * approvers. Recruiter/HR admin only (middleware-enforced).
 */

import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    const users = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, department: true },
      orderBy: { name: 'asc' },
    });
    return ok(users);
  } catch (error) {
    console.error('GET /api/users failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
