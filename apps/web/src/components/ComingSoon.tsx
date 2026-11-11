import { useTranslation } from 'react-i18next';

export function ComingSoon({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="coming-soon">
      <h1>{title}</h1>
      <p>{children}</p>
      <p className="muted">{t('uiParts.plannedForPhase', { phase })}</p>
    </div>
  );
}
