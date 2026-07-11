import type { Metadata } from 'next';
import CandidateList from '@/components/candidates/CandidateList';

export const metadata: Metadata = { title: 'Candidates — HR Portal' };

export default function CandidatesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Candidates</h1>
        <p className="mt-0.5 text-sm text-slate-500">Everyone in the pipeline, with consent status at a glance.</p>
      </div>
      <CandidateList />
    </div>
  );
}
