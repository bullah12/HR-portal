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

export default function JobList() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
                </span>
                <span>{job.publishedAt ? `Published ${formatDate(job.publishedAt)}` : `Created ${formatDate(job.createdAt)}`}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
