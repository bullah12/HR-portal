/**
 * The full pipeline happy path against a disposable Postgres, driving the
 * real route handlers with the identity headers middleware would inject:
 * application → CV upload → parse/score → interview → scorecard → offer →
 * sequential approvals (incl. out-of-order rejection) → candidate accept
 * via token → HIRED + onboarding plan + competing applications closed +
 * audit entries. All integrations run in local dev mode.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST as createJob } from '@/app/api/jobs/route';
import { POST as createCandidate } from '@/app/api/candidates/route';
import { POST as uploadCv } from '@/app/api/candidates/upload/route';
import { POST as parseCv } from '@/app/api/candidates/[id]/parse/route';
import { POST as createInterview } from '@/app/api/interviews/route';
import { POST as submitScorecard } from '@/app/api/interviews/[id]/scorecards/route';
import { POST as createOffer } from '@/app/api/offers/route';
import { POST as decideApproval } from '@/app/api/offers/[id]/approvals/route';
import { POST as acceptOffer } from '@/app/api/offers/[id]/accept/route';
import {
  createUser,
  formRequest,
  futureIso,
  jsonRequest,
  makePdf,
  readJson,
  resetDb,
  type TestUser,
} from './helpers';

const CV_TEXT = `
Ana Silva
Berlin, Germany
ana.silva@mail.example
+49 151 1234 5678

Backend engineer with 6 years experience. Skilled in TypeScript, Node.js,
PostgreSQL and Docker.

Experience
Engineer, Datenwerk GmbH — 2019 - present

Education
BSc Computer Science, TU Berlin
`;

let recruiter: TestUser;
let hiringManager: TestUser;
let finance: TestUser;
let jobId: string;
let candidateId: string;
let applicationId: string;
let interviewId: string;
let offerId: string;
let offerToken: string;
let competingApplicationId: string;

beforeAll(async () => {
  await resetDb();
  recruiter = await createUser('RECRUITER', 'Test Recruiter');
  hiringManager = await createUser('HIRING_MANAGER', 'Test Manager');
  finance = await createUser('FINANCE_APPROVER', 'Test Finance');
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('recruitment pipeline happy path', () => {
  it('creates a published job', async () => {
    const response = await createJob(
      jsonRequest('/api/jobs', {
        user: recruiter,
        body: {
          title: 'Backend Engineer (Test)',
          description: 'Build the test pipeline services.',
          location: 'Berlin, Germany',
          mustHaveSkills: ['TypeScript', 'Node.js'],
          niceToHaveSkills: ['Docker'],
          minExperienceYears: 3,
          compBandMin: 60000,
          compBandMax: 90000,
          status: 'PUBLISHED',
        },
      }),
    );
    expect(response.status).toBe(201);
    jobId = (await readJson(response)).data.id;
  });

  it('creates a candidate with processing consent', async () => {
    const response = await createCandidate(
      jsonRequest('/api/candidates', {
        user: recruiter,
        body: {
          firstName: 'Ana',
          lastName: 'Silva',
          email: 'ana.silva@mail.example',
          location: 'Berlin, Germany',
          source: 'CAREERS_PAGE',
          consent: { processingAccepted: true },
        },
      }),
    );
    expect(response.status).toBe(201);
    candidateId = (await readJson(response)).data.id;
  });

  it('uploads a CV, creating the application', async () => {
    const pdf = await makePdf(CV_TEXT);
    const form = new FormData();
    form.set('file', new File([new Uint8Array(pdf)], 'ana-silva.pdf', { type: 'application/pdf' }));
    form.set('candidateId', candidateId);
    form.set('jobId', jobId);

    const response = await uploadCv(formRequest('/api/candidates/upload', form, recruiter));
    expect(response.status).toBe(201);
    const { data } = await readJson(response);
    applicationId = data.applicationId;
    expect(data.applicationStage).toBe('APPLIED');
    expect(data.document.version).toBe(1);
  });

  it('parses and scores the CV deterministically (idempotent re-parse)', async () => {
    const first = await parseCv(
      jsonRequest(`/api/candidates/${candidateId}/parse`, { user: recruiter, body: { jobId } }),
      { params: { id: candidateId } },
    );
    expect(first.status).toBe(200);
    const firstData = (await readJson(first)).data;
    // All must-haves present (TypeScript, Node.js) — no cap.
    expect(firstData.breakdown.capApplied).toBe(false);
    expect(firstData.totalScore).toBeGreaterThan(40);

    const second = await parseCv(
      jsonRequest(`/api/candidates/${candidateId}/parse`, { user: recruiter, body: { jobId } }),
      { params: { id: candidateId } },
    );
    const secondData = (await readJson(second)).data;
    expect(secondData.totalScore).toBe(firstData.totalScore);
    expect(secondData.breakdown).toEqual(firstData.breakdown);

    const scores = await prisma.candidateScore.findMany({ where: { applicationId } });
    expect(scores).toHaveLength(1); // upserted, not duplicated
    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(application.score).toBe(firstData.totalScore);
  });

  it('excludes knockout-failed applications from scoring', async () => {
    const other = await prisma.candidate.create({
      data: {
        firstName: 'Knock',
        lastName: 'Out',
        email: 'knock.out@mail.example',
        source: 'JOB_BOARD',
        consentStatus: 'GRANTED',
      },
    });
    await prisma.application.create({
      data: { candidateId: other.id, jobId, stage: 'KNOCKOUT_FAILED' },
    });
    const response = await parseCv(
      jsonRequest(`/api/candidates/${other.id}/parse`, { user: recruiter, body: { jobId } }),
      { params: { id: other.id } },
    );
    expect(response.status).toBe(422);
    expect((await readJson(response)).error.code).toBe('KNOCKOUT_EXCLUDED');
  });

  it('schedules an interview (local calendar provider) and advances the stage', async () => {
    const response = await createInterview(
      jsonRequest('/api/interviews', {
        user: recruiter,
        body: {
          candidateId,
          jobId,
          type: 'TECHNICAL',
          slotStart: futureIso(7, 10),
          slotEnd: futureIso(7, 11),
          panelistIds: [hiringManager.id],
        },
      }),
    );
    expect(response.status).toBe(201);
    const { data } = await readJson(response);
    interviewId = data.interview.id;
    expect(data.calendar.provider).toBe('local');
    expect(data.emailDelivery.mode).toBe('local');

    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(application.stage).toBe('INTERVIEW');
  });

  it('detects panel conflicts on overlapping slots', async () => {
    const response = await createInterview(
      jsonRequest('/api/interviews', {
        user: recruiter,
        body: {
          candidateId,
          jobId,
          type: 'FINAL',
          slotStart: futureIso(7, 10),
          slotEnd: futureIso(7, 11),
          panelistIds: [hiringManager.id],
        },
      }),
    );
    expect(response.status).toBe(409);
    expect((await readJson(response)).error.code).toBe('PANEL_CONFLICT');
  });

  it('accepts the panelist scorecard and rejects a duplicate', async () => {
    const response = await submitScorecard(
      jsonRequest(`/api/interviews/${interviewId}/scorecards`, {
        user: hiringManager,
        body: {
          ratings: { technical_depth: 5, communication: 4 },
          recommendation: 'STRONG_YES',
          notes: 'Excellent.',
        },
      }),
      { params: { id: interviewId } },
    );
    expect(response.status).toBe(201);

    const duplicate = await submitScorecard(
      jsonRequest(`/api/interviews/${interviewId}/scorecards`, {
        user: hiringManager,
        body: { ratings: { x: 3 }, recommendation: 'YES' },
      }),
      { params: { id: interviewId } },
    );
    expect(duplicate.status).toBe(409);
  });

  it('rejects a scorecard from a non-panelist', async () => {
    const response = await submitScorecard(
      jsonRequest(`/api/interviews/${interviewId}/scorecards`, {
        user: finance,
        body: { ratings: { x: 3 }, recommendation: 'YES' },
      }),
      { params: { id: interviewId } },
    );
    expect(response.status).toBe(403);
  });

  it('creates an offer inside the comp band with a two-step approval chain', async () => {
    const outOfBand = await createOffer(
      jsonRequest('/api/offers', {
        user: recruiter,
        body: { candidateId, jobId, baseSalary: 120000, startDate: futureIso(45) },
      }),
    );
    expect(outOfBand.status).toBe(422);
    expect((await readJson(outOfBand)).error.code).toBe('COMP_OUT_OF_BAND');

    const response = await createOffer(
      jsonRequest('/api/offers', {
        user: recruiter,
        body: {
          candidateId,
          jobId,
          baseSalary: 75000,
          startDate: futureIso(45),
          approverIds: [hiringManager.id, finance.id],
        },
      }),
    );
    expect(response.status).toBe(201);
    offerId = (await readJson(response)).data.id;

    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      include: { approvals: { orderBy: { sequence: 'asc' } } },
    });
    expect(offer.approvalState).toBe('PENDING_APPROVAL');
    expect(offer.approvals.map((approval) => approval.approverId)).toEqual([hiringManager.id, finance.id]);
    offerToken = offer.accessToken;
  });

  it('rejects out-of-order approval, then approves in sequence', async () => {
    const outOfOrder = await decideApproval(
      jsonRequest(`/api/offers/${offerId}/approvals`, { user: finance, body: { decision: 'APPROVED' } }),
      { params: { id: offerId } },
    );
    expect(outOfOrder.status).toBe(409);
    expect((await readJson(outOfOrder)).error.code).toBe('OUT_OF_SEQUENCE');

    const first = await decideApproval(
      jsonRequest(`/api/offers/${offerId}/approvals`, { user: hiringManager, body: { decision: 'APPROVED' } }),
      { params: { id: offerId } },
    );
    expect(first.status).toBe(200);

    const second = await decideApproval(
      jsonRequest(`/api/offers/${offerId}/approvals`, { user: finance, body: { decision: 'APPROVED' } }),
      { params: { id: offerId } },
    );
    expect(second.status).toBe(200);

    const offer = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
    expect(offer.approvalState).toBe('APPROVED');
  });

  it('lets the candidate accept via token: HIRED, onboarding plan, competitors closed', async () => {
    const competitor = await prisma.candidate.create({
      data: {
        firstName: 'Rival',
        lastName: 'Runnerup',
        email: 'rival.runnerup@mail.example',
        source: 'REFERRAL',
        consentStatus: 'GRANTED',
      },
    });
    competingApplicationId = (
      await prisma.application.create({ data: { candidateId: competitor.id, jobId, stage: 'SCREENING' } })
    ).id;

    const wrongToken = await acceptOffer(
      jsonRequest(`/api/offers/${offerId}/accept`, { body: { token: 'wrong', decision: 'ACCEPTED' } }),
      { params: { id: offerId } },
    );
    expect(wrongToken.status).toBe(404);

    const response = await acceptOffer(
      jsonRequest(`/api/offers/${offerId}/accept`, { body: { token: offerToken, decision: 'ACCEPTED' } }),
      { params: { id: offerId } },
    );
    expect(response.status).toBe(200);
    const { data } = await readJson(response);
    expect(data.decision).toBe('ACCEPTED');
    expect(data.applicationStage).toBe('HIRED');
    expect(data.onboardingToken).toBeTruthy();
    expect(data.closedOutApplications).toBe(1);

    const application = await prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    expect(application.stage).toBe('HIRED');

    const plan = await prisma.onboardingPlan.findUniqueOrThrow({
      where: { applicationId },
      include: { tasks: true },
    });
    expect(plan.checklistTemplate).toBe('standard-onboarding-v1');
    expect(plan.tasks.length).toBe(6);
    expect(plan.tasks.some((task) => task.title === 'Sign employment contract')).toBe(true);

    const competing = await prisma.application.findUniqueOrThrow({ where: { id: competingApplicationId } });
    expect(competing.stage).toBe('REJECTED');
    expect(competing.rejectionReason).toContain('Position filled');
  });

  it('wrote audit entries for every pipeline step', async () => {
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((entry) => entry.action);
    for (const expected of [
      'job.created',
      'candidate.created',
      'cv_document.uploaded',
      'application.parsed_and_scored',
      'interview.scheduled',
      'scorecard.submitted',
      'offer.created',
      'offer.approval_decided',
      'offer.accepted_by_candidate',
    ]) {
      expect(actions, `expected audit action ${expected}`).toContain(expected);
    }
  });
});
