import type { Metadata } from 'next';
import TodayDashboard from '@/components/dashboard/TodayDashboard';

export const metadata: Metadata = { title: 'Today — HR Portal' };

export default function HomePage() {
  return <TodayDashboard />;
}
