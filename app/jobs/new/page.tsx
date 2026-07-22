import type { Metadata } from 'next';
import Link from 'next/link';
import JobForm from '@/components/jobs/JobForm';
import PageHeader from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'New job — HR Portal' };

export default function NewJobPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/jobs" className="mb-4 inline-flex text-sm font-semibold text-brand-600 hover:text-brand-700">
        ← Back to jobs
      </Link>
      <PageHeader
        title="Create job posting"
        subtitle="Must-have skills drive candidate ranking — list them carefully."
      />
      <JobForm />
    </div>
  );
}
