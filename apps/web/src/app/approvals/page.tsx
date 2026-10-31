import { ApprovalsInbox } from '../../features/deals';
import { AppShell, PageHeading } from '../../features/shell';

export default function ApprovalsPage() {
  return (
    <AppShell currentPage="approvals">
      <PageHeading
        eyebrow="Investment committee"
        title="IC approvals"
        description="See deals in IC Review, quorum progress, and requests that need your decision."
      />
      <ApprovalsInbox />
    </AppShell>
  );
}
