'use client';

/**
 * Per-interview scorecard panel: lists submitted scorecards and, when the
 * current user is a panelist who has not yet submitted (or an HR admin),
 * shows the structured submission form (criterion → 1-5 ratings,
 * recommendation, notes). Backed by /api/interviews/[id]/scorecards.
 */

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { apiFetch, type SessionUser } from '@/lib/client';

interface ScorecardDto {
  id: string;
  interviewId: string;
  interviewer: { id: string; name: string; role: string };
  ratings: Record<string, number>;
  recommendation: string;
  notes: string | null;
  submittedAt: string;
}

interface ScorecardSectionProps {
  interviewId: string;
  interviewStatus: string;
  panelistIds: string[];
  user: SessionUser;
  /** Called after a successful submission so the parent can refresh counts. */
  onSubmitted: () => void;
}

const DEFAULT_CRITERIA = ['technical_depth', 'problem_solving', 'communication', 'culture_add'];

const RECOMMENDATION_OPTIONS = [
  { value: 'STRONG_YES', label: 'Strong yes' },
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
  { value: 'STRONG_NO', label: 'Strong no' },
];

const RECOMMENDATION_BADGES: Record<string, string> = {
  STRONG_YES: 'bg-emerald-100 text-emerald-800',
  YES: 'bg-emerald-50 text-emerald-700',
  NO: 'bg-rose-50 text-rose-700',
  STRONG_NO: 'bg-rose-100 text-rose-800',
};

function labelize(criterion: string): string {
  return criterion.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());
}

export default function ScorecardSection({
  interviewId,
  interviewStatus,
  panelistIds,
  user,
  onSubmitted,
}: ScorecardSectionProps) {
  const [scorecards, setScorecards] = useState<ScorecardDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [recommendation, setRecommendation] = useState('YES');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiFetch<ScorecardDto[]>(`/api/interviews/${interviewId}/scorecards`);
    if (result.ok) {
      setScorecards(result.data);
      setLoadError(null);
    } else {
      setLoadError(result.error.message);
    }
  }, [interviewId]);

  useEffect(() => {
    void load();
  }, [load]);

  const alreadySubmitted = scorecards?.some((scorecard) => scorecard.interviewer.id === user.id) ?? false;
  const maySubmit =
    (panelistIds.includes(user.id) || user.role === 'HR_ADMIN') &&
    !alreadySubmitted &&
    interviewStatus !== 'CANCELLED';

  function setRating(criterion: string, value: number) {
    setRatings((current) => ({ ...current, [criterion]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const rated = Object.fromEntries(Object.entries(ratings).filter(([, value]) => value >= 1));
    if (Object.keys(rated).length === 0) {
      setFormError('Rate at least one criterion.');
      return;
    }

    setSubmitting(true);
    const result = await apiFetch<ScorecardDto>(`/api/interviews/${interviewId}/scorecards`, {
      method: 'POST',
      json: {
        ratings: rated,
        recommendation,
        notes: notes.trim() ? notes.trim() : undefined,
      },
    });
    setSubmitting(false);

    if (!result.ok) {
      setFormError(result.error.message);
      return;
    }

    setRatings({});
    setNotes('');
    await load();
    onSubmitted();
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {loadError && <p className="text-xs text-rose-700">{loadError}</p>}

      {scorecards === null && !loadError ? (
        <p className="text-xs text-slate-500">Loading scorecards…</p>
      ) : scorecards && scorecards.length === 0 ? (
        <p className="text-xs text-slate-500">No scorecards submitted yet.</p>
      ) : (
        scorecards?.map((scorecard) => (
          <div key={scorecard.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800">{scorecard.interviewer.name}</p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  RECOMMENDATION_BADGES[scorecard.recommendation] ?? 'bg-slate-100 text-slate-600'
                }`}
              >
                {scorecard.recommendation.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(scorecard.ratings).map(([criterion, value]) => (
                <span key={criterion} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {labelize(criterion)}: <strong>{value}/5</strong>
                </span>
              ))}
            </div>
            {scorecard.notes && <p className="mt-2 text-xs text-slate-600">{scorecard.notes}</p>}
          </div>
        ))
      )}

      {maySubmit && (
        <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-indigo-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-900">Submit your scorecard</p>

          <div className="space-y-2">
            {DEFAULT_CRITERIA.map((criterion) => (
              <div key={criterion} className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-slate-700">{labelize(criterion)}</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRating(criterion, value)}
                      aria-label={`${labelize(criterion)}: ${value} of 5`}
                      className={`h-7 w-7 rounded-md text-xs font-semibold transition ${
                        (ratings[criterion] ?? 0) === value
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`rec-${interviewId}`} className="text-xs font-medium text-slate-700">
              Recommendation
            </label>
            <select
              id={`rec-${interviewId}`}
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {RECOMMENDATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />

          {formError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {formError}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit scorecard'}
          </button>
        </form>
      )}

      {alreadySubmitted && <p className="text-xs text-emerald-700">✓ You have submitted your scorecard.</p>}
    </div>
  );
}
