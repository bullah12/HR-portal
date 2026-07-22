import type { Metadata } from 'next';
import InterviewScheduler from '@/components/interviews/InterviewScheduler';

export const metadata: Metadata = { title: 'Interviews — HR Portal' };

export default function InterviewsPage() {
  return <InterviewScheduler />;
}
