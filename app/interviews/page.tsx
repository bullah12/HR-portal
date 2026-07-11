import type { Metadata } from 'next';
import InterviewScheduler from '@/components/interviews/InterviewScheduler';

export const metadata: Metadata = { title: 'Interviews — HR Portal' };

export default function InterviewsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Interviews</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Schedule interviews with automatic calendar invites and panel conflict detection.
        </p>
      </div>
      <InterviewScheduler />
    </div>
  );
}
