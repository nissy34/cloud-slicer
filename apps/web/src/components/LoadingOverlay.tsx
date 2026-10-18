import { useLoading } from '../state/loading';
import { PrintLoader } from './PrintLoader';

/** Covers the 3D view while the engine starts or a project opens. */
export function LoadingOverlay() {
  const loading = useLoading();
  if (!loading) return null;
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <PrintLoader loading={loading} />
    </div>
  );
}
