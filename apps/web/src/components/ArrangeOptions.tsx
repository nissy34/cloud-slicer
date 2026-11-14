import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_ARRANGE, MAX_SPACING, alignYFor } from '../lib/arrange';
import { useSlicer } from '../state/store';
import { Slider } from './Slider';

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Desktop Orca's Arrange pop-up (GLCanvas3D::_render_arrange_menu), opened by the
 * toolbar's Arrange button: the spacing, three switches, then Arrange (all plates,
 * like the button there) and Reset. The options are kept in this browser and also
 * apply to A, Shift+A and the plate's Arrange icon and menu item.
 */
export function ArrangeOptions({ onArranged }: { onArranged(): void }) {
  const { t } = useTranslation();
  const settings = useSlicer((s) => s.arrangeSettings);
  const set = useSlicer((s) => s.setArrangeSettings);
  const structure = useSlicer((s) => s.overrides.printer_structure ?? s.baseConfig.printer_structure);
  const alignY = alignYFor(settings, structure);
  // The box keeps what is being typed ("1." or ""), the setting only numbers.
  const [typed, setTyped] = useState<string | null>(null);
  const spacingText = typed ?? String(round(settings.spacing));

  return (
    <div className="arrange-options" data-testid="arrange-options">
      <div className="arrange-spacing">
        <span id="arrange-spacing-label">{t('arrangeOptions.spacing')}</span>
        <Slider
          aria-labelledby="arrange-spacing-label"
          min={0}
          max={MAX_SPACING}
          step={0.5}
          value={Math.min(settings.spacing, MAX_SPACING)}
          onChange={(e) => {
            setTyped(null);
            set({ ...settings, spacing: Number(e.target.value) });
          }}
        />
        <span className="input-unit">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            aria-label={t('arrangeOptions.spacingMm')}
            value={spacingText}
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Number(e.target.value);
              if (e.target.value.trim() !== '' && Number.isFinite(n)) set({ ...settings, spacing: Math.max(0, n) });
            }}
            onBlur={() => setTyped(null)}
          />
          <span className="unit">mm</span>
        </span>
      </div>
      <p className="arrange-note">{t('arrangeOptions.autoNote')}</p>
      <hr />
      <div className="switch-list">
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={settings.rotate} onChange={(e) => set({ ...settings, rotate: e.target.checked })} />
          {t('arrangeOptions.rotate')}
        </label>
        <label className="switch-row">
          <input className="switch" type="checkbox" checked={settings.multiMaterial} onChange={(e) => set({ ...settings, multiMaterial: e.target.checked })} />
          {t('arrangeOptions.multiMaterial')}
        </label>
        <label className="switch-row" title={settings.rotate ? t('arrangeOptions.alignYOff') : t('arrangeOptions.alignYTip')}>
          <input
            className="switch"
            type="checkbox"
            disabled={settings.rotate}
            checked={!settings.rotate && alignY}
            onChange={(e) => set({ ...settings, alignY: e.target.checked })}
          />
          {t('arrangeOptions.alignY')}
        </label>
      </div>
      <hr />
      <div className="arrange-actions">
        <button
          className="primary"
          onClick={() => {
            void useSlicer.getState().arrange(true);
            onArranged();
          }}
        >
          {t('arrangeOptions.arrange')}
        </button>
        <button
          className="secondary"
          onClick={() => {
            setTyped(null);
            set(DEFAULT_ARRANGE);
          }}
        >
          {t('arrangeOptions.reset')}
        </button>
      </div>
    </div>
  );
}
