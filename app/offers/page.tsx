'use client';

/**
 * /offers — dual-purpose page:
 *  - With ?offer=<id>&token=<accessToken>: the public candidate acceptance
 *    view (no login; token validated by the API).
 *  - Without: the staff offer list with approval actions, PDF links, and
 *    copyable candidate links. Unauthenticated staff visits bounce to
 *    /login on the API 401.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OfferCard, { type CandidateOffer, type StaffOffer } from '@/components/offers/OfferCard';
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
        <p className="text-2xl font-bold text-indigo-700">HR Portal</p>
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

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">Loading offers…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Offers</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Approval chains, offer letters, and candidate acceptance links.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {offers.length === 0 && !error ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          No offers yet.
        </p>
      ) : (
        <div className="space-y-4">
          {offers.map((offer) => (
            <OfferCard key={offer.id} mode="staff" offer={offer} currentUserId={currentUserId} onChanged={load} />
          ))}
        </div>
      )}
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
