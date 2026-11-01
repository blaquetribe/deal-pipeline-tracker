import Link from 'next/link';

import { MyWorkDashboard } from '../features/deals';
import { AppShell, PageHeading } from '../features/shell';

export default function HomePage() {
  return (
    <AppShell currentPage="my-work">
      <PageHeading
        title="My workspace"
        description="Your assigned work, decisions, and updates in one place."
        action={
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-control border border-line bg-surface px-3 font-semibold text-fg hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
            href="/pipeline"
          >
            Browse pipeline
          </Link>
        }
      />
      <MyWorkDashboard />
    </AppShell>
  );
}
