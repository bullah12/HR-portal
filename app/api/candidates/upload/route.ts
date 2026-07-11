/**
 * POST /api/candidates/upload — receive a CV file for a candidate + job.
 *
 * Multipart form fields:
 *   - file:        the CV (pdf/doc/docx, max 10 MB)
 *   - candidateId: existing Candidate id
 *   - jobId:       existing Job id
 *
 * Finds or creates the Application for the (candidate, job) pair, writes the
 * file to CV_UPLOAD_DIR (S3 in production — only the path/key is stored on
 * CVDocument.fileRef), and records a new document version. No parsing —
 * that is Phase 2.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getAuthContext } from '@/lib/auth';
import { fail, ok, type CvUploadResponseData } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const fieldsSchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const auth = getAuthContext(request);
    if (!auth) {
      return fail(401, 'UNAUTHENTICATED', 'Authentication required.');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'INVALID_FORM_DATA', 'Request body must be multipart/form-data.');
    }

    const parsed = fieldsSchema.safeParse({
      candidateId: form.get('candidateId'),
      jobId: form.get('jobId'),
    });
    if (!parsed.success) {
      return fail(400, 'VALIDATION_ERROR', 'candidateId and jobId form fields are required.', parsed.error.flatten().fieldErrors);
    }

    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return fail(400, 'VALIDATION_ERROR', 'A non-empty "file" form field is required.');
    }
    if (file.size > MAX_FILE_BYTES) {
      return fail(413, 'FILE_TOO_LARGE', `CV files must be at most ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    }
    const extension = ALLOWED_MIME_TYPES[file.type];
    if (!extension) {
      return fail(415, 'UNSUPPORTED_FILE_TYPE', 'CV must be a PDF or Word document (pdf, doc, docx).');
    }

    const [candidate, job] = await Promise.all([
      prisma.candidate.findUnique({ where: { id: parsed.data.candidateId } }),
      prisma.job.findUnique({ where: { id: parsed.data.jobId } }),
    ]);
    if (!candidate) {
      return fail(404, 'CANDIDATE_NOT_FOUND', 'No candidate exists with the given candidateId.');
    }
    if (!job) {
      return fail(404, 'JOB_NOT_FOUND', 'No job exists with the given jobId.');
    }

    const application = await prisma.application.upsert({
      where: {
        candidateId_jobId: { candidateId: candidate.id, jobId: job.id },
      },
      create: { candidateId: candidate.id, jobId: job.id, stage: 'APPLIED' },
      update: {},
    });

    const latest = await prisma.cVDocument.aggregate({
      where: { applicationId: application.id },
      _max: { version: true },
    });
    const version = (latest._max.version ?? 0) + 1;

    // File name is fully server-generated; the client filename is never used
    // in the path, so no traversal/injection surface.
    const uploadDir = process.env.CV_UPLOAD_DIR ?? 'uploads/cv';
    const fileName = `${application.id}-v${version}${extension}`;
    const absoluteDir = path.join(process.cwd(), uploadDir);
    await mkdir(absoluteDir, { recursive: true });
    await writeFile(path.join(absoluteDir, fileName), Buffer.from(await file.arrayBuffer()));

    const fileRef = path.posix.join(uploadDir.split(path.sep).join('/'), fileName);

    const document = await prisma.cVDocument.create({
      data: {
        applicationId: application.id,
        fileRef,
        version,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: auth.userId,
        action: 'cv_document.uploaded',
        entityType: 'CVDocument',
        entityId: document.id,
        detail: {
          applicationId: application.id,
          version,
          sizeBytes: file.size,
          mimeType: file.type,
        },
      },
    });

    const data: CvUploadResponseData = {
      document: {
        id: document.id,
        fileRef: document.fileRef,
        version: document.version,
        uploadDate: document.uploadDate.toISOString(),
      },
      applicationId: application.id,
      applicationStage: application.stage,
      candidateId: candidate.id,
      jobId: job.id,
    };

    return ok(data, 201);
  } catch (error) {
    console.error('POST /api/candidates/upload failed:', error);
    return fail(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
}
