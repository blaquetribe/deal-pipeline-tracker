import type { Metadata } from 'next';

import { DealDetail } from '../../../features/deals';
import { AppShell } from '../../../features/shell';

export const metadata: Metadata = { title: 'Deal details | Deal Pipeline Tracker' };

export default async function DealPage({
  params,
}: {
  readonly params: Promise<{ dealId: string }>;
}) {
  const { dealId } = await params;
  return (
    <AppShell currentPage="pipeline">
      <DealDetail dealId={dealId} />
    </AppShell>
  );
}
