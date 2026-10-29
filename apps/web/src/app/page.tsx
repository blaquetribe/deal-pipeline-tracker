import { DealsDashboard } from '../features/deals';
import { AppHeader, PageHeading } from '../features/shell';

export default function HomePage() {
  return (
    <>
      <AppHeader currentPage="pipeline" />
      <PageHeading
        title="Deal pipeline"
        description="A clear view of opportunities across your organisation."
      />
      <DealsDashboard />
    </>
  );
}
