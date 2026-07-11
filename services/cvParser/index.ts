/**
 * CV parsing + ATS scoring service (Phase 2).
 *
 * Orchestrates the pipeline for one application:
 *   read stored CV -> extract text (pdf/docx) -> extract fields ->
 *   score against the job's requirement tags -> persist ParseResult,
 *   CandidateScore, Application.score, and an audit entry atomically.
 *
 * Deterministic by design (spec section 3): same CV bytes + same job
 * requirements => same score. Re-parsing upserts rather than duplicating,
 * so the endpoint is idempotent. Scoring is decision-support only — stage
 * changes stay human-recorded (GDPR Art. 22 / EU AI Act oversight).
 */

import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readStoredFile, StorageError } from '@/lib/storage';
import { extractFields, type ExtractedFields } from './fieldExtractor';
import { scoreApplication, type RankedSkill, type ScoreBreakdown } from './atsScorer';

export const PARSER_VERSION = 'internal-ats-2.0.0';

export type ParseErrorCode =
  | 'APPLICATION_NOT_FOUND'
  | 'KNOCKOUT_EXCLUDED'
  | 'NO_CV_DOCUMENT'
  | 'CV_FILE_MISSING'
  | 'UNSUPPORTED_FORMAT'
  | 'PARSE_FAILED';

export class ParseServiceError extends Error {
  constructor(
    public readonly code: ParseErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ParseServiceError';
  }
}

export interface ParseAndScoreResult {
  applicationId: string;
  candidateId: string;
  jobId: string;
  cvDocument: { id: string; fileRef: string; version: number };
  extractedFields: ExtractedFields;
  totalScore: number;
  breakdown: ScoreBreakdown;
  rankedSkills: RankedSkill[];
  parserVersion: string;
}

async function extractText(buffer: Buffer, fileRef: string): Promise<string> {
  const lower = fileRef.toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      const parser = new PDFParse({ data: buffer });
      try {
        const result = await parser.getText();
        return result.text;
      } finally {
        await parser.destroy();
      }
    }
    if (lower.endsWith('.docx')) {
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
  } catch (error) {
    throw new ParseServiceError(
      'PARSE_FAILED',
      422,
      `Could not extract text from ${fileRef.split('/').pop()}: the file appears corrupt or unreadable.`,
    );
  }
  throw new ParseServiceError(
    'UNSUPPORTED_FORMAT',
    415,
    'Only PDF and DOCX CVs can be parsed. Legacy .doc files must be re-uploaded as PDF or DOCX.',
  );
}

/**
 * Parses and scores the latest CV for the (candidate, job) application,
 * persisting all results. Triggered by an actor (for the audit trail).
 */
export async function parseAndScoreApplication(
  candidateId: string,
  jobId: string,
  actorUserId: string,
): Promise<ParseAndScoreResult> {
  const application = await prisma.application.findUnique({
    where: { candidateId_jobId: { candidateId, jobId } },
    include: {
      candidate: true,
      job: true,
      cvDocuments: { orderBy: { version: 'desc' }, take: 1 },
    },
  });

  if (!application) {
    throw new ParseServiceError(
      'APPLICATION_NOT_FOUND',
      404,
      'No application exists for this candidate and job. Upload a CV for the job first.',
    );
  }

  // Failed knockouts are excluded before scoring (spec section 3).
  if (application.stage === 'KNOCKOUT_FAILED') {
    throw new ParseServiceError(
      'KNOCKOUT_EXCLUDED',
      422,
      'This application failed a knockout question and is excluded from scoring.',
    );
  }

  const cvDocument = application.cvDocuments[0];
  if (!cvDocument) {
    throw new ParseServiceError('NO_CV_DOCUMENT', 404, 'No CV has been uploaded for this application.');
  }

  let buffer: Buffer;
  try {
    buffer = await readStoredFile(cvDocument.fileRef);
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ParseServiceError('CV_FILE_MISSING', 404, error.message);
    }
    throw error;
  }

  const text = await extractText(buffer, cvDocument.fileRef);
  if (text.trim().length === 0) {
    throw new ParseServiceError(
      'PARSE_FAILED',
      422,
      'The CV contains no extractable text (it may be a scanned image).',
    );
  }

  const extractedFields = extractFields(text, [
    ...application.job.mustHaveSkills,
    ...application.job.niceToHaveSkills,
  ]);

  const { totalScore, breakdown, rankedSkills } = scoreApplication({
    extractedSkills: extractedFields.skills,
    mustHaveSkills: application.job.mustHaveSkills,
    niceToHaveSkills: application.job.niceToHaveSkills,
    experienceYears: extractedFields.experienceYears,
    minExperienceYears: application.job.minExperienceYears,
    candidateLocation: extractedFields.location ?? application.candidate.location,
    jobLocation: application.job.location,
  });

  const extractedFieldsJson = extractedFields as unknown as Prisma.InputJsonValue;
  const breakdownJson = breakdown as unknown as Prisma.InputJsonValue;
  const rankedSkillsJson = rankedSkills as unknown as Prisma.InputJsonValue;

  const scoreRow = {
    totalScore,
    mustHavePoints: breakdown.mustHave.points,
    niceToHavePoints: breakdown.niceToHave.points,
    experiencePoints: breakdown.experience.points,
    locationPoints: breakdown.location.points,
    capApplied: breakdown.capApplied,
    matchedMustHave: breakdown.mustHave.matched,
    missingMustHave: breakdown.mustHave.missing,
    matchedNiceToHave: breakdown.niceToHave.matched,
    rankedSkills: rankedSkillsJson,
    cvDocumentVersion: cvDocument.version,
    parserVersion: PARSER_VERSION,
  };

  await prisma.$transaction([
    prisma.parseResult.upsert({
      where: { applicationId: application.id },
      create: {
        applicationId: application.id,
        extractedFields: extractedFieldsJson,
        scoreBreakdown: breakdownJson,
        parserVersion: PARSER_VERSION,
      },
      update: {
        extractedFields: extractedFieldsJson,
        scoreBreakdown: breakdownJson,
        parserVersion: PARSER_VERSION,
        parsedAt: new Date(),
      },
    }),
    prisma.candidateScore.upsert({
      where: { applicationId: application.id },
      create: { applicationId: application.id, ...scoreRow },
      update: scoreRow,
    }),
    prisma.application.update({
      where: { id: application.id },
      data: { score: totalScore },
    }),
    prisma.auditLog.create({
      data: {
        actorId: actorUserId,
        action: 'application.parsed_and_scored',
        entityType: 'Application',
        entityId: application.id,
        detail: {
          totalScore,
          capApplied: breakdown.capApplied,
          cvDocumentVersion: cvDocument.version,
          parserVersion: PARSER_VERSION,
          decisionSupport: 'Score is advisory only; stage decisions are recorded by a human.',
        },
      },
    }),
  ]);

  return {
    applicationId: application.id,
    candidateId,
    jobId,
    cvDocument: { id: cvDocument.id, fileRef: cvDocument.fileRef, version: cvDocument.version },
    extractedFields,
    totalScore,
    breakdown,
    rankedSkills,
    parserVersion: PARSER_VERSION,
  };
}
