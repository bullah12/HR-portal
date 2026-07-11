import type { Metadata } from 'next';
import JobForm from '@/components/jobs/JobForm';

export const metadata: Metadata = { title: 'New job — HR Portal' };

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Create job posting</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Must-have skills drive candidate ranking — list them carefully.
        </p>
      </div>
      <JobForm />
    </div>
  );
}
