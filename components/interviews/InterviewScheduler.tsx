'use client';

/**
 * Day-grouped interview agenda with an on-demand scheduling slide-over.
 * All scheduling, validation, role checks, conflict handling, calendar, and
 * cancellation behavior is preserved from the original always-open form.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import PageHeader from '@/components/ui/PageHeader';
import StatusPill from '@/components/ui/StatusPill';
import {
  apiFetch,
  canManageRecruiting,
  clearStoredUser,
  getStoredUser,
  type SessionUser,
} from '@/lib/client';
import type { CandidateDto, JobDto } from '@/lib/types';

interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
}

interface InterviewListItem {
  id: string;
  type: string;
  status: string;
  slotStart: string;
  slotEnd: string;
  videoLink: string | null;
  application: {
    id: string;
    stage: string;
    candidate: { id: string; name: string };
    job: { id: string; title: string; location: string };
  };
  panelists: Array<{ id: string; name: string }>;
  scorecardCount: number;
}

interface ScheduleResult {
  interview: InterviewListItem;
  calendar: { provider: string; eventId: string; videoLink: string | null };
  emailPreview: { to: string; subject: string };
}

const TYPE_OPTIONS = [
  { value: 'PHONE_SCREEN', label: 'Phone screen' },
  { value: 'TECHNICAL', label: 'Technical' },
  { value: 'PANEL', label: 'Panel' },
  { value: 'HIRING_MANAGER', label: 'Hiring manager' },
  { value: 'FINAL', label: 'Final' },
];

const DURATION_OPTIONS = [30, 45, 60, 90];

function formatSlot(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const from = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const to = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${from}–${to}`;
}

function localDayKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const prefix = target.getTime() === today.getTime() ? 'Today · ' : target.getTime() === tomorrow.getTime() ? 'Tomorrow · ' : '';
  return `${prefix}${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

function typeLabel(value: string): string {
  return TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value.replaceAll('_', ' ').toLowerCase();
}

export default function InterviewScheduler() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [candidates, setCandidates] = useState<CandidateDto[]>([]);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [interviews, setInterviews] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState('');
  const [type, setType] = useState('TECHNICAL');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(60);
  const [panelistIds, setPanelistIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastScheduled, setLastScheduled] = useState<ScheduleResult | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const isRecruiting = user !== null && canManageRecruiting(user.role);

  const loadInterviews = useCallback(async () => {
    const result = await apiFetch<InterviewListItem[]>('/api/interviews');
    if (result.ok) {
      setInterviews(result.data);
      setListError(null);
    } else if (result.status === 401) {
      clearStoredUser();
      router.push('/login');
    } else {
      setListError(result.error.message);
    }
  }, [router]);

  useEffect(() => {
    const storedUser = getStoredUser();
    setUser(storedUser);

    async function load() {
      const wantsForm = storedUser !== null && canManageRecruiting(storedUser.role);
      const [interviewsDone, candidatesResult, jobsResult, staffResult] = await Promise.all([
        loadInterviews(),
        wantsForm ? apiFetch<CandidateDto[]>('/api/candidates') : Promise.resolve(null),
        wantsForm ? apiFetch<JobDto[]>('/api/jobs') : Promise.resolve(null),
        wantsForm ? apiFetch<StaffUser[]>('/api/users') : Promise.resolve(null),
      ]);
      void interviewsDone;
      if (candidatesResult?.ok) setCandidates(candidatesResult.data);
      if (jobsResult?.ok) setJobs(jobsResult.data);
      if (staffResult?.ok) setStaff(staffResult.data);
      setLoading(false);
    }

    void load();
  }, [loadInterviews]);

  useEffect(() => {
    if (!scheduleOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setScheduleOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [scheduleOpen]);

  const groupedInterviews = useMemo(() => {
    const groups = new Map<string, InterviewListItem[]>();
    for (const interview of interviews) {
      const key = localDayKey(interview.slotStart);
      groups.set(key, [...(groups.get(key) ?? []), interview]);
    }
    return [...groups.entries()].map(([key, items]) => ({ key, label: dayLabel(items[0].slotStart), items }));
  }, [interviews]);

  function togglePanelist(id: string) {
    setPanelistIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setConflicts([]);
    setLastScheduled(null);

    if (!candidateId || !jobId) {
      setFormError('Select a candidate and a job.');
      return;
    }
    if (!date || !time) {
      setFormError('Pick a date and start time.');
      return;
    }
    if (panelistIds.length === 0) {
      setFormError('Select at least one panelist.');
      return;
    }
    const slotStart = new Date(`${date}T${time}:00`);
    if (Number.isNaN(slotStart.getTime()) || slotStart <= new Date()) {
      setFormError('The slot must be in the future.');
      return;
    }
    const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

    setSubmitting(true);
    const result = await apiFetch<ScheduleResult>('/api/interviews', {
      method: 'POST',
      json: {
        candidateId,
        jobId,
        type,
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        panelistIds,
      },
    });
    setSubmitting(false);

    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      if (result.error.code === 'PANEL_CONFLICT') {
        const details = result.error.details as
          | { conflicts: Array<{ slotStart: string; slotEnd: string; panelists: string[] }> }
          | undefined;
        setConflicts(
          (details?.conflicts ?? []).map(
            (conflict) => `${conflict.panelists.join(', ')} — busy ${formatSlot(conflict.slotStart, conflict.slotEnd)}`,
          ),
        );
      }
      setFormError(result.error.message);
      return;
    }

    setLastScheduled(result.data);
    setCandidateId('');
    setPanelistIds([]);
    await loadInterviews();
  }

  async function handleCancel(interviewId: string) {
    setCancellingId(interviewId);
    const result = await apiFetch<{ id: string }>(`/api/interviews/${interviewId}/cancel`, { method: 'POST' });
    setCancellingId(null);
    if (result.ok) {
      await loadInterviews();
    } else {
      setListError(result.error.message);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20';

  const header = (
    <PageHeader
      title="Interviews"
      count={interviews.length}
      subtitle="A day-by-day view of candidate conversations and panel commitments."
      actions={isRecruiting ? <Button onClick={() => setScheduleOpen(true)}>+ Schedule interview</Button> : undefined}
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <p className="py-10 text-center text-sm text-slate-500">Loading interviews…</p>
      </>
    );
  }

  return (
    <div>
      {header}

      {listError && (
        <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {listError}
        </p>
      )}

      {groupedInterviews.length === 0 ? (
        <section className="rounded-card border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-card">
          <p className="text-base font-semibold text-slate-900">No interviews scheduled</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            When interviews are booked, they’ll appear here grouped by day and time.
          </p>
          {isRecruiting && (
            <Button className="mt-5" onClick={() => setScheduleOpen(true)}>
              Schedule the first interview
            </Button>
          )}
        </section>
      ) : (
        <section className="space-y-7" aria-label={isRecruiting ? 'All interviews' : 'Your interviews'}>
          {groupedInterviews.map((group) => (
            <div key={group.key}>
              <h2 className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-slate-400">
                {group.label}
              </h2>
              <ul className="space-y-2">
                {group.items.map((interview) => (
                  <li
                    key={interview.id}
                    className="grid gap-3 rounded-card border border-slate-200 bg-white p-4 shadow-card transition hover:border-brand-100 hover:shadow-sm sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center"
                  >
                    <time className="font-mono text-sm font-semibold text-brand-600">
                      {new Date(interview.slotStart).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </time>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {interview.application.candidate.name}
                        <span className="font-normal text-slate-400"> — {interview.application.job.title}</span>
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {typeLabel(interview.type)} · {durationMinutes(interview.slotStart, interview.slotEnd)} min · panel:{' '}
                        {interview.panelists.map((panelist) => panelist.name).join(', ')}
                      </p>
                      {interview.videoLink && interview.status !== 'CANCELLED' && (
                        <a
                          href={interview.videoLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex text-xs font-semibold text-brand-600 hover:text-brand-700"
                        >
                          Join video call →
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2 sm:justify-end">
                      <StatusPill kind="interview" value={interview.status} />
                      {isRecruiting && ['SCHEDULED', 'RESCHEDULED'].includes(interview.status) && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleCancel(interview.id)}
                          disabled={cancellingId === interview.id}
                        >
                          {cancellingId === interview.id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {isRecruiting && scheduleOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close scheduling panel"
            onClick={() => setScheduleOpen(false)}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-title"
            className="relative h-full w-full max-w-xl overflow-y-auto bg-white shadow-float"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">New booking</p>
                <h2 id="schedule-title" className="mt-1 text-section text-slate-950">Schedule an interview</h2>
                <p className="mt-1 text-xs text-slate-500">Calendar invite, Teams link, and candidate email are created automatically.</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setScheduleOpen(false)} aria-label="Close">
                Close
              </Button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 px-5 py-6 sm:px-6">
              <div>
                <label htmlFor="sched-candidate" className="mb-1.5 block text-sm font-medium text-slate-700">Candidate</label>
                <select id="sched-candidate" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} className={inputClass}>
                  <option value="">Select a candidate…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.firstName} {candidate.lastName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="sched-job" className="mb-1.5 block text-sm font-medium text-slate-700">Job</label>
                <select id="sched-job" value={jobId} onChange={(event) => setJobId(event.target.value)} className={inputClass}>
                  <option value="">Select a job…</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>{job.title} — {job.location}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sched-type" className="mb-1.5 block text-sm font-medium text-slate-700">Type</label>
                  <select id="sched-type" value={type} onChange={(event) => setType(event.target.value)} className={inputClass}>
                    {TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="sched-duration" className="mb-1.5 block text-sm font-medium text-slate-700">Duration</label>
                  <select id="sched-duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))} className={inputClass}>
                    {DURATION_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes} min</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sched-date" className="mb-1.5 block text-sm font-medium text-slate-700">Date</label>
                  <input id="sched-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="sched-time" className="mb-1.5 block text-sm font-medium text-slate-700">Start time</label>
                  <input id="sched-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">Interview panel</legend>
                <div className="flex flex-wrap gap-2">
                  {staff.map((member) => (
                    <label
                      key={member.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                        panelistIds.includes(member.id)
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={panelistIds.includes(member.id)}
                        onChange={() => togglePanelist(member.id)}
                        className="h-3.5 w-3.5 accent-brand-600"
                      />
                      {member.name}
                    </label>
                  ))}
                </div>
              </fieldset>

              {conflicts.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <p className="font-semibold">Panel conflicts:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
                  </ul>
                </div>
              )}

              {formError && (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{formError}</p>
              )}

              {lastScheduled && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  <p>
                    ✓ Scheduled <strong>{lastScheduled.interview.application.candidate.name}</strong> —{' '}
                    {formatSlot(lastScheduled.interview.slotStart, lastScheduled.interview.slotEnd)}. Confirmation email rendered for{' '}
                    {lastScheduled.emailPreview.to}.
                  </p>
                  {lastScheduled.calendar.videoLink && (
                    <p className="mt-1 truncate font-mono text-xs text-emerald-700">{lastScheduled.calendar.videoLink}</p>
                  )}
                </div>
              )}

              <div className="sticky bottom-0 -mx-5 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:-mx-6 sm:px-6">
                <Button variant="secondary" onClick={() => setScheduleOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={submitting}>{submitting ? 'Scheduling…' : 'Schedule interview'}</Button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </div>
  );
}
