import { MyWorkDashboard } from '../features/deals';
import { AppShell, PageHeading } from '../features/shell';

export default function HomePage() {
  return (
    <AppShell currentPage="my-work">
      <PageHeading
        title="My workspace"
        description="Your assigned work, decisions, and updates in one place."
      />
      <MyWorkDashboard />
    </AppShell>
  );
}
