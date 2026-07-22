'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import StatusPill from '@/components/ui/StatusPill';
import { apiFetch, clearStoredUser, formatDate } from '@/lib/client';
import type { CandidateDto } from '@/lib/types';

type SortKey = 'name' | 'source' | 'applicationCount' | 'createdAt';
type SortDirection = 'asc' | 'desc';

const SOURCE_LABELS: Record<string, string> = {
  CAREERS_PAGE: 'Careers page',
  JOB_BOARD: 'Job board',
  REFERRAL: 'Referral',
  AGENCY: 'Agency',
  DIRECT_SOURCING: 'Direct sourcing',
};

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'source', label: 'Source' },
  { key: 'applicationCount', label: 'Applications' },
  { key: 'createdAt', label: 'Added' },
];

function compare(a: CandidateDto, b: CandidateDto, key: SortKey): number {
  switch (key) {
    case 'name':
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    case 'source':
      return a.source.localeCompare(b.source);
    case 'applicationCount':
      return a.applicationCount - b.applicationCount;
    case 'createdAt':
      return a.createdAt.localeCompare(b.createdAt);
  }
}

export default function CandidateList() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<CandidateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await apiFetch<CandidateDto[]>('/api/candidates');
      if (cancelled) return;

      if (!result.ok) {
        if (result.status === 401) {
          clearStoredUser();
          router.push('/login');
          return;
        }
        setError(result.error.message);
      } else {
        setCandidates(result.data);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const sorted = useMemo(() => {
    const copy = [...candidates];
    copy.sort((a, b) => {
      const order = compare(a, b, sortKey);
      return sortDirection === 'asc' ? order : -order;
    });
    return copy;
  }, [candidates, sortKey, sortDirection]);

  const visibleCandidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sorted;
    return sorted.filter((candidate) =>
      [candidate.firstName, candidate.lastName, candidate.email, candidate.location ?? '', SOURCE_LABELS[candidate.source] ?? candidate.source]
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [search, sorted]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection(key === 'createdAt' ? 'desc' : 'asc');
    }
  }

  function sortIndicator(key: SortKey): string {
    if (key !== sortKey) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  }

  const header = (
    <PageHeader
      title="Candidates"
      count={visibleCandidates.length}
      subtitle="Everyone in the pipeline, with consent status at a glance."
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <p className="py-10 text-center text-sm text-slate-500">Loading candidates…</p>
      </>
    );
  }

  if (error) {
    return (
      <>
        {header}
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      </>
    );
  }

  if (candidates.length === 0) {
    return (
      <>
        {header}
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No candidates yet.
        </p>
      </>
    );
  }

  return (
    <div>
      {header}
      <section>
        <div className="mb-4 flex justify-end rounded-card border border-slate-200 bg-white p-3 shadow-card">
          <label className="relative block w-full sm:max-w-sm">
            <span className="sr-only">Search candidates</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, source, or location"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        </div>

        {visibleCandidates.length === 0 ? (
          <div className="rounded-card border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-800">No matching candidates</p>
            <p className="mt-1 text-sm text-slate-500">Try a broader name, source, or location.</p>
          </div>
        ) : (
          <>
            {/* Desktop: sortable table */}
            <div className="hidden overflow-hidden rounded-card border border-slate-200 bg-white shadow-card md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    {COLUMNS.map((column) => (
                      <th key={column.key} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className="font-semibold hover:text-slate-800"
                        >
                          {column.label}
                          {sortIndicator(column.key)}
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-3 font-semibold">Consent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleCandidates.map((candidate) => (
                    <tr key={candidate.id} className="transition hover:bg-brand-50/50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/candidates/${candidate.id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {candidate.firstName} {candidate.lastName}
                        </Link>
                        <p className="text-xs text-slate-500">{candidate.email}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {SOURCE_LABELS[candidate.source] ?? candidate.source}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{candidate.applicationCount}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(candidate.createdAt)}</td>
                      <td className="px-4 py-3">
                        <StatusPill kind="consent" value={candidate.consentStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards with a sort selector */}
            <div className="space-y-3 md:hidden">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                Sort by
                <select
                  value={`${sortKey}:${sortDirection}`}
                  onChange={(event) => {
                    const [key, direction] = event.target.value.split(':') as [SortKey, SortDirection];
                    setSortKey(key);
                    setSortDirection(direction);
                  }}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="createdAt:desc">Newest first</option>
                  <option value="createdAt:asc">Oldest first</option>
                  <option value="name:asc">Name A–Z</option>
                  <option value="name:desc">Name Z–A</option>
                  <option value="applicationCount:desc">Most applications</option>
                  <option value="source:asc">Source</option>
                </select>
              </label>

              <ul className="space-y-3">
                {visibleCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      href={`/candidates/${candidate.id}`}
                      className="block rounded-card border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-500"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {candidate.firstName} {candidate.lastName}
                        </p>
                        <StatusPill kind="consent" value={candidate.consentStatus} />
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">{candidate.email}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                        <span>{SOURCE_LABELS[candidate.source] ?? candidate.source}</span>
                        <span>
                          {candidate.applicationCount} application{candidate.applicationCount === 1 ? '' : 's'} ·{' '}
                          {formatDate(candidate.createdAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
