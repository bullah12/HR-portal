'use client';

/**
 * Interview scheduling widget + upcoming-interview list.
 *
 * Recruiters/HR admins get the booking form (candidate, job, type, slot,
 * panel) — panel conflicts from the API are surfaced inline. Hiring
 * managers and interviewers see only their own panels (API-scoped) and
 * no form. The calendar invite + Teams link are created server-side.
 */

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

const STATUS_BADGES: Record<string, string> = {
  SCHEDULED: 'bg-sky-100 text-sky-800',
  RESCHEDULED: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-500',
  NO_SHOW: 'bg-rose-100 text-rose-700',
};

function formatSlot(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const from = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const to = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${from}–${to}`;
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

  const [candidateId, setCandidateId] = useState('');
  const [jobId, setJobId] = useState('');
  const [type, setType] = useState('TECHNICAL');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [durationMinutes, setDurationMinutes] = useState(60);
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
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

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
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500';

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">Loading interviews…</p>;
  }

  return (
    <div className="space-y-6">
      {isRecruiting && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-slate-900">Schedule an interview</h2>
          <p className="mt-1 text-sm text-slate-500">
            A calendar invite and Teams link are created automatically; the candidate receives a confirmation email.
          </p>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="sched-candidate" className="mb-1 block text-sm font-medium text-slate-700">
                  Candidate
                </label>
                <select id="sched-candidate" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} className={inputClass}>
                  <option value="">Select a candidate…</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.firstName} {candidate.lastName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sched-job" className="mb-1 block text-sm font-medium text-slate-700">
                  Job
                </label>
                <select id="sched-job" value={jobId} onChange={(event) => setJobId(event.target.value)} className={inputClass}>
                  <option value="">Select a job…</option>
                  {jobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.title} — {job.location}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <label htmlFor="sched-type" className="mb-1 block text-sm font-medium text-slate-700">
                  Type
                </label>
                <select id="sched-type" value={type} onChange={(event) => setType(event.target.value)} className={inputClass}>
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sched-date" className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input id="sched-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="sched-time" className="mb-1 block text-sm font-medium text-slate-700">
                  Start time
                </label>
                <input id="sched-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={inputClass} />
              </div>
              <div>
                <label htmlFor="sched-duration" className="mb-1 block text-sm font-medium text-slate-700">
                  Duration
                </label>
                <select
                  id="sched-duration"
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                  className={inputClass}
                >
                  {DURATION_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} min
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">Interview panel</legend>
              <div className="flex flex-wrap gap-2">
                {staff.map((member) => (
                  <label
                    key={member.id}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                      panelistIds.includes(member.id)
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={panelistIds.includes(member.id)}
                      onChange={() => togglePanelist(member.id)}
                      className="h-3.5 w-3.5 accent-indigo-600"
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
                  {conflicts.map((conflict) => (
                    <li key={conflict}>{conflict}</li>
                  ))}
                </ul>
              </div>
            )}

            {formError && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </p>
            )}

            {lastScheduled && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <p>
                  ✓ Scheduled <strong>{lastScheduled.interview.application.candidate.name}</strong> —{' '}
                  {formatSlot(lastScheduled.interview.slotStart, lastScheduled.interview.slotEnd)}. Confirmation email
                  rendered for {lastScheduled.emailPreview.to}.
                </p>
                {lastScheduled.calendar.videoLink && (
                  <p className="mt-1 truncate font-mono text-xs text-emerald-700">{lastScheduled.calendar.videoLink}</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Scheduling…' : 'Schedule interview'}
            </button>
          </form>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          {isRecruiting ? 'All interviews' : 'Your interviews'}
        </h2>

        {listError && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {listError}
          </p>
        )}

        {interviews.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No interviews yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {interviews.map((interview) => (
              <li
                key={interview.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {interview.application.candidate.name}
                    <span className="font-normal text-slate-500"> — {interview.application.job.title}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatSlot(interview.slotStart, interview.slotEnd)} · {interview.type.replaceAll('_', ' ').toLowerCase()} ·
                    panel: {interview.panelists.map((panelist) => panelist.name).join(', ')}
                  </p>
                  {interview.videoLink && interview.status !== 'CANCELLED' && (
                    <a
                      href={interview.videoLink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-block truncate text-xs font-medium text-indigo-700 hover:underline"
                    >
                      Join video call
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      STATUS_BADGES[interview.status] ?? 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {interview.status}
                  </span>
                  {isRecruiting && ['SCHEDULED', 'RESCHEDULED'].includes(interview.status) && (
                    <button
                      type="button"
                      onClick={() => handleCancel(interview.id)}
                      disabled={cancellingId === interview.id}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      {cancellingId === interview.id ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
