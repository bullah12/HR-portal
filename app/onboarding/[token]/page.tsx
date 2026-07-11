'use client';

/**
 * Public onboarding page — reached via the tokenized link from offer
 * acceptance. No login required; the token both addresses and authorises
 * the plan (candidates see their own flow only). Checklist is read-only
 * here; documents can be uploaded and linked to checklist items.
 */

import { useCallback, useEffect, useState } from 'react';
import ChecklistView, { type ChecklistTask } from '@/components/onboarding/ChecklistView';
import DocumentUpload, { type OnboardingDocumentMeta } from '@/components/onboarding/DocumentUpload';

interface PlanView {
  planId: string;
  candidateName: string;
  jobTitle: string;
  jobLocation: string;
  startDate: string;
  progressPercent: number;
  tasks: ChecklistTask[];
  documents: OnboardingDocumentMeta[];
}

export default function OnboardingPage({ params }: { params: { token: string } }) {
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/onboarding/${encodeURIComponent(params.token)}/tasks?token=${encodeURIComponent(params.token)}`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message ?? 'This onboarding link is invalid or has been revoked.');
      } else {
        setPlan(payload.data as PlanView);
        setError(null);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [params.token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading your onboarding…</p>;
  }

  if (error || !plan) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-2xl font-bold text-indigo-700">HR Portal</p>
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error ?? 'This onboarding link is invalid.'}
        </p>
      </div>
    );
  }

  const startDate = new Date(plan.startDate).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="rounded-xl bg-indigo-600 p-6 text-white shadow-sm">
        <p className="text-sm text-indigo-200">Welcome aboard</p>
        <h1 className="mt-1 text-2xl font-bold">{plan.candidateName}</h1>
        <p className="mt-1 text-sm text-indigo-100">
          {plan.jobTitle} · {plan.jobLocation}
        </p>
        <p className="mt-3 text-sm font-medium text-white">Your first day is {startDate} 🎉</p>
      </header>

      <ChecklistView tasks={plan.tasks} progressPercent={plan.progressPercent} editable={false} />

      <DocumentUpload
        planKey={params.token}
        token={params.token}
        tasks={plan.tasks}
        documents={plan.documents}
        onUploaded={load}
      />

      <p className="pb-8 text-center text-xs text-slate-400">
        Questions? Reply to any email from the recruitment team and we&apos;ll help you out.
      </p>
    </div>
  );
}
