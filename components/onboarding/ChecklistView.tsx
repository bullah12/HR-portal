'use client';

/**
 * Visual onboarding checklist: progress bar + tasks grouped by category.
 * Read-only for candidates; HR gets a status selector per task
 * (spec: "editable by HR, viewable by candidate").
 */

export interface ChecklistTask {
  id: string;
  title: string;
  category: string;
  status: string;
  requiresDocument: boolean;
  dueDate: string;
  docRef?: string | null;
  completedAt?: string | null;
  owner?: { id: string; name: string };
}

const CATEGORY_ORDER = ['DOCUMENTS', 'IT_PROVISIONING', 'TRAINING', 'OTHER'];

const CATEGORY_LABELS: Record<string, string> = {
  DOCUMENTS: 'Documents',
  IT_PROVISIONING: 'IT provisioning',
  TRAINING: 'Training',
  OTHER: 'Other',
};

const STATUS_BADGES: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  BLOCKED: 'bg-rose-100 text-rose-700',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  BLOCKED: 'Blocked',
};

const STATUS_OPTIONS = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'];

interface ChecklistViewProps {
  tasks: ChecklistTask[];
  progressPercent: number;
  editable: boolean;
  onStatusChange?: (taskId: string, status: string) => void;
  updatingTaskId?: string | null;
}

function formatDue(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ChecklistView({
  tasks,
  progressPercent,
  editable,
  onStatusChange,
  updatingTaskId,
}: ChecklistViewProps) {
  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    tasks: tasks.filter((task) => task.category === category),
  })).filter((group) => group.tasks.length > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">Onboarding checklist</h2>
        <span className="text-sm font-semibold text-indigo-700">{progressPercent}% complete</span>
      </div>

      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="mt-5 space-y-5">
        {groups.map((group) => (
          <div key={group.category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {CATEGORY_LABELS[group.category] ?? group.category}
            </h3>
            <ul className="space-y-2">
              {group.tasks.map((task) => {
                const done = task.status === 'COMPLETED';
                return (
                  <li
                    key={task.id}
                    className="flex flex-col gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          done ? 'bg-emerald-500 text-white' : 'border-2 border-slate-300 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                      <div>
                        <p className={`text-sm font-medium ${done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                          {task.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          Due {formatDue(task.dueDate)}
                          {task.requiresDocument && !done && ' · document required'}
                          {task.owner && ` · owner: ${task.owner.name}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pl-8 sm:pl-0">
                      {editable && onStatusChange ? (
                        <select
                          value={task.status}
                          disabled={updatingTaskId === task.id}
                          onChange={(event) => onStatusChange(task.id, event.target.value)}
                          aria-label={`Status for ${task.title}`}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium disabled:opacity-60"
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGES[task.status] ?? 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {STATUS_LABELS[task.status] ?? task.status}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
