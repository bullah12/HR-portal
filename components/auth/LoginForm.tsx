'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { apiFetch, storeUser } from '@/lib/client';
import type { LoginResponseData } from '@/lib/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  password?: string;
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    if (password.length === 0) {
      errors.password = 'Enter your password.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    if (!validate()) return;

    setSubmitting(true);
    const result = await apiFetch<LoginResponseData>('/api/auth/login', {
      method: 'POST',
      json: { email: email.trim().toLowerCase(), password },
    });
    setSubmitting(false);

    if (!result.ok) {
      setServerError(result.error.message);
      return;
    }

    storeUser(result.data.user);
    router.push('/');
    router.refresh();
  }

  const inputClass = (hasError: boolean) =>
    `w-full rounded-lg border bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-600/20 ${
      hasError ? 'border-rose-400' : 'border-slate-300'
    }`;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass(Boolean(fieldErrors.email))}
          placeholder="you@company.example"
        />
        {fieldErrors.email && <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>}
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass(Boolean(fieldErrors.password))}
          placeholder="••••••••"
        />
        {fieldErrors.password && <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>}
      </div>

      {serverError && (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {serverError}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full py-2.5">
        {submitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
