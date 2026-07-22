'use client';

/**
 * Dual-mode onboarding page: candidates arrive through a tokenized offer
 * link, while signed-in staff can open a candidate id from the Today view.
 * Candidate access remains read-only apart from document upload; recruiters
 * retain the existing staff task-management permissions.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import ChecklistView, { type ChecklistTask } from '@/components/onboarding/ChecklistView';
import DocumentUpload, { type OnboardingDocumentMeta } from '@/components/onboarding/DocumentUpload';
import { apiFetch, canManageRecruiting, getStoredUser, type SessionUser } from '@/lib/client';

interface PlanView {
  planId: string;
  candidateId: string;
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
  const [staffUser, setStaffUser] = useState<SessionUser | null>(null);
  const [staffMode, setStaffMode] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const load = useCallback(async (preferStaff = false) => {
    try {
      const staffPath = `/api/onboarding/${encodeURIComponent(params.token)}/tasks`;
      const candidatePath = `${staffPath}?token=${encodeURIComponent(params.token)}`;
      let response = await fetch(preferStaff ? staffPath : candidatePath);
      let payload = await response.json().catch(() => null);

      // A signed-in staff member may still open a candidate's tokenised link.
      // If the route segment is not a candidate id, fall back to token mode.
      if (preferStaff && [401, 403, 404].includes(response.status)) {
        response = await fetch(candidatePath);
        payload = await response.json().catch(() => null);
        setStaffMode(false);
      } else {
        setStaffMode(preferStaff && response.ok);
      }

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
    const storedUser = getStoredUser();
    setStaffUser(storedUser);
    void load(Boolean(storedUser));
  }, [load]);

  async function handleStatusChange(taskId: string, status: string) {
    if (!plan || !staffMode) return;
    setUpdatingTaskId(taskId);
    const result = await apiFetch<{ taskId: string; status: string; progressPercent: number }>(
      `/api/onboarding/${encodeURIComponent(plan.candidateId)}/tasks`,
      { method: 'PATCH', json: { taskId, status } },
    );
    setUpdatingTaskId(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load(true);
  }

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading your onboarding…</p>;
  }

  if (error || !plan) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-2xl font-bold text-brand-700">HR Portal</p>
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
      {staffMode && (
        <Link href="/" className="inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
          ← Back to Today
        </Link>
      )}

      <header className="relative overflow-hidden rounded-card bg-brand-700 p-6 text-white shadow-float sm:p-8">
        <div aria-hidden className="absolute -right-14 -top-16 h-48 w-48 rounded-full border-[32px] border-brand-500/30" />
        <div className="relative">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-100">
            {staffMode ? 'Onboarding plan' : 'Welcome aboard'}
          </p>
          <h1 className="mt-2 text-title text-white">{plan.candidateName}</h1>
          <p className="mt-1 text-sm text-brand-100">
            {plan.jobTitle} · {plan.jobLocation}
          </p>
          <p className="mt-4 text-sm font-semibold text-white">
            {staffMode ? `Starts ${startDate}` : `Your first day is ${startDate} 🎉`}
          </p>
        </div>
      </header>

      <ChecklistView
        tasks={plan.tasks}
        progressPercent={plan.progressPercent}
        editable={Boolean(staffMode && staffUser && canManageRecruiting(staffUser.role))}
        onStatusChange={handleStatusChange}
        updatingTaskId={updatingTaskId}
      />

      {(!staffMode || (staffUser && canManageRecruiting(staffUser.role))) && (
        <DocumentUpload
          planKey={staffMode ? plan.candidateId : params.token}
          token={staffMode ? undefined : params.token}
          tasks={plan.tasks}
          documents={plan.documents}
          onUploaded={() => load(staffMode)}
        />
      )}

      {!staffMode && (
        <p className="pb-8 text-center text-xs text-slate-400">
          Questions? Reply to any email from the recruitment team and we&apos;ll help you out.
        </p>
      )}
    </div>
  );
}
