import { ClosingAlertSettingsForm } from '../../features/notifications';
import { AppShell, PageHeading } from '../../features/shell';

export default function SettingsPage() {
  return (
    <AppShell currentPage="settings">
      <PageHeading
        eyebrow="Organisation settings"
        title="Closing alerts"
        description="Set when the organisation is notified about deals approaching or passing their expected close date."
      />
      <ClosingAlertSettingsForm />
    </AppShell>
  );
}
