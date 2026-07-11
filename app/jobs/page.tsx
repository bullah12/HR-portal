import type { Metadata } from 'next';
import JobList from '@/components/jobs/JobList';

export const metadata: Metadata = { title: 'Jobs — HR Portal' };

export default function JobsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Jobs</h1>
        <p className="mt-0.5 text-sm text-slate-500">Open requisitions and their pipeline activity.</p>
      </div>
      <JobList />
    </div>
  );
}
