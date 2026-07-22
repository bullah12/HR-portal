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
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-title text-slate-900">
          {title}
          {typeof count === 'number' && (
            <span className="ml-2 text-base font-medium text-slate-400">· {count}</span>
          )}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
