/**
 * POST /api/jobs/[id]/post-to-boards — multipost a published job via the
 * Broadbean aggregator. Body: { "boards": ["linkedin", "indeed", ...] }
 * (defaults to all supported boards). Recruiter/HR admin only.
 */

import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { JobBoardFlowError, postJobToBoards, SUPPORTED_BOARDS } from '@/lib/integrations/jobBoards';

export const runtime = 'nodejs';

const bodySchema = z.object({
  boards: z.array(z.string().min(1)).min(1).optional(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let body: unknown = {};
    try {
      const text = await request.text();
      body = text.trim().length > 0 ? JSON.parse(text) : {};
    } catch {
      return fail(400, 'INVALID_JSON', 'Request body must be valid JSON.');
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid boards payload.', parsed.error.flatten().fieldErrors);
    }

    const boards = parsed.data.boards ?? [...SUPPORTED_BOARDS];
    const results = await postJobToBoards(params.id, boards, auth.userId);
    const failed = results.filter((result) => result.status === 'FAILED');

    return ok(
      { jobId: params.id, results, allSucceeded: failed.length === 0 },
      failed.length === results.length ? 502 : 200,
    );
  } catch (error) {
    if (error instanceof JobBoardFlowError) {
      return fail(error.status, error.code, error.message);
    }
    console.error('POST /api/jobs/[id]/post-to-boards failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
