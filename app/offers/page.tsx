'use client';

/**
 * /offers — dual-purpose page:
 *  - With ?offer=<id>&token=<accessToken>: the public candidate acceptance
 *    view (no login; token validated by the API).
 *  - Without: the staff offer list with approval actions, PDF links, and
 *    copyable candidate links. Unauthenticated staff visits bounce to
 *    /login on the API 401.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OfferCard, { type CandidateOffer, type StaffOffer } from '@/components/offers/OfferCard';
import PageHeader from '@/components/ui/PageHeader';
import { apiFetch, clearStoredUser, getStoredUser } from '@/lib/client';

function CandidateOfferView({ offerId, token }: { offerId: string; token: string }) {
  const [offer, setOffer] = useState<CandidateOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/offers/${encodeURIComponent(offerId)}?token=${encodeURIComponent(token)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message ?? 'This offer link is invalid or has been revoked.');
      } else {
        setOffer(payload.data as CandidateOffer);
        setError(null);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [offerId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="py-16 text-center text-sm text-slate-500">Loading your offer…</p>;
  }
  if (error || !offer) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <p className="text-2xl font-bold text-brand-700">HR Portal</p>
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error ?? 'This offer link is invalid.'}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-4">
      <OfferCard mode="candidate" offer={offer} token={token} onDecided={load} />
    </div>
  );
}

function StaffOffersView() {
  const router = useRouter();
  const [offers, setOffers] = useState<StaffOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const currentUserId = getStoredUser()?.id ?? '';

  const load = useCallback(async () => {
    const result = await apiFetch<StaffOffer[]>('/api/offers');
    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      setError(result.error.message);
    } else {
      setOffers(result.data);
      setError(null);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleOffers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return offers.filter((offer) => {
      const statusMatches = statusFilter === 'ALL' || offer.approvalState === statusFilter;
      const queryMatches =
        !query ||
        [offer.application.candidate.name, offer.application.candidate.email, offer.application.job.title]
          .join(' ')
          .toLowerCase()
          .includes(query);
      return statusMatches && queryMatches;
    });
  }, [offers, search, statusFilter]);

  const header = (
    <PageHeader
      title="Offers"
      count={visibleOffers.length}
      subtitle="Approval chains, offer letters, and candidate acceptance links."
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <p className="py-10 text-center text-sm text-slate-500">Loading offers…</p>
      </>
    );
  }

  return (
    <div>
      {header}

      <div className="space-y-4">
        <div className="flex flex-col gap-3 rounded-card border border-slate-200 bg-white p-3 shadow-card sm:flex-row sm:justify-end">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter offers by approval status"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20"
          >
            <option value="ALL">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <label className="block sm:w-80">
            <span className="sr-only">Search offers</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search candidate, email, or job"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {visibleOffers.length === 0 && !error ? (
          <div className="rounded-card border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
            <p className="text-sm font-semibold text-slate-800">No matching offers</p>
            <p className="mt-1 text-sm text-slate-500">Try another status or search term.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleOffers.map((offer) => (
              <OfferCard key={offer.id} mode="staff" offer={offer} currentUserId={currentUserId} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OffersPageInner() {
  const searchParams = useSearchParams();
  const offerId = searchParams.get('offer');
  const token = searchParams.get('token');

  if (offerId && token) {
    return <CandidateOfferView offerId={offerId} token={token} />;
  }
  return <StaffOffersView />;
}

export default function OffersPage() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-sm text-slate-500">Loading…</p>}>
      <OffersPageInner />
    </Suspense>
  );
}
