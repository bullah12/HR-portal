/**
 * HR Portal — Phase 1 seed script.
 *
 * Populates a development database with realistic pipeline data:
 * 2 staff users, 3 jobs, 5 candidates, and applications covering every
 * pipeline stage (applied → knockout-failed → shortlisted → interview →
 * hired), including CV documents, parse results, interviews, scorecards,
 * an approved + signed offer, an onboarding plan, consent records, and
 * audit log entries.
 *
 * Run with: npx ts-node prisma/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Development-only credentials for the seeded staff accounts.
const DEMO_PASSWORDS = {
  recruiter: 'Recruit3r!Demo',
  hiringManager: 'Hiring!Demo42',
  dpoAuditor: 'Audit0r!Demo',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

async function resetDatabase(): Promise<void> {
  // Delete in FK-dependency order so the seed is repeatable.
  await prisma.auditLog.deleteMany();
  await prisma.onboardingTask.deleteMany();
  await prisma.onboardingPlan.deleteMany();
  await prisma.offerApproval.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.scorecard.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.parseResult.deleteMany();
  await prisma.cVDocument.deleteMany();
  await prisma.application.deleteMany();
  await prisma.consentRecord.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();
}

async function main(): Promise<void> {
  await resetDatabase();

  // -------------------------------------------------------------------------
  // Users (2)
  // -------------------------------------------------------------------------
  const recruiter = await prisma.user.create({
    data: {
      email: 'sofia.lindqvist@acme-corp.example',
      passwordHash: bcrypt.hashSync(DEMO_PASSWORDS.recruiter, 12),
      name: 'Sofia Lindqvist',
      role: 'RECRUITER',
      department: 'People & Culture',
      calendarLink: 'https://outlook.office365.com/calendar/sofia.lindqvist',
    },
  });

  const hiringManager = await prisma.user.create({
    data: {
      email: 'marcus.weber@acme-corp.example',
      passwordHash: bcrypt.hashSync(DEMO_PASSWORDS.hiringManager, 12),
      name: 'Marcus Weber',
      role: 'HIRING_MANAGER',
      department: 'Engineering',
      calendarLink: 'https://outlook.office365.com/calendar/marcus.weber',
    },
  });

  await prisma.user.create({
    data: {
      email: 'ines.moreau@acme-corp.example',
      passwordHash: bcrypt.hashSync(DEMO_PASSWORDS.dpoAuditor, 12),
      name: 'Inès Moreau',
      role: 'DPO_AUDITOR',
      department: 'Legal & Compliance',
    },
  });

  // -------------------------------------------------------------------------
  // Jobs (3)
  // -------------------------------------------------------------------------
  const backendJob = await prisma.job.create({
    data: {
      title: 'Senior Backend Engineer',
      description:
        'Design and build the services powering our recruitment platform. ' +
        'NestJS/TypeScript stack on AWS, PostgreSQL, event-driven workers.',
      location: 'Berlin, Germany (hybrid)',
      status: 'PUBLISHED',
      mustHaveSkills: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST APIs'],
      niceToHaveSkills: ['NestJS', 'AWS', 'SQS', 'Prisma'],
      minExperienceYears: 5,
      compBandMin: 78000,
      compBandMax: 95000,
      compBandCurrency: 'EUR',
      publishedAt: daysAgo(45),
      ownerId: recruiter.id,
    },
  });

  const frontendJob = await prisma.job.create({
    data: {
      title: 'Frontend Engineer',
      description:
        'Build the candidate-facing careers pages and the internal hiring app. ' +
        'Next.js, React, and a strong eye for accessible UI.',
      location: 'Remote (EU)',
      status: 'PUBLISHED',
      mustHaveSkills: ['React', 'TypeScript', 'CSS'],
      niceToHaveSkills: ['Next.js', 'Testing Library', 'Storybook'],
      minExperienceYears: 3,
      compBandMin: 62000,
      compBandMax: 78000,
      compBandCurrency: 'EUR',
      publishedAt: daysAgo(30),
      ownerId: recruiter.id,
    },
  });

  const hrOpsJob = await prisma.job.create({
    data: {
      title: 'HR Operations Specialist',
      description:
        'Own onboarding logistics, document collection, and HRIS data quality ' +
        'for our growing EU team.',
      location: 'Munich, Germany (on-site)',
      status: 'DRAFT',
      mustHaveSkills: ['HR administration', 'German labour law', 'Excel'],
      niceToHaveSkills: ['Personio', 'DocuSign'],
      minExperienceYears: 2,
      compBandMin: 48000,
      compBandMax: 58000,
      compBandCurrency: 'EUR',
      ownerId: recruiter.id,
    },
  });

  // -------------------------------------------------------------------------
  // Candidate 1 — Elena Petrova: full pipeline, HIRED on the backend role.
  // -------------------------------------------------------------------------
  const elena = await prisma.candidate.create({
    data: {
      firstName: 'Elena',
      lastName: 'Petrova',
      email: 'elena.petrova@mail.example',
      phone: '+359 88 123 4567',
      location: 'Berlin, Germany',
      source: 'CAREERS_PAGE',
      consentStatus: 'GRANTED',
      maskedInRankingView: true,
      consentRecords: {
        create: [
          {
            purpose: 'APPLICATION_PROCESSING',
            grantedAt: daysAgo(40),
            expiresAt: daysFromNow(325),
          },
          {
            purpose: 'TALENT_POOL',
            grantedAt: daysAgo(40),
            expiresAt: daysFromNow(690),
          },
        ],
      },
    },
  });

  const elenaApplication = await prisma.application.create({
    data: {
      candidateId: elena.id,
      jobId: backendJob.id,
      stage: 'HIRED',
      score: 88,
      knockoutResults: {
        'work_eligibility_eu': { answer: 'yes', passed: true },
        'notice_period_within_3_months': { answer: 'yes', passed: true },
      },
      appliedAt: daysAgo(40),
      cvDocuments: {
        create: [
          {
            fileRef: 'cv-uploads/2026/06/elena-petrova-v1.pdf',
            version: 1,
            uploadDate: daysAgo(40),
          },
          {
            fileRef: 'cv-uploads/2026/06/elena-petrova-v2.pdf',
            version: 2,
            uploadDate: daysAgo(38),
          },
        ],
      },
      parseResult: {
        create: {
          parserVersion: 'textkernel-extract-4.2.1',
          extractedFields: {
            workHistory: [
              {
                title: 'Backend Engineer',
                employer: 'Fintech Labs GmbH',
                from: '2021-03',
                to: '2026-05',
              },
              {
                title: 'Software Developer',
                employer: 'Sofia Digital OOD',
                from: '2017-09',
                to: '2021-02',
              },
            ],
            education: [
              { degree: 'BSc Computer Science', institution: 'Sofia University', year: 2017 },
            ],
            skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST APIs', 'NestJS', 'AWS'],
            languages: ['Bulgarian', 'English', 'German'],
            certifications: ['AWS Certified Developer – Associate'],
            location: 'Berlin, Germany',
            noticePeriodWeeks: 8,
          },
          scoreBreakdown: {
            mustHaveSkills: { weight: 0.5, matched: 4, of: 4, points: 50 },
            niceToHaveSkills: { weight: 0.2, matched: 3, of: 4, points: 15 },
            experienceYearsFit: { weight: 0.2, points: 16 },
            locationEligibility: { weight: 0.1, points: 7 },
            total: 88,
          },
        },
      },
    },
  });

  const elenaTechInterview = await prisma.interview.create({
    data: {
      applicationId: elenaApplication.id,
      type: 'TECHNICAL',
      status: 'COMPLETED',
      slotStart: daysAgo(25),
      slotEnd: new Date(daysAgo(25).getTime() + 90 * 60 * 1000),
      videoLink: 'https://teams.microsoft.com/l/meetup-join/elena-tech-2026',
      panelists: { connect: [{ id: hiringManager.id }] },
    },
  });

  const elenaFinalInterview = await prisma.interview.create({
    data: {
      applicationId: elenaApplication.id,
      type: 'HIRING_MANAGER',
      status: 'COMPLETED',
      slotStart: daysAgo(20),
      slotEnd: new Date(daysAgo(20).getTime() + 60 * 60 * 1000),
      videoLink: 'https://teams.microsoft.com/l/meetup-join/elena-hm-2026',
      panelists: { connect: [{ id: hiringManager.id }, { id: recruiter.id }] },
    },
  });

  await prisma.scorecard.createMany({
    data: [
      {
        interviewId: elenaTechInterview.id,
        interviewerId: hiringManager.id,
        recommendation: 'STRONG_YES',
        ratings: { systemDesign: 5, coding: 4, communication: 5, domainKnowledge: 4 },
        notes:
          'Excellent API design instincts; walked through a clean event-driven ' +
          'solution for the parsing pipeline exercise.',
      },
      {
        interviewId: elenaFinalInterview.id,
        interviewerId: hiringManager.id,
        recommendation: 'YES',
        ratings: { collaboration: 5, ownership: 4, valuesAlignment: 5 },
        notes: 'Great culture fit. Slight ramp-up needed on our compliance domain.',
      },
    ],
  });

  const elenaOffer = await prisma.offer.create({
    data: {
      applicationId: elenaApplication.id,
      baseSalary: 88000,
      currency: 'EUR',
      bonusPercent: 10,
      startDate: daysFromNow(20),
      approvalState: 'APPROVED',
      signatureStatus: 'SIGNED',
      expiresAt: daysAgo(3),
      signedAt: daysAgo(10),
      approvals: {
        create: [
          {
            sequence: 1,
            approverId: hiringManager.id,
            decision: 'APPROVED',
            comment: 'Within band, strong scorecards across the panel.',
            decidedAt: daysAgo(14),
          },
          {
            sequence: 2,
            approverId: recruiter.id,
            decision: 'APPROVED',
            comment: 'HR check complete; contract terms standard.',
            decidedAt: daysAgo(13),
          },
        ],
      },
    },
  });

  const elenaPlan = await prisma.onboardingPlan.create({
    data: {
      applicationId: elenaApplication.id,
      startDate: daysFromNow(20),
      checklistTemplate: 'engineering-default-v3',
      progressPercent: 40,
      tasks: {
        create: [
          {
            title: 'Sign employment contract',
            status: 'COMPLETED',
            dueDate: daysAgo(5),
            completedAt: daysAgo(10),
            docRef: 'onboarding-docs/2026/elena-petrova/contract-signed.pdf',
            ownerId: recruiter.id,
          },
          {
            title: 'Upload right-to-work documentation',
            status: 'COMPLETED',
            dueDate: daysAgo(2),
            completedAt: daysAgo(4),
            docRef: 'onboarding-docs/2026/elena-petrova/right-to-work.pdf',
            ownerId: recruiter.id,
          },
          {
            title: 'Submit bank and tax details',
            status: 'IN_PROGRESS',
            dueDate: daysFromNow(7),
            ownerId: recruiter.id,
          },
          {
            title: 'Raise IT provisioning ticket (laptop + accounts)',
            status: 'PENDING',
            dueDate: daysFromNow(13),
            ownerId: hiringManager.id,
          },
          {
            title: 'Assign onboarding buddy and prepare day-1 welcome pack',
            status: 'PENDING',
            dueDate: daysFromNow(18),
            ownerId: hiringManager.id,
          },
        ],
      },
    },
  });

  // -------------------------------------------------------------------------
  // Candidate 2 — James O'Connor: backend role, interview stage.
  // -------------------------------------------------------------------------
  const james = await prisma.candidate.create({
    data: {
      firstName: 'James',
      lastName: "O'Connor",
      email: 'james.oconnor@mail.example',
      phone: '+353 87 234 5678',
      location: 'Dublin, Ireland',
      source: 'JOB_BOARD',
      consentStatus: 'GRANTED',
      maskedInRankingView: true,
      consentRecords: {
        create: [
          {
            purpose: 'APPLICATION_PROCESSING',
            grantedAt: daysAgo(21),
            expiresAt: daysFromNow(344),
          },
        ],
      },
    },
  });

  const jamesApplication = await prisma.application.create({
    data: {
      candidateId: james.id,
      jobId: backendJob.id,
      stage: 'INTERVIEW',
      score: 74,
      knockoutResults: {
        'work_eligibility_eu': { answer: 'yes', passed: true },
        'notice_period_within_3_months': { answer: 'yes', passed: true },
      },
      appliedAt: daysAgo(21),
      cvDocuments: {
        create: [
          {
            fileRef: 'cv-uploads/2026/06/james-oconnor-v1.pdf',
            version: 1,
            uploadDate: daysAgo(21),
          },
        ],
      },
      parseResult: {
        create: {
          parserVersion: 'textkernel-extract-4.2.1',
          extractedFields: {
            workHistory: [
              {
                title: 'Software Engineer',
                employer: 'Green Harbour Tech Ltd',
                from: '2019-06',
                to: '2026-06',
              },
            ],
            education: [
              { degree: 'BEng Software Engineering', institution: 'UCD', year: 2019 },
            ],
            skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST APIs', 'Docker'],
            languages: ['English'],
            certifications: [],
            location: 'Dublin, Ireland',
            noticePeriodWeeks: 4,
          },
          scoreBreakdown: {
            mustHaveSkills: { weight: 0.5, matched: 4, of: 4, points: 50 },
            niceToHaveSkills: { weight: 0.2, matched: 0, of: 4, points: 0 },
            experienceYearsFit: { weight: 0.2, points: 16 },
            locationEligibility: { weight: 0.1, points: 8 },
            total: 74,
          },
        },
      },
      interviews: {
        create: [
          {
            type: 'PHONE_SCREEN',
            status: 'COMPLETED',
            slotStart: daysAgo(10),
            slotEnd: new Date(daysAgo(10).getTime() + 30 * 60 * 1000),
            videoLink: 'https://teams.microsoft.com/l/meetup-join/james-screen-2026',
            panelists: { connect: [{ id: recruiter.id }] },
          },
          {
            type: 'TECHNICAL',
            status: 'SCHEDULED',
            slotStart: daysFromNow(3),
            slotEnd: new Date(daysFromNow(3).getTime() + 90 * 60 * 1000),
            videoLink: 'https://teams.microsoft.com/l/meetup-join/james-tech-2026',
            panelists: { connect: [{ id: hiringManager.id }] },
          },
        ],
      },
    },
  });

  const jamesScreen = await prisma.interview.findFirstOrThrow({
    where: { applicationId: jamesApplication.id, type: 'PHONE_SCREEN' },
  });

  await prisma.scorecard.create({
    data: {
      interviewId: jamesScreen.id,
      interviewerId: recruiter.id,
      recommendation: 'YES',
      ratings: { motivation: 4, communication: 4, salaryAlignment: 3 },
      notes: 'Solid experience, keen on the compliance domain. Salary at top of band.',
    },
  });

  // -------------------------------------------------------------------------
  // Candidate 3 — Priya Sharma: frontend role, shortlisted.
  // -------------------------------------------------------------------------
  const priya = await prisma.candidate.create({
    data: {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya.sharma@mail.example',
      phone: '+31 6 1234 5678',
      location: 'Amsterdam, Netherlands',
      source: 'REFERRAL',
      consentStatus: 'GRANTED',
      maskedInRankingView: true,
      consentRecords: {
        create: [
          {
            purpose: 'APPLICATION_PROCESSING',
            grantedAt: daysAgo(12),
            expiresAt: daysFromNow(353),
          },
        ],
      },
    },
  });

  const priyaApplication = await prisma.application.create({
    data: {
      candidateId: priya.id,
      jobId: frontendJob.id,
      stage: 'SHORTLISTED',
      score: 81,
      knockoutResults: {
        'work_eligibility_eu': { answer: 'yes', passed: true },
      },
      appliedAt: daysAgo(12),
      cvDocuments: {
        create: [
          {
            fileRef: 'cv-uploads/2026/06/priya-sharma-v1.pdf',
            version: 1,
            uploadDate: daysAgo(12),
          },
        ],
      },
      parseResult: {
        create: {
          parserVersion: 'textkernel-extract-4.2.1',
          extractedFields: {
            workHistory: [
              {
                title: 'Frontend Developer',
                employer: 'Tulip Commerce BV',
                from: '2022-01',
                to: '2026-06',
              },
            ],
            education: [
              { degree: 'MSc Human-Computer Interaction', institution: 'TU Delft', year: 2021 },
            ],
            skills: ['React', 'TypeScript', 'CSS', 'Next.js', 'Storybook'],
            languages: ['English', 'Hindi', 'Dutch'],
            certifications: [],
            location: 'Amsterdam, Netherlands',
            noticePeriodWeeks: 4,
          },
          scoreBreakdown: {
            mustHaveSkills: { weight: 0.5, matched: 3, of: 3, points: 50 },
            niceToHaveSkills: { weight: 0.2, matched: 2, of: 3, points: 13 },
            experienceYearsFit: { weight: 0.2, points: 10 },
            locationEligibility: { weight: 0.1, points: 8 },
            total: 81,
          },
        },
      },
    },
  });

  // -------------------------------------------------------------------------
  // Candidate 4 — Tomasz Kowalski: backend role, rejected (missing must-have,
  // score capped at 40 per spec section 3).
  // -------------------------------------------------------------------------
  const tomasz = await prisma.candidate.create({
    data: {
      firstName: 'Tomasz',
      lastName: 'Kowalski',
      email: 'tomasz.kowalski@mail.example',
      phone: '+48 601 234 567',
      location: 'Warsaw, Poland',
      source: 'JOB_BOARD',
      consentStatus: 'GRANTED',
      maskedInRankingView: true,
      consentRecords: {
        create: [
          {
            purpose: 'APPLICATION_PROCESSING',
            grantedAt: daysAgo(35),
            // Retention: parsed data deleted 6 months post-rejection unless
            // talent-pool consent is renewed.
            expiresAt: daysFromNow(152),
          },
        ],
      },
    },
  });

  const tomaszApplication = await prisma.application.create({
    data: {
      candidateId: tomasz.id,
      jobId: backendJob.id,
      stage: 'REJECTED',
      score: 38,
      knockoutResults: {
        'work_eligibility_eu': { answer: 'yes', passed: true },
        'notice_period_within_3_months': { answer: 'yes', passed: true },
      },
      rejectionReason:
        'Missing must-have skills (PostgreSQL, REST APIs); stronger fit ' +
        'candidates in the shortlist. Reviewed and confirmed by recruiter.',
      appliedAt: daysAgo(35),
      cvDocuments: {
        create: [
          {
            fileRef: 'cv-uploads/2026/06/tomasz-kowalski-v1.pdf',
            version: 1,
            uploadDate: daysAgo(35),
          },
        ],
      },
      parseResult: {
        create: {
          parserVersion: 'textkernel-extract-4.2.0',
          extractedFields: {
            workHistory: [
              {
                title: 'PHP Developer',
                employer: 'Vistula Software Sp. z o.o.',
                from: '2018-04',
                to: '2026-05',
              },
            ],
            education: [
              { degree: 'BSc Informatics', institution: 'Warsaw University of Technology', year: 2018 },
            ],
            skills: ['PHP', 'MySQL', 'TypeScript', 'Node.js'],
            languages: ['Polish', 'English'],
            certifications: [],
            location: 'Warsaw, Poland',
            noticePeriodWeeks: 12,
          },
          scoreBreakdown: {
            mustHaveSkills: { weight: 0.5, matched: 2, of: 4, points: 25 },
            niceToHaveSkills: { weight: 0.2, matched: 0, of: 4, points: 0 },
            experienceYearsFit: { weight: 0.2, points: 16 },
            locationEligibility: { weight: 0.1, points: 7 },
            missingMustHaveCapApplied: true,
            total: 38,
          },
        },
      },
    },
  });

  // -------------------------------------------------------------------------
  // Candidate 5 — Aisha Diallo: frontend role, failed a knockout question
  // (excluded before scoring — no parse score recorded).
  // -------------------------------------------------------------------------
  const aisha = await prisma.candidate.create({
    data: {
      firstName: 'Aisha',
      lastName: 'Diallo',
      email: 'aisha.diallo@mail.example',
      phone: '+33 6 12 34 56 78',
      location: 'Lyon, France',
      source: 'CAREERS_PAGE',
      consentStatus: 'GRANTED',
      maskedInRankingView: true,
      consentRecords: {
        create: [
          {
            purpose: 'APPLICATION_PROCESSING',
            grantedAt: daysAgo(8),
            expiresAt: daysFromNow(357),
          },
        ],
      },
    },
  });

  await prisma.application.create({
    data: {
      candidateId: aisha.id,
      jobId: frontendJob.id,
      stage: 'KNOCKOUT_FAILED',
      score: null,
      knockoutResults: {
        'work_eligibility_eu': { answer: 'yes', passed: true },
        'available_within_2_months': { answer: 'no', passed: false },
      },
      rejectionReason: 'Failed knockout question: not available within 2 months.',
      appliedAt: daysAgo(8),
      cvDocuments: {
        create: [
          {
            fileRef: 'cv-uploads/2026/07/aisha-diallo-v1.pdf',
            version: 1,
            uploadDate: daysAgo(8),
          },
        ],
      },
    },
  });

  // -------------------------------------------------------------------------
  // Audit log — human decision logging (GDPR Art. 22 / EU AI Act oversight).
  // -------------------------------------------------------------------------
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: recruiter.id,
        action: 'job.published',
        entityType: 'Job',
        entityId: backendJob.id,
        detail: { status: 'PUBLISHED' },
        timestamp: daysAgo(45),
      },
      {
        actorId: recruiter.id,
        action: 'job.published',
        entityType: 'Job',
        entityId: frontendJob.id,
        detail: { status: 'PUBLISHED' },
        timestamp: daysAgo(30),
      },
      {
        actorId: recruiter.id,
        action: 'application.stage_changed',
        entityType: 'Application',
        entityId: elenaApplication.id,
        detail: { from: 'SHORTLISTED', to: 'INTERVIEW', decisionBy: 'human' },
        timestamp: daysAgo(27),
      },
      {
        actorId: hiringManager.id,
        action: 'offer.approved',
        entityType: 'Offer',
        entityId: elenaOffer.id,
        detail: { sequence: 1, decision: 'APPROVED' },
        timestamp: daysAgo(14),
      },
      {
        actorId: null,
        action: 'offer.signed',
        entityType: 'Offer',
        entityId: elenaOffer.id,
        detail: { provider: 'docusign', envelopeStatus: 'completed' },
        timestamp: daysAgo(10),
      },
      {
        actorId: recruiter.id,
        action: 'application.stage_changed',
        entityType: 'Application',
        entityId: elenaApplication.id,
        detail: { from: 'OFFER', to: 'HIRED', decisionBy: 'human' },
        timestamp: daysAgo(10),
      },
      {
        actorId: null,
        action: 'onboarding_plan.created',
        entityType: 'OnboardingPlan',
        entityId: elenaPlan.id,
        detail: { template: 'engineering-default-v3' },
        timestamp: daysAgo(10),
      },
      {
        actorId: recruiter.id,
        action: 'application.rejected',
        entityType: 'Application',
        entityId: tomaszApplication.id,
        detail: { reason: 'missing_must_have_skills', decisionBy: 'human' },
        timestamp: daysAgo(28),
      },
    ],
  });

  // -------------------------------------------------------------------------
  // Candidate scores (ranking rows matching the seeded parse results, so the
  // bias-masked ranking view works offline without re-parsing)
  // -------------------------------------------------------------------------
  await prisma.candidateScore.createMany({
    data: [
      {
        applicationId: elenaApplication.id,
        totalScore: 88,
        mustHavePoints: 50,
        niceToHavePoints: 15,
        experiencePoints: 16,
        locationPoints: 7,
        capApplied: false,
        matchedMustHave: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST APIs'],
        missingMustHave: [],
        matchedNiceToHave: ['NestJS', 'AWS', 'Prisma'],
        rankedSkills: [
          { skill: 'TypeScript', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'Node.js', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'PostgreSQL', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'REST APIs', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'NestJS', category: 'NICE_TO_HAVE', points: 5 },
          { skill: 'AWS', category: 'NICE_TO_HAVE', points: 5 },
          { skill: 'Prisma', category: 'NICE_TO_HAVE', points: 5 },
        ],
        cvDocumentVersion: 2,
        parserVersion: 'textkernel-extract-4.2.0',
      },
      {
        applicationId: jamesApplication.id,
        totalScore: 74,
        mustHavePoints: 50,
        niceToHavePoints: 0,
        experiencePoints: 16,
        locationPoints: 8,
        capApplied: false,
        matchedMustHave: ['TypeScript', 'Node.js', 'PostgreSQL', 'REST APIs'],
        missingMustHave: [],
        matchedNiceToHave: [],
        rankedSkills: [
          { skill: 'TypeScript', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'Node.js', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'PostgreSQL', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'REST APIs', category: 'MUST_HAVE', points: 12.5 },
        ],
        cvDocumentVersion: 1,
        parserVersion: 'textkernel-extract-4.2.1',
      },
      {
        applicationId: priyaApplication.id,
        totalScore: 81,
        mustHavePoints: 50,
        niceToHavePoints: 13,
        experiencePoints: 10,
        locationPoints: 8,
        capApplied: false,
        matchedMustHave: ['React', 'TypeScript', 'CSS'],
        missingMustHave: [],
        matchedNiceToHave: ['Next.js', 'Storybook'],
        rankedSkills: [
          { skill: 'React', category: 'MUST_HAVE', points: 16.7 },
          { skill: 'TypeScript', category: 'MUST_HAVE', points: 16.7 },
          { skill: 'CSS', category: 'MUST_HAVE', points: 16.7 },
          { skill: 'Next.js', category: 'NICE_TO_HAVE', points: 6.7 },
          { skill: 'Storybook', category: 'NICE_TO_HAVE', points: 6.7 },
        ],
        cvDocumentVersion: 1,
        parserVersion: 'textkernel-extract-4.2.1',
      },
      {
        applicationId: tomaszApplication.id,
        totalScore: 38,
        mustHavePoints: 25,
        niceToHavePoints: 0,
        experiencePoints: 16,
        locationPoints: 7,
        capApplied: true,
        matchedMustHave: ['TypeScript', 'Node.js'],
        missingMustHave: ['PostgreSQL', 'REST APIs'],
        matchedNiceToHave: [],
        rankedSkills: [
          { skill: 'TypeScript', category: 'MUST_HAVE', points: 12.5 },
          { skill: 'Node.js', category: 'MUST_HAVE', points: 12.5 },
        ],
        cvDocumentVersion: 1,
        parserVersion: 'textkernel-extract-4.2.1',
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    jobs: await prisma.job.count(),
    candidates: await prisma.candidate.count(),
    applications: await prisma.application.count(),
    interviews: await prisma.interview.count(),
    scorecards: await prisma.scorecard.count(),
    offers: await prisma.offer.count(),
    onboardingTasks: await prisma.onboardingTask.count(),
    consentRecords: await prisma.consentRecord.count(),
    auditLogs: await prisma.auditLog.count(),
  };
  console.log('Seed complete:', counts);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
