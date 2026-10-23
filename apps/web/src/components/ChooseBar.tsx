import { useSlicer } from '../state/store';

/**
 * A small bar over the 3D view while several models are chosen, or while
 * choosing on a phone: how many, Select all, their menu, and Done.
 */
export function ChooseBar() {
  const count = useSlicer((s) => (s.group.length > 1 ? s.group.length : s.selected ? 1 : 0));
  const choosing = useSlicer((s) => s.choosing);
  const several = useSlicer((s) => s.group.length > 1);
  const { selectAll, setChoosing, choose, openGroupMenu } = useSlicer.getState();
  if (!choosing && !several) return null;
  return (
    <div className="choose-bar" role="toolbar" aria-label="Chosen models">
      <span className="choose-count" aria-live="polite">
        {count === 0 ? 'Tap models to choose them' : `${count} chosen`}
      </span>
      <button className="ghost" onClick={selectAll}>
        Select all
      </button>
      {several && (
        <button
          className="ghost"
          aria-label="What to do with them"
          title="What to do with them all (or right-click / long press a chosen model)"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            openGroupMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          ⋯
        </button>
      )}
      <button
        className={choosing ? 'primary' : 'ghost'}
        title={choosing ? 'Taps pick one model again' : 'Nothing chosen (Esc)'}
        onClick={() => (choosing ? setChoosing(false) : choose([]))}
      >
        {choosing ? 'Done' : 'Clear'}
      </button>
    </div>
  );
}
