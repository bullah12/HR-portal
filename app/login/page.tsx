import type { Metadata } from 'next';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = { title: 'Sign in — HR Portal' };

export default function LoginPage() {
  return (
    <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-5xl overflow-hidden rounded-card border border-slate-200 bg-white shadow-float lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-brand-700 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full border-[48px] border-brand-500/30" />
        <div aria-hidden className="absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-brand-600" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-brand-700">HR</span>
          <span className="text-lg font-bold">HR Portal</span>
        </div>
        <div className="relative max-w-md">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-brand-100">Recruitment, connected</p>
          <h1 className="mt-4 text-display text-white">Move every candidate forward with clarity.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-brand-100">
            One focused workspace for jobs, candidates, interviews, offers, and onboarding.
          </p>
        </div>
        <p className="relative text-xs text-brand-100">Secure staff access · Role-aware workflows</p>
      </section>

      <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-14">
        <div className="mb-8 lg:hidden">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">HR</span>
            <span className="text-lg font-bold text-slate-950">HR Portal</span>
          </div>
        </div>
        <div className="mb-7">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Welcome back</p>
          <h2 className="mt-2 text-title text-slate-950">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-slate-500">Use your staff account to continue.</p>
        </div>
        <LoginForm />
      </section>
    </div>
  );
}
