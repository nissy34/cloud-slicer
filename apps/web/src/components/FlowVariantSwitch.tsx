import { flowModeLabel, processFlowModes } from '../lib/flow-variants';
import { useSlicer } from '../state/store';

/**
 * Desktop's [Standard flow] [High flow] switch: which flow variant the
 * flow-variant options (speeds, accelerations, jerk) show and edit. Only
 * there when the process has values for more than one variant.
 */
export function FlowVariantSwitch() {
  const support = useSlicer((s) => s.baseConfig.process_flow_support);
  const modes = processFlowModes({ process_flow_support: support });
  const flowVariant = useSlicer((s) => s.flowVariant);
  const setFlowVariant = useSlicer((s) => s.setFlowVariant);
  if (modes.length < 2) return null;
  const current = Math.min(flowVariant, modes.length - 1);
  return (
    <div className="chooser" role="radiogroup" aria-label="Flow variant">
      {modes.map((m, i) => (
        <button key={m} role="radio" aria-checked={i === current} className={i === current ? 'active' : ''} onClick={() => setFlowVariant(i)}>
          {flowModeLabel(m)}
        </button>
      ))}
    </div>
  );
}
