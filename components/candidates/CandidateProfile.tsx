'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import StatusPill from '@/components/ui/StatusPill';
import { apiFetch, clearStoredUser, formatDate } from '@/lib/client';
import type { CandidateDto, CvUploadResponseData, JobDto } from '@/lib/types';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

const SOURCE_LABELS: Record<string, string> = {
  CAREERS_PAGE: 'Careers page',
  JOB_BOARD: 'Job board',
  REFERRAL: 'Referral',
  AGENCY: 'Agency',
  DIRECT_SOURCING: 'Direct sourcing',
};

export default function CandidateProfile({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [candidate, setCandidate] = useState<CandidateDto | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedJobId, setSelectedJobId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<CvUploadResponseData[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Phase 1b exposes list endpoints only (no GET /api/candidates/:id),
      // so the profile is resolved from the candidate list.
      const [candidatesResult, jobsResult] = await Promise.all([
        apiFetch<CandidateDto[]>('/api/candidates'),
        apiFetch<JobDto[]>('/api/jobs'),
      ]);
      if (cancelled) return;

      if (!candidatesResult.ok) {
        if (candidatesResult.status === 401) {
          clearStoredUser();
          router.push('/login');
          return;
        }
        setError(candidatesResult.error.message);
        setLoading(false);
        return;
      }

      const match = candidatesResult.data.find((entry) => entry.id === candidateId) ?? null;
      if (!match) {
        setError('Candidate not found.');
        setLoading(false);
        return;
      }

      setCandidate(match);
      if (jobsResult.ok) {
        setJobs(jobsResult.data);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [candidateId, router]);

  function validateUpload(): string | null {
    if (!selectedJobId) return 'Select the job this CV is for.';
    if (!file) return 'Choose a CV file to upload.';
    const name = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      return 'CV must be a PDF or Word document (.pdf, .doc, .docx).';
    }
    if (file.size === 0) return 'The selected file is empty.';
    if (file.size > MAX_FILE_BYTES) return 'CV files must be at most 10 MB.';
    return null;
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateUpload();
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError(null);
    setUploading(true);

    const formData = new FormData();
    formData.set('candidateId', candidateId);
    formData.set('jobId', selectedJobId);
    formData.set('file', file as File);

    const result = await apiFetch<CvUploadResponseData>('/api/candidates/upload', {
      method: 'POST',
      formData,
    });
    setUploading(false);

    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      setUploadError(result.error.message);
      return;
    }

    setUploads((current) => [result.data, ...current]);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // A first upload for a job creates the application — reflect the count.
    setCandidate((current) =>
      current && result.data.document.version === 1
        ? { ...current, applicationCount: current.applicationCount + 1 }
        : current,
    );
  }

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">Loading candidate…</p>;
  }

  if (error || !candidate) {
    return (
      <div className="space-y-4">
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error ?? 'Candidate not found.'}
        </p>
        <Link href="/candidates" className="text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline">
          ← Back to candidates
        </Link>
      </div>
    );
  }

  const jobTitle = (jobId: string) => jobs.find((job) => job.id === jobId)?.title ?? jobId;

  return (
    <div className="space-y-6">
      <Link href="/candidates" className="text-sm font-semibold text-brand-600 hover:text-brand-700 hover:underline">
        ← Back to candidates
      </Link>

      <section className="rounded-card border border-slate-200 bg-white p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-title text-slate-950">
              {candidate.firstName} {candidate.lastName}
            </h1>
            <p className="text-sm text-slate-500">{candidate.email}</p>
          </div>
          <StatusPill kind="consent" value={candidate.consentStatus} prefix="Consent" className="self-start" />
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Phone</dt>
            <dd className="text-slate-800">{candidate.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Location</dt>
            <dd className="text-slate-800">{candidate.location ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Source</dt>
            <dd className="text-slate-800">{SOURCE_LABELS[candidate.source] ?? candidate.source}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Applications</dt>
            <dd className="text-slate-800">{candidate.applicationCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Added</dt>
            <dd className="text-slate-800">{formatDate(candidate.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Ranking view</dt>
            <dd className="text-slate-800">{candidate.maskedInRankingView ? 'Masked (bias controls on)' : 'Unmasked'}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-card border border-slate-200 bg-white p-5 shadow-card sm:p-6">
        <h2 className="text-base font-semibold text-slate-900">Upload CV</h2>
        <p className="mt-1 text-sm text-slate-500">
          PDF or Word document, max 10 MB. Uploading for a job creates or updates the candidate&apos;s application.
        </p>

        <form onSubmit={handleUpload} className="mt-4 space-y-4">
          <div>
            <label htmlFor="job" className="mb-1 block text-sm font-medium text-slate-700">
              Job
            </label>
            <select
              id="job"
              value={selectedJobId}
              onChange={(event) => setSelectedJobId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20"
            >
              <option value="">Select a job…</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.title} — {job.location}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cv-file" className="mb-1 block text-sm font-medium text-slate-700">
              CV file
            </label>
            <input
              id="cv-file"
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100"
            />
          </div>

          {uploadError && (
            <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {uploadError}
            </p>
          )}

          <Button type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload CV'}
          </Button>
        </form>

        {uploads.length > 0 && (
          <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4">
            {uploads.map((upload) => (
              <li
                key={upload.document.id}
                className="flex flex-col gap-1 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  ✓ Uploaded v{upload.document.version} for <strong>{jobTitle(upload.jobId)}</strong>
                </span>
                <span className="font-mono text-xs text-emerald-700">{upload.document.fileRef}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
