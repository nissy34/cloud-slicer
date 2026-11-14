import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { engineName, type EngineFlavor } from '../lib/engines';
import type { DroppedSetting } from '../lib/engine-switch';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { Swatch } from './Swatch';

const TYPE_LABEL = { printer: 'engineSwitch.printer', process: 'engineSwitch.process', filament: 'engineSwitch.filament' } as const;

/** Each setting once, one row each: "Travel speed", or "Travel speed" with "Cube" beside it. */
function SettingRows({ list }: { list: DroppedSetting[] }) {
  const seen = new Set<string>();
  const rows = list.filter((d) => {
    const id = `${d.label}\u0000${d.where ?? ''}`;
    return !seen.has(id) && seen.add(id);
  });
  return (
    <ul className="engine-switch-settings">
      {rows.map((d) => (
        <li key={`${d.key}:${d.where ?? ''}`}>
          {d.label}
          {d.where && <span className="muted small"> · {d.where}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Desktop OrcaSlicer's printer-change question, for the engine: what the open
 * project would lose in engine `to`, with Switch / Cancel. Shown only when
 * something would be lost (losesNothing): it lists only what applies.
 */
export function EngineSwitchDialog({ to, onClose, onSwitch }: { to: EngineFlavor; onClose: () => void; onSwitch: () => void }) {
  const { t } = useTranslation();
  const from = useSlicer((s) => s.flavor);
  const hasModel = useSlicer((s) => !!s.project?.objects.length);
  const plan = useMemo(() => useSlicer.getState().switchPlan(to), [to]);
  const target = engineName(to);
  const swatch = (colour: string | undefined, text: string) => (
    <Swatch colour={colour} number={text} className="engine-switch-swatch" />
  );
  return (
    <Dialog
      title={t('engineSwitch.title', { engine: target })}
      onClose={onClose}
      className="engine-switch"
      testId="engine-switch"
      footer={
        <>
          <button className="secondary" onClick={onClose} autoFocus>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={onSwitch}>
            {t('engineSwitch.switchTo', { engine: target })}
          </button>
        </>
      }
    >
      <div className="engine-switch-body">
        <p>
          {hasModel ? t('engineSwitch.movesModel') : t('engineSwitch.movesSettings')}
        </p>
        {plan.mixes.length > 0 && (
          <section>
            <h3>{t('engineSwitch.mixesTitle')}</h3>
            <p className="muted small">{t('engineSwitch.mixesText', { engine: target })}</p>
            <ul className="engine-switch-mixes">
              {plan.mixes.map((m) => (
                <li key={m.id}>
                  {swatch(m.colour, String(m.id))}
                  <span className="muted small">{m.label}</span>
                  <span aria-hidden>→</span>
                  <span className="muted small">{m.becomes}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {plan.highFlowChanged.length > 0 && (
          <section>
            <h3>{t('engineSwitch.highFlowTitle')}</h3>
            <p className="muted small">{t('engineSwitch.highFlowText', { engine: target })}</p>
            <SettingRows list={plan.highFlowChanged} />
          </section>
        )}
        {plan.dropped.length > 0 && (
          <section>
            <h3>{t('engineSwitch.droppedTitle', { engine: target })}</h3>
            <p className="muted small">{t('engineSwitch.droppedText')}</p>
            <SettingRows list={plan.dropped} />
          </section>
        )}
        {plan.ownGcode.length > 0 && (
          <section>
            <h3>{t('engineSwitch.ownGcodeTitle')}</h3>
            <p className="muted small">{t('engineSwitch.ownGcodeText', { engine: target })}</p>
            <SettingRows list={plan.ownGcode} />
          </section>
        )}
        {plan.presets.length > 0 && (
          <section>
            <h3>{t('engineSwitch.presetsTitle')}</h3>
            <p className="muted small">{t('engineSwitch.presetsText', { engine: target })}</p>
            <ul className="engine-switch-presets">
              {plan.presets.map((m) => (
                <li key={`${m.type}:${m.from}`}>
                  <span className="muted small">{t(TYPE_LABEL[m.type])}</span> {m.from} → <b>{m.to}</b>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="muted small">
          {t('engineSwitch.noWayBack', { engine: engineName(from) })}
          {hasModel && ` ${t('engineSwitch.sliceAgain')}`}
        </p>
      </div>
    </Dialog>
  );
}
