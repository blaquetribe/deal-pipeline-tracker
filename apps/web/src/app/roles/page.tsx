import { RoleManagement } from '../../features/roles';
import { AppShell, PageHeading } from '../../features/shell';

export default function RolesPage() {
  return (
    <AppShell currentPage="roles">
      <PageHeading
        eyebrow="Organisation settings"
        title="Role management"
        description="Review the access granted by each role in this organisation."
      />
      <RoleManagement />
    </AppShell>
  );
}
