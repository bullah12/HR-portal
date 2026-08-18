# HR Portal — Product Specification

This document defines the durable product requirements for the recruitment-to-
onboarding portal. It was recovered from the original pipeline-design branch and
reconciled with the application that was subsequently built. Implementation
status and delivery gaps are tracked separately in [`PLAN.md`](./PLAN.md).

## 1. Product scope

The portal supports an internal hiring team from requisition creation through a
new hire's onboarding. It should keep decisions attributable to people, reduce
manual hand-offs, and preserve consent and audit evidence throughout the
pipeline.

The core workflow is:

1. Create and approve a job requisition.
2. Publish the job and receive candidates.
3. Parse CVs and produce a decision-support ranking.
4. Shortlist candidates and schedule interviews.
5. Collect structured interviewer scorecards.
6. Draft, approve, sign, and accept an offer.
7. Create and complete an onboarding plan.

## 2. Users and permissions

| User | Responsibilities |
|---|---|
| HR administrator | Configure and oversee the system, manage hiring workflows, retention, consent, and audit access. |
| Recruiter | Create and publish jobs, manage candidates, arrange interviews, and prepare offers. |
| Hiring manager | Review owned requisitions and shortlists, submit scorecards, and approve offers. |
| Interviewer | View assigned interview information and submit a scorecard. |
| Finance approver | Review offer compensation against the approved band. |
| DPO / auditor | Review consent and append-only audit records without changing hiring data. |
| Candidate / new hire | Use secure tokenized links to review offers and complete onboarding; they are not staff accounts. |

Access must be least-privilege and role-based. Candidate data shown during
ranking should omit identity attributes that are not needed for assessment.

## 3. Functional requirements

### Job requisitions

- Capture structured must-have and nice-to-have requirements, location,
  experience expectations, owner, and compensation band.
- Move jobs through an explicit draft, approval, publication, and closure
  lifecycle.
- Record who performs every lifecycle transition.
- Support publishing to external job boards through replaceable integrations.

### Candidates and applications

- Maintain one candidate profile across applications and prevent duplicate
  applications for the same job.
- Capture source, knockout answers, pipeline stage, withdrawal, and rejection
  rationale.
- Record processing and retention consent, including expiry and withdrawal.
- Allow candidates to request withdrawal or erasure subject to required audit
  and legal records.

### CV parsing and ranking

- Extract contact details, employment, education, skills, certifications,
  languages, location, and experience indicators where present.
- Compare extracted evidence with the job's structured requirements.
- Use a transparent, deterministic 0–100 rubric:

  | Factor | Weight |
  |---|---:|
  | Must-have skills | 50 |
  | Nice-to-have skills | 20 |
  | Experience fit | 20 |
  | Location / eligibility | 10 |

- Cap the total at 40 when a must-have skill is missing and exclude failed
  knockout applications before ranking.
- Treat ranking as decision support only. A person must make and record each
  advance or rejection decision.
- Mask name, photo, age, and street address in ranking contexts where feasible.
- Retain the score breakdown and scoring version so a result can be explained
  and reproduced.

### Interviews

- Schedule individual or panel interviews with conflict detection.
- Create calendar events and online meeting links when an integration is
  configured.
- Support cancellation and rescheduling without losing the audit trail.
- Collect one structured scorecard per assigned interviewer, including ratings,
  recommendation, and notes.

### Offers

- Build offers from consistent terms and validate compensation against the job
  band.
- Run approvals in a defined sequence, including hiring and finance approval
  where required.
- Generate an offer document and support replaceable e-signature integration.
- Give the candidate a time-limited, tokenized way to accept or decline.
- On acceptance, mark the application hired, close competing active
  applications as appropriate, and create an onboarding plan.

### Onboarding

- Create role- or department-appropriate checklist tasks with owners and due
  dates.
- Collect required documents and support staff review.
- Track progress without exposing internal staff data through the public link.
- Leave room for later HRIS hand-off, IT provisioning, welcome packs, and buddy
  assignment.

### Compliance and auditability

- Keep an append-only audit record of material reads, writes, decisions, and
  integration events with actor, entity, action, and timestamp.
- Preserve consent history rather than overwriting it.
- Enforce retention and consent-expiry policies with reviewable outcomes.
- Verify inbound integration webhooks and persist them before processing.
- Maintain meaningful human oversight of automated ranking in line with GDPR
  Article 22 and applicable employment/AI regulation.

## 4. Conceptual data model

| Entity | Purpose |
|---|---|
| User | Staff identity, role, ownership, approvals, scorecards, and audit attribution. |
| Job | Requisition details, requirements, compensation band, owner, and lifecycle. |
| Candidate | Person, source, consent status, and masking preference. |
| Application | Candidate-to-job relationship, stage, score, knockout result, and decision rationale. |
| CV document / parse result | Versioned source file, extracted fields, parser version, and score breakdown. |
| Interview / scorecard | Scheduled assessment, panel, status, ratings, recommendation, and notes. |
| Offer / approval | Compensation, terms, sequential decisions, signature, expiry, and candidate response. |
| Onboarding plan / task / document | New-hire checklist, ownership, due dates, uploads, review, and progress. |
| Consent record | Purpose, grant, withdrawal, and expiry history. |
| Audit log / webhook event | Durable evidence of user, system, and integration activity. |

The authoritative implementation is `prisma/schema.prisma`; this table
describes product concepts rather than duplicating every database field.

## 5. Implementation constraints

- Use the repository's unified Next.js TypeScript application for UI and API
  routes rather than introducing a separate backend without a clear need.
- PostgreSQL via Prisma is the system of record.
- Staff authentication uses the application's signed, HTTP-only session cookie
  and role-based middleware. Candidate access uses scoped secret tokens.
- External services (job boards, calendar/video, background checks,
  e-signature, messaging, email, and future HRIS) must remain replaceable and
  have a safe local development mode.
- Production file storage must be durable and private; local disk is acceptable
  only for development or a deployment with an explicit persistent-volume
  design.
- Secrets must be supplied through environment or platform secret management,
  never committed.

## 6. Delivery boundaries

### Baseline product

- Job creation and lifecycle
- Candidate and application management
- CV parsing, knockout rules, and explainable ranking
- Interview scheduling and scorecards
- Offer generation, sequential approval, signature, and acceptance
- Onboarding checklist and document collection
- Role-based access, consent history, retention, and audit viewing

### Later extensions

- Careers-page application flow and candidate self-scheduling
- Talent-pool consent renewal
- Rich analytics and hiring-funnel reporting
- HRIS hand-off and automated IT provisioning
- Referral workflows and candidate experience surveys
- Configurable onboarding templates, welcome packs, and buddy assignment

These boundaries describe product priority, not current completion. See
[`PLAN.md`](./PLAN.md) for the codebase audit and roadmap.
