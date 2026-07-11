'use client';

/**
 * Offer card in two modes:
 *  - staff: full internal view — comp vs band, approval chain with
 *    approve/reject actions for the caller's pending step, PDF link, and
 *    the copyable candidate offer link.
 *  - candidate: the public acceptance view reached via the tokenized
 *    link — terms + accept/decline buttons (no e-signature; that's
 *    Phase 3).
 */

import { useState } from 'react';
import { apiFetch } from '@/lib/client';

export interface StaffOffer {
  id: string;
  baseSalary: number;
  currency: string;
  bonusPercent: number | null;
  startDate: string;
  approvalState: string;
  signatureStatus: string;
  candidateDecision: string;
  candidateLink: string;
  expiresAt: string;
  application: {
    stage: string;
    candidate: { name: string; email: string };
    job: { title: string; location: string; compBand: { min: number; max: number; currency: string } };
  };
  approvals: Array<{
    sequence: number;
    decision: string;
    comment: string | null;
    approver: { id: string; name: string; role: string };
  }>;
}

export interface CandidateOffer {
  id: string;
  candidateName: string;
  jobTitle: string;
  jobLocation: string;
  baseSalary: number;
  currency: string;
  bonusPercent: number | null;
  startDate: string;
  expiresAt: string;
  candidateDecision: string;
  readyToDecide: boolean;
  expired: boolean;
  onboardingToken: string | null;
}

type OfferCardProps =
  | { mode: 'staff'; offer: StaffOffer; currentUserId: string; onChanged: () => void }
  | { mode: 'candidate'; offer: CandidateOffer; token: string; onDecided: () => void };

const DECISION_BADGES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  DECLINED: 'bg-rose-100 text-rose-700',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  DRAFT: 'bg-slate-100 text-slate-600',
  EXPIRED: 'bg-slate-100 text-slate-500',
};

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function OfferCard(props: OfferCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ------------------------------------------------------------------ staff
  if (props.mode === 'staff') {
    const { offer, currentUserId, onChanged } = props;
    const myPendingStep = offer.approvals.find(
      (approval) => approval.approver.id === currentUserId && approval.decision === 'PENDING',
    );
    const earlierBlocked =
      myPendingStep !== undefined &&
      offer.approvals.some((approval) => approval.sequence < myPendingStep.sequence && approval.decision !== 'APPROVED');

    async function decide(decision: 'APPROVED' | 'REJECTED') {
      setBusy(true);
      setError(null);
      const result = await apiFetch(`/api/offers/${offer.id}/approvals`, { method: 'POST', json: { decision } });
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onChanged();
    }

    async function copyLink() {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}${offer.candidateLink}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setError('Could not copy — copy the link manually from the address below.');
      }
    }

    return (
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{offer.application.candidate.name}</h3>
            <p className="text-sm text-slate-500">{offer.application.job.title}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${DECISION_BADGES[offer.approvalState] ?? 'bg-slate-100 text-slate-600'}`}>
              {offer.approvalState.replaceAll('_', ' ')}
            </span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${DECISION_BADGES[offer.candidateDecision] ?? 'bg-slate-100 text-slate-600'}`}>
              Candidate: {offer.candidateDecision}
            </span>
          </div>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-slate-500">Base salary</dt>
            <dd className="font-medium text-slate-800">{money(offer.baseSalary, offer.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Band</dt>
            <dd className="text-slate-700">
              {money(offer.application.job.compBand.min, offer.application.job.compBand.currency)}–
              {money(offer.application.job.compBand.max, offer.application.job.compBand.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Start date</dt>
            <dd className="text-slate-700">{day(offer.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Expires</dt>
            <dd className="text-slate-700">{day(offer.expiresAt)}</dd>
          </div>
        </dl>

        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approval chain</p>
          <ul className="mt-1.5 space-y-1">
            {offer.approvals.map((approval) => (
              <li key={approval.sequence} className="flex items-center gap-2 text-sm text-slate-700">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_BADGES[approval.decision] ?? 'bg-slate-100 text-slate-600'}`}>
                  {approval.decision}
                </span>
                {approval.sequence}. {approval.approver.name}
                <span className="text-xs text-slate-400">({approval.approver.role.replaceAll('_', ' ').toLowerCase()})</span>
              </li>
            ))}
          </ul>

          {myPendingStep && !earlierBlocked && offer.approvalState === 'PENDING_APPROVAL' && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => decide('APPROVED')}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => decide('REJECTED')}
                disabled={busy}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
              >
                Reject
              </button>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-sm">
          <a
            href={`/api/offers/${offer.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-indigo-700 hover:underline"
          >
            Offer letter (PDF)
          </a>
          {offer.approvalState === 'APPROVED' && offer.candidateDecision === 'PENDING' && (
            <button type="button" onClick={copyLink} className="font-medium text-indigo-700 hover:underline">
              {copied ? 'Copied ✓' : 'Copy candidate link'}
            </button>
          )}
        </div>
      </article>
    );
  }

  // -------------------------------------------------------------- candidate
  const { offer, token, onDecided } = props;

  async function respond(decision: 'ACCEPTED' | 'DECLINED') {
    setBusy(true);
    setError(null);
    const result = await apiFetch(`/api/offers/${offer.id}/accept`, {
      method: 'POST',
      json: { token, decision },
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDecided();
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-500">Offer of employment for</p>
      <h2 className="text-xl font-bold text-slate-900">{offer.candidateName}</h2>
      <p className="mt-1 text-sm text-slate-600">
        {offer.jobTitle} · {offer.jobLocation}
      </p>

      <dl className="mt-5 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-slate-500">Annual base salary</dt>
          <dd className="text-lg font-semibold text-slate-900">{money(offer.baseSalary, offer.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Performance bonus</dt>
          <dd className="font-medium text-slate-800">
            {offer.bonusPercent === null ? 'Not applicable' : `Up to ${offer.bonusPercent}% of base`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Start date</dt>
          <dd className="font-medium text-slate-800">{day(offer.startDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Offer valid until</dt>
          <dd className="font-medium text-slate-800">{day(offer.expiresAt)}</dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {offer.candidateDecision === 'ACCEPTED' && (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">🎉 You have accepted this offer — welcome aboard!</p>
          {offer.onboardingToken && (
            <a
              href={`/onboarding/${offer.onboardingToken}`}
              className="mt-2 inline-block rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500"
            >
              Start your onboarding
            </a>
          )}
        </div>
      )}

      {offer.candidateDecision === 'DECLINED' && (
        <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          You declined this offer. If that was a mistake, contact the recruitment team.
        </p>
      )}

      {offer.candidateDecision === 'PENDING' && offer.expired && (
        <p className="mt-5 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
          This offer has expired. Please contact the recruitment team.
        </p>
      )}

      {offer.readyToDecide && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => respond('ACCEPTED')}
            disabled={busy}
            className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Accept offer'}
          </button>
          <button
            type="button"
            onClick={() => respond('DECLINED')}
            disabled={busy}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      )}

      {offer.candidateDecision === 'PENDING' && !offer.readyToDecide && !offer.expired && (
        <p className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          This offer is being finalised internally — you&apos;ll be able to respond here shortly.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-400">
        Formal execution of the employment contract happens electronically via DocuSign after acceptance.
      </p>
    </article>
  );
}
