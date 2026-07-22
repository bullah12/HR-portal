/**
 * Single source of truth for every status enum in the app.
 *
 * Before: each screen re-declared its own {BADGE, LABEL} maps, so the same
 * value (e.g. PENDING) rendered with different colours on different screens.
 * Now every status → { label, tone } lives here and is rendered by <StatusPill>.
 *
 * `tone` names a colour family; the concrete hex pairs live in TONE_STYLES so
 * a tone can be restyled once and apply everywhere.
 */

export type Tone = 'emerald' | 'amber' | 'sky' | 'rose' | 'slate';

export interface ToneStyle {
  bg: string;
  text: string;
  dot: string;
}

export const TONE_STYLES: Record<Tone, ToneStyle> = {
  emerald: { bg: '#d1fae5', text: '#065f46', dot: '#059669' },
  amber:   { bg: '#fef3c7', text: '#92400e', dot: '#d97706' },
  sky:     { bg: '#e0f2fe', text: '#075985', dot: '#0284c7' },
  rose:    { bg: '#ffe4e6', text: '#9f1239', dot: '#e11d48' },
  slate:   { bg: '#f1f5f9', text: '#475569', dot: '#94a3b8' },
};

export type StatusKind =
  | 'job'
  | 'consent'
  | 'interview'
  | 'onboardingTask'
  | 'documentReview'
  | 'offerApproval'
  | 'candidateDecision';

interface StatusMeta {
  label: string;
  tone: Tone;
}

/** Every enum value used across the API, mapped to a human label + tone. */
export const STATUS_MAP: Record<StatusKind, Record<string, StatusMeta>> = {
  // components/jobs/JobList.tsx — JobStatus
  job: {
    DRAFT: { label: 'Draft', tone: 'slate' },
    PENDING_APPROVAL: { label: 'Pending approval', tone: 'amber' },
    PUBLISHED: { label: 'Published', tone: 'emerald' },
    CLOSED: { label: 'Closed', tone: 'rose' },
  },
  // components/candidates/* — consentStatus
  consent: {
    GRANTED: { label: 'Granted', tone: 'emerald' },
    PENDING: { label: 'Pending', tone: 'amber' },
    WITHDRAWN: { label: 'Withdrawn', tone: 'rose' },
    EXPIRED: { label: 'Expired', tone: 'slate' },
  },
  // components/interviews/InterviewScheduler.tsx — interview.status
  interview: {
    SCHEDULED: { label: 'Scheduled', tone: 'sky' },
    RESCHEDULED: { label: 'Rescheduled', tone: 'amber' },
    COMPLETED: { label: 'Completed', tone: 'emerald' },
    CANCELLED: { label: 'Cancelled', tone: 'slate' },
    NO_SHOW: { label: 'No show', tone: 'rose' },
  },
  // components/onboarding/ChecklistView.tsx — task.status
  onboardingTask: {
    PENDING: { label: 'Pending', tone: 'slate' },
    IN_PROGRESS: { label: 'In progress', tone: 'sky' },
    COMPLETED: { label: 'Completed', tone: 'emerald' },
    BLOCKED: { label: 'Blocked', tone: 'rose' },
  },
  // components/onboarding/DocumentUpload.tsx — document.status
  documentReview: {
    PENDING_REVIEW: { label: 'Pending review', tone: 'amber' },
    APPROVED: { label: 'Approved', tone: 'emerald' },
    REJECTED: { label: 'Rejected', tone: 'rose' },
  },
  // components/offers/OfferCard.tsx — approvalState / approval.decision
  offerApproval: {
    DRAFT: { label: 'Draft', tone: 'slate' },
    PENDING: { label: 'Pending', tone: 'amber' },
    PENDING_APPROVAL: { label: 'Pending approval', tone: 'amber' },
    APPROVED: { label: 'Approved', tone: 'emerald' },
    REJECTED: { label: 'Rejected', tone: 'rose' },
    EXPIRED: { label: 'Expired', tone: 'slate' },
  },
  // components/offers/OfferCard.tsx — candidateDecision
  candidateDecision: {
    PENDING: { label: 'Pending', tone: 'amber' },
    ACCEPTED: { label: 'Accepted', tone: 'emerald' },
    DECLINED: { label: 'Declined', tone: 'rose' },
    EXPIRED: { label: 'Expired', tone: 'slate' },
  },
};

/** Humanise an unknown enum value: NO_SHOW -> "No show". */
function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function resolveStatus(kind: StatusKind, value: string): StatusMeta {
  return STATUS_MAP[kind]?.[value] ?? { label: humanise(value), tone: 'slate' };
}
