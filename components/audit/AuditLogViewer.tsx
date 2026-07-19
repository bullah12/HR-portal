'use client';

/**
 * Audit-log table for DPO auditors and HR admins: filters on entity type,
 * actor, and date range, with simple page-based navigation. Data comes
 * from GET /api/audit-logs (role-restricted in middleware).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, clearStoredUser } from '@/lib/client';

interface AuditActor {
  id: string;
  name: string;
  role: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: unknown;
  timestamp: string;
  actor: AuditActor | null;
}

interface AuditLogPage {
  entries: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  entityTypes: string[];
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${date.toLocaleTimeString(
    'en-GB',
    { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  )}`;
}

export default function AuditLogViewer() {
  const router = useRouter();
  const [data, setData] = useState<AuditLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: '25' });
    if (entityType) params.set('entityType', entityType);
    if (from) params.set('from', new Date(`${from}T00:00:00Z`).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59Z`).toISOString());

    const result = await apiFetch<AuditLogPage>(`/api/audit-logs?${params.toString()}`);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else if (result.status === 401) {
      clearStoredUser();
      router.push('/login');
      return;
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [page, entityType, from, to, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const inputClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500';

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="audit-entity" className="mb-1 block text-xs font-medium text-slate-600">
            Entity type
          </label>
          <select
            id="audit-entity"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="">All entities</option>
            {(data?.entityTypes ?? []).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-from" className="mb-1 block text-xs font-medium text-slate-600">
            From
          </label>
          <input
            id="audit-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="audit-to" className="mb-1 block text-xs font-medium text-slate-600">
            To
          </label>
          <input
            id="audit-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
            className={inputClass}
          />
        </div>
        {(entityType || from || to) && (
          <button
            type="button"
            onClick={() => {
              setEntityType('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Clear filters
          </button>
        )}
        <p className="ml-auto text-xs text-slate-500">
          {data ? `${data.total} entr${data.total === 1 ? 'y' : 'ies'}` : ''}
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {loading && !data ? (
        <p className="py-10 text-center text-sm text-slate-500">Loading audit log…</p>
      ) : data && data.entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No audit entries match these filters.
        </p>
      ) : data ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-medium">Timestamp</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Entity</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatTimestamp(entry.timestamp)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-800">{entry.action}</td>
                  <td className="px-4 py-3 text-xs">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{entry.entityType}</span>
                    <span className="ml-1 font-mono text-slate-400">{entry.entityId.slice(0, 10)}…</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs">
                    {entry.actor ? (
                      <>
                        <span className="text-slate-800">{entry.actor.name}</span>
                        <span className="ml-1 text-slate-400">({entry.actor.role})</span>
                      </>
                    ) : (
                      <span className="italic text-slate-400">system</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {entry.detail != null && (
                      <button
                        type="button"
                        onClick={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        {expandedId === entry.id ? 'Hide' : 'Show'}
                      </button>
                    )}
                    {expandedId === entry.id && (
                      <pre className="mt-2 max-w-md overflow-x-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-snug text-slate-700">
                        {JSON.stringify(entry.detail, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-slate-500">
            Page {data.page} of {data.totalPages}
          </span>
          <button
            type="button"
            disabled={page >= data.totalPages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
