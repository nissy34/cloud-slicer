import type { ReactNode } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';

/** One note box in the page: a sign and the words. Grey for information, orange for a warning, red for an error. */
export function Note({
  tone = 'info',
  children,
  className,
  testId,
  id,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
  className?: string;
  testId?: string;
  id?: string;
}) {
  const Sign = tone === 'info' ? Info : tone === 'warn' ? TriangleAlert : CircleAlert;
  return (
    <div className={['note', tone, className].filter(Boolean).join(' ')} role={tone === 'error' ? 'alert' : 'status'} data-testid={testId} id={id}>
      <Sign className="note-sign" size={16} aria-hidden />
      <div className="note-text">{children}</div>
    </div>
  );
}
