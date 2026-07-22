import type { Metadata } from 'next';
import JobList from '@/components/jobs/JobList';

export const metadata: Metadata = { title: 'Jobs — HR Portal' };

export default function JobsPage() {
  return <JobList />;
}
