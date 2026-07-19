'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import StatusPill from '@/components/ui/StatusPill';
import {
  apiFetch,
  canManageRecruiting,
  clearStoredUser,
  formatCompBand,
  formatDate,
  getStoredUser,
  type SessionUser,
} from '@/lib/client';
import { resolveStatus } from '@/lib/status';
import type { JobDto, JobStatus } from '@/lib/types';
import { JOB_STATUSES } from '@/lib/types';

type StatusFilter = 'ALL' | JobStatus;

interface RankingEntry {
  rank: number;
  applicationId: string;
  candidateLabel: string;
  masked: boolean;
  totalScore: number;
  capApplied: boolean;
  stage: string;
}

export default function JobList() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [rankingOpenFor, setRankingOpenFor] = useState<string | null>(null);
  const [rankings, setRankings] = useState<Record<string, RankingEntry[]>>({});
  const [rankingError, setRankingError] = useState<string | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const query = statusFilter === 'ALL' ? '' : `?status=${statusFilter}`;
      const result = await apiFetch<JobDto[]>(`/api/jobs${query}`);
      if (cancelled) return;

      if (!result.ok) {
        if (result.status === 401) {
          clearStoredUser();
          router.push('/login');
          return;
        }
        setError(result.error.message);
      } else {
        setJobs(result.data);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, router]);

  const filters: StatusFilter[] = ['ALL', ...JOB_STATUSES];
  const visibleJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) =>
      [job.title, job.location, ...job.mustHaveSkills, ...job.niceToHaveSkills].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [jobs, search]);

  const statusActions: Partial<Record<JobStatus, Array<{ label: string; to: JobStatus }>>> = {
    DRAFT: [
      { label: 'Submit for approval', to: 'PENDING_APPROVAL' },
      { label: 'Publish', to: 'PUBLISHED' },
    ],
    PENDING_APPROVAL: [{ label: 'Publish', to: 'PUBLISHED' }],
    PUBLISHED: [{ label: 'Close', to: 'CLOSED' }],
  };

  async function handleStatusChange(job: JobDto, to: JobStatus) {
    if (to === 'CLOSED' && !window.confirm(`Close "${job.title}"? A closed job can no longer be edited.`)) {
      return;
    }

    setUpdatingId(job.id);
    setError(null);
    const result = await apiFetch<JobDto>(`/api/jobs/${job.id}`, { method: 'PATCH', json: { status: to } });
    setUpdatingId(null);

    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      setError(result.error.message);
      return;
    }

    setJobs((current) => current.map((entry) => (entry.id === job.id ? result.data : entry)));
  }

  async function toggleRanking(jobId: string) {
    if (rankingOpenFor === jobId) {
      setRankingOpenFor(null);
      return;
    }

    setRankingError(null);
    setRankingOpenFor(jobId);
    if (!rankings[jobId]) {
      const result = await apiFetch<{ ranking: RankingEntry[] }>(`/api/jobs/${jobId}/ranking`);
      if (result.ok) {
        setRankings((current) => ({ ...current, [jobId]: result.data.ranking }));
      } else {
        setRankingError(result.error.message);
        setRankingOpenFor(null);
      }
    }
  }

  return (
    <section>
      <PageHeader
        title="Jobs"
        count={visibleJobs.length}
        subtitle="Open requisitions and their pipeline activity."
        actions={
          user && canManageRecruiting(user.role) ? (
            <Button onClick={() => router.push('/jobs/new')}>+ New job</Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-card border border-slate-200 bg-white p-3 shadow-card lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === filter
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {filter === 'ALL' ? 'All' : resolveStatus('job', filter).label}
              </button>
            ))}
          </div>
          <label className="relative block lg:w-72">
            <span className="sr-only">Search jobs</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, location, or skill"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        </div>

        {loading && <p className="py-10 text-center text-sm text-slate-500">Loading jobs…</p>}

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {!loading && !error && visibleJobs.length === 0 && (
          <div className="rounded-card border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-800">No matching jobs</p>
            <p className="mt-1 text-sm text-slate-500">Try another status or search term.</p>
          </div>
        )}

        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visibleJobs.map((job) => (
            <li key={job.id} className="group rounded-card border border-slate-200 bg-white p-5 shadow-card transition hover:border-brand-100 hover:shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">{job.title}</h2>
                <StatusPill kind="job" value={job.status} className="shrink-0" />
              </div>

              <p className="mt-1.5 text-sm text-slate-500">{job.location}</p>
              <p className="mt-1 text-sm font-medium text-slate-700">
                {formatCompBand(job.compBandMin, job.compBandMax, job.compBandCurrency)}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {job.mustHaveSkills.map((skill) => (
                  <span key={skill} className="rounded-md bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                    {skill}
                  </span>
                ))}
                {job.niceToHaveSkills.map((skill) => (
                  <span key={skill} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {skill}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>
                  {job.applicationCount} application{job.applicationCount === 1 ? '' : 's'}
                  {job.applicationCount > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleRanking(job.id)}
                      className="ml-2 font-semibold text-brand-600 hover:text-brand-700"
                    >
                      {rankingOpenFor === job.id ? 'Hide ranking' : 'View ranking'}
                    </button>
                  )}
                </span>
                <span>{job.publishedAt ? `Published ${formatDate(job.publishedAt)}` : `Created ${formatDate(job.createdAt)}`}</span>
              </div>

              {rankingOpenFor === job.id && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {rankingError && <p className="text-xs text-rose-700">{rankingError}</p>}
                  {!rankings[job.id] ? (
                    <p className="text-xs text-slate-500">Loading ranking…</p>
                  ) : rankings[job.id].length === 0 ? (
                    <p className="text-xs text-slate-500">No scored applications yet — parse a CV first.</p>
                  ) : (
                    <ol className="space-y-1">
                      {rankings[job.id].map((entry) => (
                        <li key={entry.applicationId} className="flex items-center justify-between gap-3 text-xs">
                          <span className="min-w-0 truncate text-slate-700">
                            <span className="font-semibold">#{entry.rank}</span>{' '}
                            {entry.masked ? (
                              <em title="Bias controls: identity masked">{entry.candidateLabel}</em>
                            ) : (
                              entry.candidateLabel
                            )}
                          </span>
                          <span className="shrink-0 text-slate-500">
                            {entry.totalScore}/100{entry.capApplied ? ' (capped)' : ''} · {entry.stage}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <p className="mt-2 text-[11px] text-slate-400">
                    Decision-support only — stage changes are always recorded by a human.
                  </p>
                </div>
              )}

              {user && canManageRecruiting(user.role) && (statusActions[job.status] ?? []).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {(statusActions[job.status] ?? []).map((action) => (
                    <Button
                      key={action.to}
                      variant={action.to === 'CLOSED' ? 'danger' : 'secondary'}
                      size="sm"
                      disabled={updatingId === job.id}
                      onClick={() => handleStatusChange(job, action.to)}
                    >
                      {updatingId === job.id ? 'Updating…' : action.label}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
