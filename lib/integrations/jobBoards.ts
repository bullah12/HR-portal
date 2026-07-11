/**
 * Job board multiposting via the Broadbean aggregator (spec section 6:
 * "push postings to boards from one place"). Broadbean fans out to
 * LinkedIn, Indeed, StepStone, and custom boards — this module only talks
 * to the aggregator, never to individual boards.
 *
 * Real mode when BROADBEAN_API_URL + BROADBEAN_API_KEY are set; otherwise
 * a deterministic local mode so the flow stays testable in development.
 * Every (job, board) posting is recorded on JobBoardPosting; re-posting a
 * job skips boards that already succeeded (idempotent).
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { fetchWithRetry, IntegrationError } from '@/lib/integrations/http';

export const SUPPORTED_BOARDS = ['linkedin', 'indeed', 'stepstone', 'careers-network'] as const;
export type JobBoard = (typeof SUPPORTED_BOARDS)[number];

export interface BoardPostingResult {
  board: string;
  status: 'POSTED' | 'FAILED' | 'ALREADY_POSTED';
  externalRef: string | null;
  error?: string;
}

export class JobBoardFlowError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'JobBoardFlowError';
  }
}

interface AggregatorJobPayload {
  board: string;
  title: string;
  description: string;
  location: string;
  salaryMin: number;
  salaryMax: number;
  currency: string;
  applyUrl: string;
  reference: string;
}

async function postViaAggregator(payload: AggregatorJobPayload): Promise<string> {
  const baseUrl = process.env.BROADBEAN_API_URL;
  const apiKey = process.env.BROADBEAN_API_KEY;

  if (!baseUrl || !apiKey) {
    // Local development mode — no aggregator credentials configured.
    return `local-${payload.board}-${randomUUID().slice(0, 8)}`;
  }

  const response = await fetchWithRetry('broadbean', `${baseUrl.replace(/\/$/, '')}/postings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new IntegrationError('broadbean', `Posting to ${payload.board} failed with ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }

  const body = (await response.json()) as { postingId?: string };
  if (!body.postingId) {
    throw new IntegrationError('broadbean', `Aggregator response for ${payload.board} did not include a postingId.`);
  }
  return body.postingId;
}

export async function postJobToBoards(
  jobId: string,
  boards: string[],
  actorUserId: string,
): Promise<BoardPostingResult[]> {
  const requestedBoards = [...new Set(boards)];
  const unsupported = requestedBoards.filter(
    (board) => !(SUPPORTED_BOARDS as readonly string[]).includes(board),
  );
  if (requestedBoards.length === 0 || unsupported.length > 0) {
    throw new JobBoardFlowError(
      400,
      'INVALID_BOARDS',
      `boards must be a non-empty subset of: ${SUPPORTED_BOARDS.join(', ')}.`,
    );
  }

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { boardPostings: true },
  });
  if (!job) {
    throw new JobBoardFlowError(404, 'JOB_NOT_FOUND', 'No job exists with this id.');
  }
  if (job.status !== 'PUBLISHED') {
    throw new JobBoardFlowError(422, 'JOB_NOT_PUBLISHED', `Only PUBLISHED jobs can be multiposted (job is ${job.status}).`);
  }

  const appBaseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000';
  const results: BoardPostingResult[] = [];

  for (const board of requestedBoards) {
    const existing = job.boardPostings.find(
      (posting) => posting.board === board && posting.status === 'POSTED',
    );
    if (existing) {
      results.push({ board, status: 'ALREADY_POSTED', externalRef: existing.externalRef });
      continue;
    }

    try {
      const externalRef = await postViaAggregator({
        board,
        title: job.title,
        description: job.description,
        location: job.location,
        salaryMin: Number(job.compBandMin),
        salaryMax: Number(job.compBandMax),
        currency: job.compBandCurrency,
        applyUrl: `${appBaseUrl}/jobs`,
        reference: job.id,
      });
      await prisma.jobBoardPosting.upsert({
        where: { jobId_board: { jobId: job.id, board } },
        create: { jobId: job.id, board, status: 'POSTED', externalRef },
        update: { status: 'POSTED', externalRef, error: null, postedAt: new Date() },
      });
      results.push({ board, status: 'POSTED', externalRef });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.jobBoardPosting.upsert({
        where: { jobId_board: { jobId: job.id, board } },
        create: { jobId: job.id, board, status: 'FAILED', error: message.slice(0, 500) },
        update: { status: 'FAILED', error: message.slice(0, 500), postedAt: new Date() },
      });
      results.push({ board, status: 'FAILED', externalRef: null, error: message });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: actorUserId,
      action: 'job.posted_to_boards',
      entityType: 'Job',
      entityId: job.id,
      detail: {
        results: results.map(({ board, status, externalRef }) => ({ board, status, externalRef })),
        aggregator: process.env.BROADBEAN_API_URL ? 'broadbean' : 'local',
      },
    },
  });

  return results;
}
