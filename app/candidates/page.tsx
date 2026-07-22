import type { Metadata } from 'next';
import CandidateList from '@/components/candidates/CandidateList';

export const metadata: Metadata = { title: 'Candidates — HR Portal' };

export default function CandidatesPage() {
  return <CandidateList />;
}
