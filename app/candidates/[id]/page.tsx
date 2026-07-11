import type { Metadata } from 'next';
import CandidateProfile from '@/components/candidates/CandidateProfile';

export const metadata: Metadata = { title: 'Candidate — HR Portal' };

export default function CandidateProfilePage({ params }: { params: { id: string } }) {
  return <CandidateProfile candidateId={params.id} />;
}
