import Link from 'next/link';

import { RoleManagement } from '../../features/roles';

export default function RolesPage() {
  return (
    <>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-fg">Organisation settings</p>
          <h1 className="mt-2 text-2xl font-semibold">Role management</h1>
          <p className="mt-2 text-fg-muted">
            Review the access granted by each role in this organisation.
          </p>
        </div>
        <Link
          className="rounded-control border border-line px-4 py-2 hover:bg-surface-hover"
          href="/"
        >
          Back to pipeline
        </Link>
      </header>
      <RoleManagement />
    </>
  );
}
