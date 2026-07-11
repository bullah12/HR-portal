/**
 * /api/onboarding/[candidateId]/documents
 *  - GET:  document metadata list (name, status, uploadedAt).
 *  - POST: multipart upload of an onboarding document (employee data form,
 *          tax forms, NDA, …). Public with ?token=<plan.accessToken> so the
 *          candidate can upload from their link; also available to staff.
 *          Linking a `taskId` marks that checklist task COMPLETED and
 *          recomputes progress.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok } from '@/lib/types';
import { isAccessError, recomputeProgress, resolveOnboardingAccess, toPlanDto } from '@/lib/onboarding';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

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
    return ok(toPlanDto(access.plan, access.kind).documents);
  } catch (error) {
    console.error('GET /api/onboarding/[candidateId]/documents failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}

const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  taskId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest, { params }: { params: { candidateId: string } }) {
  try {
    const access = await resolveOnboardingAccess(
      params.candidateId,
      request.nextUrl.searchParams.get('token'),
      getAuthContext(request),
    );
    if (isAccessError(access)) {
      return fail(access.status, access.code, access.message);
    }
    const { plan } = access;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'INVALID_FORM_DATA', 'Request body must be multipart/form-data.');
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, 'VALIDATION_ERROR', 'A non-empty "file" form field is required.');
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(413, 'FILE_TOO_LARGE', 'Documents must be at most 10 MB.');
    }
    const extension = ALLOWED_MIME_TYPES[file.type];
    if (!extension) {
      return fail(415, 'UNSUPPORTED_FILE_TYPE', 'Documents must be PDF, Word, PNG, or JPEG.');
    }

    const parsed = fieldsSchema.safeParse({
      name: form.get('name') ?? file.name,
      taskId: form.get('taskId') ?? undefined,
    });
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'Invalid document fields.', parsed.error.flatten().fieldErrors);
    }

    const task = parsed.data.taskId ? plan.tasks.find((entry) => entry.id === parsed.data.taskId) : null;
    if (parsed.data.taskId && !task) {
      return fail(404, 'TASK_NOT_FOUND', 'taskId does not belong to this onboarding plan.');
    }

    const uploadDir = process.env.ONBOARDING_UPLOAD_DIR ?? 'uploads/onboarding';
    const sequence = (await prisma.onboardingDocument.count({ where: { planId: plan.id } })) + 1;
    const fileName = `${plan.id}-doc${sequence}${extension}`;
    const absoluteDir = path.join(process.cwd(), uploadDir);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(path.join(absoluteDir, fileName), Buffer.from(await file.arrayBuffer()));
    const fileRef = path.posix.join(uploadDir.split(path.sep).join('/'), fileName);

    const document = await prisma.onboardingDocument.create({
      data: {
        planId: plan.id,
        taskId: task?.id,
        name: parsed.data.name,
        fileRef,
        mimeType: file.type,
        sizeBytes: file.size,
      },
    });

    let progressPercent = plan.progressPercent;
    if (task) {
      await prisma.onboardingTask.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', completedAt: new Date(), docRef: fileRef },
      });
      progressPercent = await recomputeProgress(plan.id);
    }

    await prisma.auditLog.create({
      data: {
        actorId: access.kind === 'staff' ? access.auth.userId : null,
        action: 'onboarding_document.uploaded',
        entityType: 'OnboardingDocument',
        entityId: document.id,
        detail: {
          planId: plan.id,
          taskId: task?.id ?? null,
          name: parsed.data.name,
          sizeBytes: file.size,
          uploadedBy: access.kind,
        },
      },
    });

    return ok(
      {
        document: {
          id: document.id,
          name: document.name,
          status: document.status,
          uploadedAt: document.uploadedAt.toISOString(),
          taskId: document.taskId,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
        },
        taskCompleted: task ? task.id : null,
        progressPercent,
      },
      201,
    );
  } catch (error) {
    console.error('POST /api/onboarding/[candidateId]/documents failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
