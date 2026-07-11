/**
 * POST /api/candidates/[id]/background-check — order a background check
 * with the provider (Zinc) for the candidate's application to a job.
 * Body: { "jobId": "...", "package": "right-to-work" }.
 * Results arrive later via /api/webhooks/backgroundCheck.
 */

import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { BackgroundCheckFlowError, startBackgroundCheck } from '@/lib/integrations/backgroundCheck';
import { IntegrationError } from '@/lib/integrations/http';

export const runtime = 'nodejs';

const bodySchema = z.object({
  jobId: z.string().min(1),
  package: z.string().min(1).default('right-to-work'),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid background check payload.', parsed.error.flatten().fieldErrors);
    }

    const check = await startBackgroundCheck(params.id, parsed.data.jobId, parsed.data.package, auth.userId);
    return ok(check, 201);
  } catch (error) {
    if (error instanceof BackgroundCheckFlowError) {
      return fail(error.status, error.code, error.message);
    }
    if (error instanceof IntegrationError) {
      return fail(502, 'PROVIDER_ERROR', error.message);
    }
    console.error('POST /api/candidates/[id]/background-check failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
