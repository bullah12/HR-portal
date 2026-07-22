import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  /** Live item count rendered muted next to the title, e.g. Candidates · 148. */
  count?: number;
  /** Optional supporting line under the title. */
  subtitle?: string;
  /** Right-aligned area — typically a primary <Button> or a search + filter row. */
  actions?: ReactNode;
}

/**
 * Standard header block for every list screen (Jobs, Candidates, Interviews,
 * Offers). Fixes the inconsistency where some screens had a title + subtitle
 * and others dropped straight into content with no context or count.
 *
 *   <PageHeader title="Candidates" count={candidates.length}
 *     actions={<Button>+ Add candidate</Button>} />
 */
export default function PageHeader({ title, count, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2.5 text-title text-slate-950">
          {title}
          {typeof count === 'number' && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-500">{count}</span>
          )}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
