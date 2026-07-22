'use client';

import { FormEvent, ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { apiFetch, clearStoredUser } from '@/lib/client';
import type { JobDto } from '@/lib/types';

interface FormState {
  title: string;
  description: string;
  location: string;
  mustHaveSkills: string;
  niceToHaveSkills: string;
  minExperienceYears: string;
  compBandMin: string;
  compBandMax: string;
  compBandCurrency: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'PUBLISHED';
}

const INITIAL_STATE: FormState = {
  title: '',
  description: '',
  location: '',
  mustHaveSkills: '',
  niceToHaveSkills: '',
  minExperienceYears: '0',
  compBandMin: '',
  compBandMax: '',
  compBandCurrency: 'EUR',
  status: 'DRAFT',
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

// Module-level so its identity is stable across renders — defining it inside
// JobForm would remount the wrapped input (and drop focus) on every keystroke.
function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

function parseSkills(value: string): string[] {
  return value
    .split(',')
    .map((skill) => skill.trim())
    .filter((skill) => skill.length > 0);
}

export default function JobForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  // Mirrors the server-side zod rules in app/api/jobs/route.ts.
  function validate(): boolean {
    const errors: FieldErrors = {};
    if (form.title.trim().length < 3) errors.title = 'Title must be at least 3 characters.';
    if (form.description.trim().length < 10) errors.description = 'Description must be at least 10 characters.';
    if (form.location.trim().length < 2) errors.location = 'Location is required.';
    if (parseSkills(form.mustHaveSkills).length === 0) {
      errors.mustHaveSkills = 'Add at least one must-have skill (comma separated).';
    }

    const experience = Number(form.minExperienceYears);
    if (!Number.isInteger(experience) || experience < 0 || experience > 50) {
      errors.minExperienceYears = 'Experience must be a whole number between 0 and 50.';
    }

    const min = Number(form.compBandMin);
    const max = Number(form.compBandMax);
    if (!Number.isFinite(min) || min <= 0) errors.compBandMin = 'Enter a positive amount.';
    if (!Number.isFinite(max) || max <= 0) errors.compBandMax = 'Enter a positive amount.';
    if (!errors.compBandMin && !errors.compBandMax && max < min) {
      errors.compBandMax = 'Maximum must be at least the minimum.';
    }

    if (!/^[A-Za-z]{3}$/.test(form.compBandCurrency.trim())) {
      errors.compBandCurrency = 'Use a 3-letter currency code (e.g. EUR).';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const result = await apiFetch<JobDto>('/api/jobs', {
      method: 'POST',
      json: {
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        mustHaveSkills: parseSkills(form.mustHaveSkills),
        niceToHaveSkills: parseSkills(form.niceToHaveSkills),
        minExperienceYears: Number(form.minExperienceYears),
        compBandMin: Number(form.compBandMin),
        compBandMax: Number(form.compBandMax),
        compBandCurrency: form.compBandCurrency.trim().toUpperCase(),
        status: form.status,
      },
    });
    setSubmitting(false);

    if (!result.ok) {
      if (result.status === 401) {
        clearStoredUser();
        router.push('/login');
        return;
      }
      // Surface server-side field validation next to the fields when present.
      const details = result.error.details as Record<string, string[]> | undefined;
      if (result.error.code === 'VALIDATION_ERROR' && details) {
        const serverFieldErrors: FieldErrors = {};
        for (const [field, messages] of Object.entries(details)) {
          if (field in INITIAL_STATE && messages.length > 0) {
            serverFieldErrors[field as keyof FormState] = messages[0];
          }
        }
        setFieldErrors(serverFieldErrors);
      }
      setServerError(result.error.message);
      return;
    }

    router.push('/jobs');
    router.refresh();
  }

  const inputClass = (hasError: boolean) =>
    `w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20 ${
      hasError ? 'border-rose-400' : 'border-slate-300'
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-card border border-slate-200 bg-white p-5 shadow-card sm:p-6">
      <Field label="Job title" error={fieldErrors.title}>
        <input
          value={form.title}
          onChange={(event) => update('title', event.target.value)}
          className={inputClass(Boolean(fieldErrors.title))}
          placeholder="Senior Backend Engineer"
        />
      </Field>

      <Field label="Description" error={fieldErrors.description}>
        <textarea
          value={form.description}
          onChange={(event) => update('description', event.target.value)}
          rows={4}
          className={inputClass(Boolean(fieldErrors.description))}
          placeholder="What the role involves, the team, and what success looks like."
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Location" error={fieldErrors.location}>
          <input
            value={form.location}
            onChange={(event) => update('location', event.target.value)}
            className={inputClass(Boolean(fieldErrors.location))}
            placeholder="Berlin, Germany (hybrid)"
          />
        </Field>

        <Field label="Minimum experience (years)" error={fieldErrors.minExperienceYears}>
          <input
            type="number"
            min={0}
            max={50}
            value={form.minExperienceYears}
            onChange={(event) => update('minExperienceYears', event.target.value)}
            className={inputClass(Boolean(fieldErrors.minExperienceYears))}
          />
        </Field>
      </div>

      <Field
        label="Must-have skills"
        error={fieldErrors.mustHaveSkills}
        hint="Comma separated — candidates missing these are score-capped."
      >
        <input
          value={form.mustHaveSkills}
          onChange={(event) => update('mustHaveSkills', event.target.value)}
          className={inputClass(Boolean(fieldErrors.mustHaveSkills))}
          placeholder="TypeScript, Node.js, PostgreSQL"
        />
      </Field>

      <Field label="Nice-to-have skills" error={fieldErrors.niceToHaveSkills} hint="Comma separated, optional.">
        <input
          value={form.niceToHaveSkills}
          onChange={(event) => update('niceToHaveSkills', event.target.value)}
          className={inputClass(Boolean(fieldErrors.niceToHaveSkills))}
          placeholder="NestJS, AWS"
        />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Field label="Compensation band — min" error={fieldErrors.compBandMin}>
          <input
            type="number"
            min={1}
            value={form.compBandMin}
            onChange={(event) => update('compBandMin', event.target.value)}
            className={inputClass(Boolean(fieldErrors.compBandMin))}
            placeholder="70000"
          />
        </Field>

        <Field label="Compensation band — max" error={fieldErrors.compBandMax}>
          <input
            type="number"
            min={1}
            value={form.compBandMax}
            onChange={(event) => update('compBandMax', event.target.value)}
            className={inputClass(Boolean(fieldErrors.compBandMax))}
            placeholder="85000"
          />
        </Field>

        <Field label="Currency" error={fieldErrors.compBandCurrency}>
          <input
            value={form.compBandCurrency}
            onChange={(event) => update('compBandCurrency', event.target.value)}
            maxLength={3}
            className={inputClass(Boolean(fieldErrors.compBandCurrency))}
            placeholder="EUR"
          />
        </Field>
      </div>

      <Field label="Status">
        <select
          value={form.status}
          onChange={(event) => update('status', event.target.value as FormState['status'])}
          className={inputClass(false)}
        >
          <option value="DRAFT">Draft</option>
          <option value="PENDING_APPROVAL">Pending approval</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </Field>

      {serverError && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
        <Button variant="secondary" onClick={() => router.push('/jobs')}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create job'}
        </Button>
      </div>
    </form>
  );
}
