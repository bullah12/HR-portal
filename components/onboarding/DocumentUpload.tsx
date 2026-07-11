'use client';

/**
 * Onboarding document upload + uploaded-document list (metadata only:
 * name, uploaded date, review status). Used on the public candidate link
 * (token mode) and reusable by staff (no token).
 */

import { FormEvent, useRef, useState } from 'react';
import type { ChecklistTask } from '@/components/onboarding/ChecklistView';

export interface OnboardingDocumentMeta {
  id: string;
  name: string;
  status: string;
  uploadedAt: string;
  taskId: string | null;
  mimeType: string;
  sizeBytes: number;
}

interface DocumentUploadProps {
  /** Path segment for the API: candidate id or (public) access token. */
  planKey: string;
  /** Public access token; omitted for authenticated staff usage. */
  token?: string;
  tasks: ChecklistTask[];
  documents: OnboardingDocumentMeta[];
  onUploaded: () => void;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg'];

const DOCUMENT_STATUS_BADGES: Record<string, string> = {
  PENDING_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-700',
};

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const NAME_SUGGESTIONS = ['Employee data form', 'Tax form', 'NDA (signed)', 'Employment contract (signed)', 'Right-to-work document'];

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function DocumentUpload({ planKey, token, tasks, documents, onUploaded }: DocumentUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [taskId, setTaskId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const documentTasks = tasks.filter((task) => task.requiresDocument);

  function validate(): string | null {
    if (!file) return 'Choose a file to upload.';
    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      return 'Files must be PDF, Word, PNG, or JPEG.';
    }
    if (file.size === 0) return 'The selected file is empty.';
    if (file.size > MAX_FILE_BYTES) return 'Files must be at most 10 MB.';
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setUploading(true);

    const formData = new FormData();
    formData.set('file', file as File);
    formData.set('name', name.trim() || (file as File).name);
    if (taskId) formData.set('taskId', taskId);

    const query = token ? `?token=${encodeURIComponent(token)}` : '';
    try {
      const response = await fetch(`/api/onboarding/${encodeURIComponent(planKey)}/documents${query}`, {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message ?? `Upload failed with status ${response.status}.`);
        return;
      }
      setName('');
      setTaskId('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onUploaded();
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-base font-semibold text-slate-900">Documents</h2>
      <p className="mt-1 text-sm text-slate-500">
        Upload your employee data form, tax forms, and signed NDA. PDF, Word, or image files up to 10 MB.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="doc-name" className="mb-1 block text-sm font-medium text-slate-700">
              Document name
            </label>
            <input
              id="doc-name"
              list="doc-name-suggestions"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Tax form"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="doc-name-suggestions">
              {NAME_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="doc-task" className="mb-1 block text-sm font-medium text-slate-700">
              Checklist item (optional)
            </label>
            <select
              id="doc-task"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Not linked to a task</option>
              {documentTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                  {task.status === 'COMPLETED' ? ' (completed)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="doc-file" className="mb-1 block text-sm font-medium text-slate-700">
            File
          </label>
          <input
            id="doc-file"
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={uploading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
      </form>

      {documents.length > 0 && (
        <ul className="mt-5 space-y-2 border-t border-slate-100 pt-4">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-col gap-1 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium text-slate-800">{document.name}</p>
                <p className="text-xs text-slate-500">
                  Uploaded {formatWhen(document.uploadedAt)} · {formatSize(document.sizeBytes)}
                </p>
              </div>
              <span
                className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium sm:self-auto ${
                  DOCUMENT_STATUS_BADGES[document.status] ?? 'bg-slate-100 text-slate-600'
                }`}
              >
                {DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
