import { TeamManagement } from '../../features/auth';
import { AppShell, PageHeading } from '../../features/shell';

export default function TeamPage() {
  return (
    <AppShell currentPage="team">
      <PageHeading
        eyebrow="Organisation"
        title="Team access"
        description="Invite teammates with the right role and manage outstanding invitations."
      />
      <TeamManagement />
    </AppShell>
  );
}
