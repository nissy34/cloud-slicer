export function ComingSoon({ title, phase, children }: { title: string; phase: number; children: React.ReactNode }) {
  return (
    <div className="coming-soon">
      <h1>{title}</h1>
      <p>{children}</p>
      <p className="muted">Planned for phase {phase}.</p>
    </div>
  );
}
