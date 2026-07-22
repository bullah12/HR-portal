import { resolveStatus, TONE_STYLES, type StatusKind } from '@/lib/status';

interface StatusPillProps {
  kind: StatusKind;
  /** Raw enum string from the API, e.g. 'PENDING_APPROVAL'. */
  value: string;
  /** Optional label prefix, e.g. "Candidate: Accepted". */
  prefix?: string;
  className?: string;
}

/**
 * The one badge component. Replaces every hand-rolled STATUS_BADGES /
 * DECISION_BADGES map. Colour comes with a dot so status is not conveyed by
 * colour alone (accessibility).
 *
 *   <StatusPill kind="job" value={job.status} />
 *   <StatusPill kind="candidateDecision" value={offer.candidateDecision} prefix="Candidate" />
 */
export default function StatusPill({ kind, value, prefix, className = '' }: StatusPillProps) {
  const { label, tone } = resolveStatus(kind, value);
  const style = TONE_STYLES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: style.dot }}
      />
      {prefix ? `${prefix}: ${label}` : label}
    </span>
  );
}
