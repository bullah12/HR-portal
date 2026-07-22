'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import StatusPill from '@/components/ui/StatusPill';
import { apiFetch, clearStoredUser, getStoredUser, ROLE_LABELS, type SessionUser } from '@/lib/client';
import type { TodayDashboardDto } from '@/lib/dashboard';

const EMPTY_DASHBOARD: TodayDashboardDto = {
  approvals: [],
  interviews: [],
  recentCvs: [],
  overdueTasks: [],
};

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

function humanise(value: string): string {
  const lower = value.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default function TodayDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dashboard, setDashboard] = useState<TodayDashboardDto>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const localNow = new Date();
    const dayStart = new Date(localNow);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const query = new URLSearchParams({
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString(),
    });
    const result = await apiFetch<TodayDashboardDto>(`/api/today?${query.toString()}`);
    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      setError(result.error.message);
    } else {
      setDashboard(result.data);
      setError(null);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    setUser(getStoredUser());
    setNow(new Date());
    void load();
  }, [load]);

  const cvGroups = useMemo(() => {
    const groups = new Map<string, { jobId: string; jobTitle: string; count: number }>();
    for (const cv of dashboard.recentCvs) {
      const current = groups.get(cv.jobId);
      groups.set(cv.jobId, {
        jobId: cv.jobId,
        jobTitle: cv.jobTitle,
        count: (current?.count ?? 0) + 1,
      });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }, [dashboard.recentCvs]);

  const firstName = user?.name.split(/\s+/)[0] ?? 'there';
  const dateLine = now?.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const actionCount = dashboard.approvals.length + cvGroups.length + dashboard.overdueTasks.length;

  if (loading) {
    return (
      <div className="animate-pulse space-y-6" aria-label="Loading today’s dashboard">
        <div className="h-16 max-w-md rounded-xl bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-28 rounded-card border border-slate-200 bg-white" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <div className="h-80 rounded-card border border-slate-200 bg-white" />
          <div className="h-80 rounded-card border border-slate-200 bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Today</p>
          <h1 className="mt-2 text-display text-slate-950">
            {greeting(now?.getHours() ?? 12)}, {firstName}.
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {dateLine} · {user ? ROLE_LABELS[user.role] : 'Your workspace'}
          </p>
        </div>
        {actionCount > 0 && (
          <p className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">
            {actionCount} item{actionCount === 1 ? '' : 's'} need attention
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </p>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" aria-label="Today’s recruitment summary">
        {[
          { value: dashboard.approvals.length, label: 'Offers awaiting your approval' },
          { value: dashboard.interviews.length, label: 'Interviews today' },
          { value: dashboard.recentCvs.length, label: 'CVs uploaded in 24 hours' },
          { value: dashboard.overdueTasks.length, label: 'Onboarding overdue', alert: true },
        ].map((stat) => (
          <article key={stat.label} className="rounded-card border border-slate-200 bg-white p-4 shadow-card sm:p-5">
            <p className={`text-3xl font-bold tracking-tight ${stat.alert && stat.value > 0 ? 'text-rose-700' : 'text-slate-950'}`}>
              {stat.value}
            </p>
            <p className="mt-1 text-[13px] leading-5 text-slate-500">{stat.label}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="rounded-card border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-section text-slate-950">Needs your action</h2>
              <p className="mt-0.5 text-xs text-slate-400">Prioritised work from across the hiring flow</p>
            </div>
            <span className="font-mono text-xs text-slate-400">{actionCount.toString().padStart(2, '0')}</span>
          </div>

          {actionCount === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700">✓</div>
              <p className="mt-3 text-sm font-semibold text-slate-800">You’re all caught up</p>
              <p className="mt-1 text-sm text-slate-500">No approvals, new CV batches, or overdue onboarding tasks.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 px-5">
              {dashboard.approvals.map((approval) => (
                <Link key={approval.offerId} href="/offers" className="group flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                      Approve offer — {approval.candidateName}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {approval.jobTitle} · {money(approval.baseSalary, approval.currency)}
                    </p>
                  </div>
                  <StatusPill kind="offerApproval" value="PENDING" prefix="Your step" className="shrink-0" />
                </Link>
              ))}

              {cvGroups.map((group) => (
                <Link key={group.jobId} href="/candidates" className="group flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                      Screen {group.count} new CV{group.count === 1 ? '' : 's'} — {group.jobTitle}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">Uploaded in the last 24 hours</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-brand-600">Review →</span>
                </Link>
              ))}

              {dashboard.overdueTasks.map((task) => {
                const overdueDays = Math.max(1, Math.ceil((Date.now() - new Date(task.dueDate).getTime()) / 86400000));
                return (
                  <Link
                    key={task.taskId}
                    href={`/onboarding/${task.candidateId}`}
                    className="group flex items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 group-hover:text-brand-700">
                        Onboarding stalled — {task.candidateName}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-400">
                        {task.title} · overdue {overdueDays} day{overdueDays === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">Overdue</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-card border border-slate-200 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-section text-slate-950">Today’s interviews</h2>
              <p className="mt-0.5 text-xs text-slate-400">Your agenda at a glance</p>
            </div>
            <Link href="/interviews" className="text-xs font-semibold text-brand-600 hover:text-brand-700">View agenda</Link>
          </div>

          {dashboard.interviews.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-semibold text-slate-800">No interviews today</p>
              <p className="mt-1 text-sm text-slate-500">Your calendar is clear.</p>
            </div>
          ) : (
            <ol className="divide-y divide-slate-100 px-5">
              {dashboard.interviews.map((interview) => (
                <li key={interview.id} className="flex gap-4 py-4">
                  <time className="w-12 shrink-0 pt-0.5 font-mono text-xs font-semibold text-brand-600">
                    {new Date(interview.slotStart).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{interview.candidateName}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {humanise(interview.type)} · {minutesBetween(interview.slotStart, interview.slotEnd)} min · {interview.jobTitle}
                    </p>
                  </div>
                  <StatusPill kind="interview" value={interview.status} className="hidden shrink-0 sm:inline-flex" />
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
