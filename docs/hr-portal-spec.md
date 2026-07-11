# HR Portal — Recruitment-to-Onboarding Spec

## 1. Roles & Permissions

| Role | Key permissions |
|---|---|
| HR Admin | Full config, user/role management, retention policies, GDPR erasure, audit access |
| Recruiter | Create/publish jobs, manage candidates, schedule interviews, draft offers |
| Hiring Manager | View own requisitions, review ranked shortlists, submit scorecards, approve offers |
| Interviewer | View assigned candidate packet only, submit scorecards |
| Finance Approver | Approve offer compensation against band |
| Candidate | Apply, upload CV, self-schedule, e-sign offer, withdraw/erase data |
| New Hire | Onboarding portal: tasks, document upload, policy acknowledgements |
| DPO/Auditor | Read-only audit logs, consent records, processing reports |

## 2. Features per Pipeline Stage

**Job posting**
- Job templates with structured requirement tags (must-have / nice-to-have skills)
- Requisition approval chain (manager → HR → finance)
- Careers-page embed with branded apply flow
- Board multiposting via aggregator

**CV parsing/ranking**
- Auto-parse on application; ranked shortlist per requisition
- Knockout questions filter before scoring
- Duplicate-candidate detection and merge
- GDPR consent captured at apply (processing + retention terms)

**Interview scheduling**
- Candidate self-serve slot booking from interviewer calendar availability
- Panel scheduling with conflict detection
- Auto-generated video links and calendar invites
- Automated reminders and reschedule/cancel flows

**Offer**
- Offer templates with comp-band validation
- Sequential approval chain, then e-signature
- Auto-notify and close out other active candidates on acceptance
- Expiry and renegotiation tracking

**Onboarding**
- Role/department task checklists with owners and due dates
- Document collection: contract, right-to-work, bank/tax details
- IT provisioning tickets (account, equipment) triggered on start-date confirmation
- Day-1 welcome pack and buddy assignment

## 3. CV Parsing

- Fields extracted: contact details, work history (titles, employers, dates), education, skills, languages, certifications, location, notice period
- Parsing via managed API (Textkernel) — no in-house NLP
- Matching: extracted skills vs. job requirement tags; weighted must-have vs. nice-to-have
- Score 0–100: must-have skills 50%, nice-to-have 20%, experience-years fit 20%, location/work-eligibility 10%
- Any missing must-have caps score at 40; failed knockouts excluded pre-scoring
- Ranking is decision-support only — a human records every advance/reject (GDPR Art. 22; EU AI Act high-risk: human oversight + decision logging)
- Bias controls: name, photo, age, address masked in ranking view
- Retention: parsed data deleted 6 months post-rejection unless talent-pool consent renewed

## 4. Data Model

| Entity | Key fields | Relationships |
|---|---|---|
| Job | title, requirement tags, comp band, status, location | has many Applications; belongs to User (owner) |
| Candidate | contact, consent status, source, masked-view flag | has many Applications, ConsentRecords |
| Application | stage, score, knockout results, rejection reason | Candidate ↔ Job; has one ParseResult, many Interviews |
| CVDocument | file ref (S3), version, upload date | belongs to Application |
| ParseResult | extracted fields JSON, score breakdown, parser version | belongs to Application |
| Interview | type, panel, slot, video link, status | belongs to Application; has many Scorecards |
| Scorecard | ratings per criterion, recommendation, notes | Interview ↔ User (interviewer) |
| Offer | comp, start date, approval state, signature status | belongs to Application; has many Approvals |
| OnboardingPlan | start date, checklist template, progress | belongs to Application; has many OnboardingTasks |
| OnboardingTask | title, owner, due date, status, doc ref | belongs to OnboardingPlan |
| User | role, department, calendar link | referenced across entities |
| ConsentRecord | purpose, granted/withdrawn timestamps, expiry | belongs to Candidate |
| AuditLog | actor, action, entity ref, timestamp | append-only, references all entities |

## 5. Tech Stack

| Layer | Pick | Why |
|---|---|---|
| Frontend | Next.js | SSR careers pages and internal app in one framework |
| Backend | NestJS (TypeScript) | Shared types with frontend; structured modules fit workflow domain |
| Database | PostgreSQL (AWS RDS, eu-central-1) | Relational pipeline data; EU residency built-in |
| File storage | S3 eu-central-1, SSE-KMS | Encrypted CV/contract storage with lifecycle-based deletion |
| Auth | Auth0 (EU tenant) | Managed SSO/MFA for staff + candidate accounts |
| Hosting | AWS ECS Fargate | Managed containers, no cluster ops at this scale |
| Async jobs | AWS SQS + worker service | Decouples parsing, notifications, provisioning |
| Search | Postgres full-text | Sufficient at ~50 hires/yr; no extra infra |

## 6. Third-Party Integrations

| Category | Vendor | Purpose |
|---|---|---|
| CV parsing | Textkernel | Parse + skill extraction API |
| Job multiposting | Broadbean | Push postings to boards from one place |
| Calendar | Microsoft 365 Graph | Interviewer availability + invites |
| Video interviews | Microsoft Teams | Auto-generated meeting links |
| E-signature | DocuSign (EU datacentre) | Offer and contract signing |
| Background checks | Zinc | EU-compliant referencing/right-to-work |
| HRIS handoff | Personio | Push accepted hires to system of record |
| Transactional email | AWS SES (eu-central-1) | Candidate and internal notifications |

## 7. MVP vs Phase 2

| MVP | Phase 2 |
|---|---|
| Job templates + approval chain | Board multiposting |
| Careers page + apply flow | Talent pool + consent renewal |
| CV parsing + ranked shortlist | Panel auto-scheduling |
| Knockout questions | Background checks |
| Self-serve interview booking | HRIS sync |
| Scorecards | Analytics dashboards |
| Offer templates + e-signature | IT provisioning integration |
| Onboarding checklist + doc collection | Referral portal |
| GDPR consent, retention, audit log | Candidate NPS surveys |
| SSO + role-based access | Buddy/mentor matching |
