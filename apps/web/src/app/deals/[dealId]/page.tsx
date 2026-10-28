import type { Metadata } from 'next';

import { SignOutButton, TenantSwitcher } from '../../../features/auth';
import { DealDetail } from '../../../features/deals';

export const metadata: Metadata = { title: 'Deal details | Deal Pipeline Tracker' };

export default async function DealPage({
  params,
}: {
  readonly params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-lg font-semibold">Deal Pipeline Tracker</p>
        <div className="flex flex-wrap items-center gap-4">
          <TenantSwitcher />
          <SignOutButton />
        </div>
      </header>
      <DealDetail dealId={dealId} />
    </>
  );
}
