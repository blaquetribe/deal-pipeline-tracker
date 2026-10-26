import { STAGES } from '@dpt/shared';

import { StageBadge } from '../features/pipeline';

export default function HomePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Deal Pipeline Tracker</h1>
      <p className="mt-2 text-fg-muted">Foundation scaffold. Pipeline stages:</p>
      <ol className="mt-4 flex flex-wrap gap-2">
        {STAGES.map((stage) => (
          <li key={stage}>
            <StageBadge stage={stage} />
          </li>
        ))}
      </ol>
    </>
  );
}
