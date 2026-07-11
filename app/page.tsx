import { redirect } from 'next/navigation';

export default function HomePage() {
  // Middleware bounces unauthenticated visitors from /jobs to /login.
  redirect('/jobs');
}
