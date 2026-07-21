/**
 * Shared fixtures for integration tests. These tests run against the
 * DISPOSABLE database in DATABASE_URL (tests/setup.ts defaults to
 * hr_portal_test locally; CI provides a service container) — resetDb()
 * truncates everything.
 */

import PDFDocument from 'pdfkit';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CTX_HEADERS, type StaffRole } from '@/lib/auth';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** Deletes all rows, children before parents. */
export async function resetDb(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.webhookEvent.deleteMany();
  await prisma.backgroundCheck.deleteMany();
  await prisma.onboardingDocument.deleteMany();
  await prisma.onboardingTask.deleteMany();
  await prisma.onboardingPlan.deleteMany();
  await prisma.offerApproval.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.scorecard.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.candidateScore.deleteMany();
  await prisma.parseResult.deleteMany();
  await prisma.cVDocument.deleteMany();
  await prisma.application.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.jobBoardPosting.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
}

export async function createUser(role: StaffRole, name: string): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@test.example`;
  const user = await prisma.user.create({
    data: {
      email,
      // Not used for login in these tests — handlers trust x-user-* headers.
      passwordHash: 'x'.repeat(60),
      name,
      role,
      department: 'Testing',
    },
  });
  return { id: user.id, email: user.email, name: user.name, role };
}

/** The identity headers middleware would inject for this user. */
export function authHeaders(user: TestUser): Record<string, string> {
  return {
    [CTX_HEADERS.userId]: user.id,
    [CTX_HEADERS.email]: encodeURIComponent(user.email),
    [CTX_HEADERS.name]: encodeURIComponent(user.name),
    [CTX_HEADERS.role]: user.role,
  };
}

export function jsonRequest(
  url: string,
  options: { method?: string; body?: unknown; user?: TestUser; headers?: Record<string, string> } = {},
): NextRequest {
  const headers: Record<string, string> = { ...(options.user ? authHeaders(options.user) : {}), ...options.headers };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return new NextRequest(`http://localhost:3000${url}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body,
  });
}

export function formRequest(url: string, form: FormData, user: TestUser): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: authHeaders(user),
    body: form,
  });
}

/** Renders plain text into a real PDF the parser can read. */
export function makePdf(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(11).text(text);
    doc.end();
  });
}

export async function readJson(response: Response): Promise<any> {
  return response.json();
}

export function futureIso(daysFromNow: number, hour = 10): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** Polls until the predicate returns a truthy value or times out. */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
