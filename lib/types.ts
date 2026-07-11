/**
 * Shared request/response types, enum value lists, response helpers, and
 * DTO mappers for the Phase 1 API.
 *
 * Every endpoint responds with the same envelope:
 *   success: { "success": true,  "data": ... }
 *   failure: { "success": false, "error": { "code", "message", "details?" } }
 */

import { NextResponse } from 'next/server';
import type { Candidate, Job } from '@prisma/client';
import type { StaffRole } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: ApiError };

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function fail(status: number, code: string, message: string, details?: unknown): NextResponse {
  const error: ApiError = details === undefined ? { code, message } : { code, message, details };
  return NextResponse.json({ success: false, error }, { status });
}

// ---------------------------------------------------------------------------
// Enum value lists (mirror prisma/schema.prisma; usable in zod schemas and
// query-param validation without importing the Prisma client at runtime)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'CLOSED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CANDIDATE_SOURCES = [
  'CAREERS_PAGE',
  'JOB_BOARD',
  'REFERRAL',
  'AGENCY',
  'DIRECT_SOURCING',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface LoginRequestBody {
  email: string;
  password: string;
}

export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
  department: string;
}

export interface LoginResponseData {
  token: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: AuthUserDto;
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export interface CreateJobRequestBody {
  title: string;
  description: string;
  location: string;
  mustHaveSkills: string[];
  niceToHaveSkills?: string[];
  minExperienceYears?: number;
  compBandMin: number;
  compBandMax: number;
  compBandCurrency?: string;
  status?: Exclude<JobStatus, 'CLOSED'>;
}

export interface JobDto {
  id: string;
  title: string;
  description: string;
  location: string;
  status: JobStatus;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  minExperienceYears: number;
  compBandMin: number;
  compBandMax: number;
  compBandCurrency: string;
  ownerId: string;
  applicationCount: number;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type JobWithCount = Job & { _count: { applications: number } };

export function toJobDto(job: JobWithCount): JobDto {
  return {
    id: job.id,
    title: job.title,
    description: job.description,
    location: job.location,
    status: job.status,
    mustHaveSkills: job.mustHaveSkills,
    niceToHaveSkills: job.niceToHaveSkills,
    minExperienceYears: job.minExperienceYears,
    compBandMin: Number(job.compBandMin),
    compBandMax: Number(job.compBandMax),
    compBandCurrency: job.compBandCurrency,
    ownerId: job.ownerId,
    applicationCount: job._count.applications,
    publishedAt: job.publishedAt?.toISOString() ?? null,
    closedAt: job.closedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface CreateCandidateRequestBody {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
  source: CandidateSource;
  consent: {
    processingAccepted: true;
    talentPoolAccepted?: boolean;
  };
}

export interface CandidateDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  location: string | null;
  source: CandidateSource;
  consentStatus: string;
  maskedInRankingView: boolean;
  applicationCount: number;
  createdAt: string;
  updatedAt: string;
}

type CandidateWithCount = Candidate & { _count: { applications: number } };

export function toCandidateDto(candidate: CandidateWithCount): CandidateDto {
  return {
    id: candidate.id,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    email: candidate.email,
    phone: candidate.phone,
    location: candidate.location,
    source: candidate.source,
    consentStatus: candidate.consentStatus,
    maskedInRankingView: candidate.maskedInRankingView,
    applicationCount: candidate._count.applications,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CV upload
// ---------------------------------------------------------------------------

export interface CvUploadResponseData {
  document: {
    id: string;
    fileRef: string;
    version: number;
    uploadDate: string;
  };
  applicationId: string;
  applicationStage: string;
  candidateId: string;
  jobId: string;
}
