import { DealsDashboard } from '../../features/deals';
import { AppShell } from '../../features/shell';

export default function PipelinePage() {
  return (
    <AppShell currentPage="pipeline">
      <DealsDashboard />
    </AppShell>
  );
}
