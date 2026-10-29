import { DealsDashboard } from '../features/deals';
import { AppShell, PageHeading } from '../features/shell';

export default function HomePage() {
  return (
    <AppShell currentPage="pipeline">
      <PageHeading
        title="Deal pipeline"
        description="A clear view of opportunities across your organisation."
      />
      <DealsDashboard />
    </AppShell>
  );
}
