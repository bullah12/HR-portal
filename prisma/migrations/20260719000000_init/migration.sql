-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('HR_ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'FINANCE_APPROVER', 'DPO_AUDITOR');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CandidateSource" AS ENUM ('CAREERS_PAGE', 'JOB_BOARD', 'REFERRAL', 'AGENCY', 'DIRECT_SOURCING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('APPLIED', 'KNOCKOUT_FAILED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "InterviewType" AS ENUM ('PHONE_SCREEN', 'TECHNICAL', 'PANEL', 'HIRING_MANAGER', 'FINAL');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "ScorecardRecommendation" AS ENUM ('STRONG_YES', 'YES', 'NO', 'STRONG_NO');

-- CreateEnum
CREATE TYPE "OfferApprovalState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('NOT_SENT', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('APPLICATION_PROCESSING', 'TALENT_POOL');

-- CreateEnum
CREATE TYPE "OnboardingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OnboardingTaskCategory" AS ENUM ('DOCUMENTS', 'IT_PROVISIONING', 'TRAINING', 'OTHER');

-- CreateEnum
CREATE TYPE "OnboardingDocumentStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CandidateDecision" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "JobBoardPostingStatus" AS ENUM ('POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BackgroundCheckStatus" AS ENUM ('REQUESTED', 'IN_PROGRESS', 'CLEAR', 'CONSIDER', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "department" TEXT NOT NULL,
    "calendarLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'DRAFT',
    "mustHaveSkills" TEXT[],
    "niceToHaveSkills" TEXT[],
    "minExperienceYears" INTEGER NOT NULL DEFAULT 0,
    "compBandMin" DECIMAL(10,2) NOT NULL,
    "compBandMax" DECIMAL(10,2) NOT NULL,
    "compBandCurrency" TEXT NOT NULL DEFAULT 'EUR',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_board_postings" (
    "id" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "status" "JobBoardPostingStatus" NOT NULL,
    "externalRef" TEXT,
    "error" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "job_board_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidates" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "location" TEXT,
    "source" "CandidateSource" NOT NULL,
    "consentStatus" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "maskedInRankingView" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "stage" "ApplicationStage" NOT NULL DEFAULT 'APPLIED',
    "score" INTEGER,
    "knockoutResults" JSONB,
    "rejectionReason" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cv_documents" (
    "id" TEXT NOT NULL,
    "fileRef" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "cv_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parse_results" (
    "id" TEXT NOT NULL,
    "extractedFields" JSONB NOT NULL,
    "scoreBreakdown" JSONB NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "parse_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_scores" (
    "id" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "mustHavePoints" INTEGER NOT NULL,
    "niceToHavePoints" INTEGER NOT NULL,
    "experiencePoints" INTEGER NOT NULL,
    "locationPoints" INTEGER NOT NULL,
    "capApplied" BOOLEAN NOT NULL DEFAULT false,
    "matchedMustHave" TEXT[],
    "missingMustHave" TEXT[],
    "matchedNiceToHave" TEXT[],
    "rankedSkills" JSONB NOT NULL,
    "cvDocumentVersion" INTEGER NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "candidate_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "type" "InterviewType" NOT NULL,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "slotStart" TIMESTAMP(3) NOT NULL,
    "slotEnd" TIMESTAMP(3) NOT NULL,
    "videoLink" TEXT,
    "calendarEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorecards" (
    "id" TEXT NOT NULL,
    "ratings" JSONB NOT NULL,
    "recommendation" "ScorecardRecommendation" NOT NULL,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "interviewId" TEXT NOT NULL,
    "interviewerId" TEXT NOT NULL,

    CONSTRAINT "scorecards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "baseSalary" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "bonusPercent" DECIMAL(5,2),
    "startDate" TIMESTAMP(3) NOT NULL,
    "approvalState" "OfferApprovalState" NOT NULL DEFAULT 'DRAFT',
    "signatureStatus" "SignatureStatus" NOT NULL DEFAULT 'NOT_SENT',
    "accessToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "esignEnvelopeId" TEXT,
    "candidateDecision" "CandidateDecision" NOT NULL DEFAULT 'PENDING',
    "candidateDecidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_approvals" (
    "id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "offerId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,

    CONSTRAINT "offer_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_plans" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "checklistTemplate" TEXT NOT NULL,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "accessToken" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "onboarding_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "OnboardingTaskCategory" NOT NULL DEFAULT 'OTHER',
    "status" "OnboardingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "requiresDocument" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "docRef" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "planId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "onboarding_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_documents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileRef" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "OnboardingDocumentStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "onboarding_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" TEXT NOT NULL,
    "purpose" "ConsentPurpose" NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "candidateId" TEXT NOT NULL,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_checks" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'zinc',
    "externalId" TEXT NOT NULL,
    "package" TEXT NOT NULL,
    "status" "BackgroundCheckStatus" NOT NULL DEFAULT 'REQUESTED',
    "result" JSONB,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "background_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_InterviewPanelists" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_ownerId_idx" ON "jobs"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "job_board_postings_jobId_board_key" ON "job_board_postings"("jobId", "board");

-- CreateIndex
CREATE UNIQUE INDEX "candidates_email_key" ON "candidates"("email");

-- CreateIndex
CREATE INDEX "candidates_email_idx" ON "candidates"("email");

-- CreateIndex
CREATE INDEX "applications_jobId_stage_idx" ON "applications"("jobId", "stage");

-- CreateIndex
CREATE INDEX "applications_jobId_score_idx" ON "applications"("jobId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "applications_candidateId_jobId_key" ON "applications"("candidateId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "cv_documents_applicationId_version_key" ON "cv_documents"("applicationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "parse_results_applicationId_key" ON "parse_results"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_scores_applicationId_key" ON "candidate_scores"("applicationId");

-- CreateIndex
CREATE INDEX "candidate_scores_totalScore_idx" ON "candidate_scores"("totalScore");

-- CreateIndex
CREATE INDEX "interviews_applicationId_idx" ON "interviews"("applicationId");

-- CreateIndex
CREATE INDEX "interviews_slotStart_idx" ON "interviews"("slotStart");

-- CreateIndex
CREATE UNIQUE INDEX "scorecards_interviewId_interviewerId_key" ON "scorecards"("interviewId", "interviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_accessToken_key" ON "offers"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "offers_esignEnvelopeId_key" ON "offers"("esignEnvelopeId");

-- CreateIndex
CREATE UNIQUE INDEX "offers_applicationId_key" ON "offers"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "offer_approvals_offerId_sequence_key" ON "offer_approvals"("offerId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_plans_accessToken_key" ON "onboarding_plans"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_plans_applicationId_key" ON "onboarding_plans"("applicationId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_planId_idx" ON "onboarding_tasks"("planId");

-- CreateIndex
CREATE INDEX "onboarding_tasks_ownerId_status_idx" ON "onboarding_tasks"("ownerId", "status");

-- CreateIndex
CREATE INDEX "onboarding_documents_planId_idx" ON "onboarding_documents"("planId");

-- CreateIndex
CREATE INDEX "consent_records_candidateId_purpose_idx" ON "consent_records"("candidateId", "purpose");

-- CreateIndex
CREATE INDEX "consent_records_expiresAt_idx" ON "consent_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "background_checks_externalId_key" ON "background_checks"("externalId");

-- CreateIndex
CREATE INDEX "background_checks_applicationId_idx" ON "background_checks"("applicationId");

-- CreateIndex
CREATE INDEX "webhook_events_provider_status_idx" ON "webhook_events"("provider", "status");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_idx" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "_InterviewPanelists_AB_unique" ON "_InterviewPanelists"("A", "B");

-- CreateIndex
CREATE INDEX "_InterviewPanelists_B_index" ON "_InterviewPanelists"("B");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_board_postings" ADD CONSTRAINT "job_board_postings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_results" ADD CONSTRAINT "parse_results_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_scores" ADD CONSTRAINT "candidate_scores_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_interviewerId_fkey" FOREIGN KEY ("interviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_plans" ADD CONSTRAINT "onboarding_plans_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_planId_fkey" FOREIGN KEY ("planId") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_tasks" ADD CONSTRAINT "onboarding_tasks_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_planId_fkey" FOREIGN KEY ("planId") REFERENCES "onboarding_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_documents" ADD CONSTRAINT "onboarding_documents_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "onboarding_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewPanelists" ADD CONSTRAINT "_InterviewPanelists_A_fkey" FOREIGN KEY ("A") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_InterviewPanelists" ADD CONSTRAINT "_InterviewPanelists_B_fkey" FOREIGN KEY ("B") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

