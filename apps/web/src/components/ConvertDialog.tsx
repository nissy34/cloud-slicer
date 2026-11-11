import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { installedOnly, installedPrinters, SETUP_KEY, type Setup } from '../lib/setup';
import { loadConvertPreference } from '../lib/storage';
import { useUserSetting } from '../state/account';
import { useSlicer } from '../state/store';
import { Dialog } from './Dialog';
import { Picker } from './Picker';

/** Asks how to bring a 3MF made for a printer we don't have onto one we do. */
export function ConvertDialog() {
  const { t } = useTranslation();
  const conversion = useSlicer((s) => s.conversion);
  const allPrinters = useSlicer((s) => s.printers);
  const installed = installedPrinters(useUserSetting<Setup>(SETUP_KEY), useSlicer((s) => s.flavor));
  const current = useSlicer((s) => s.selection?.printer ?? '');
  const { convertProject, dismissConversion } = useSlicer.getState();
  const [target, setTarget] = useState(() => loadConvertPreference()?.printer ?? '');
  const [keep, setKeep] = useState(true);
  const [remember, setRemember] = useState(false);
  if (!conversion) return null;
  const printers = installedOnly(allPrinters, installed);
  const printer = printers.some((p) => p.name === target) ? target : current;
  return (
    <Dialog
      title={t('convertDialog.title')}
      onClose={dismissConversion}
      footer={
        <>
          <button className="secondary" onClick={dismissConversion}>
            {t('common.cancel')}
          </button>
          <button className="primary" onClick={() => void convertProject(printer, keep, remember)}>
            {t('convertDialog.convert')}
          </button>
        </>
      }
    >
      <p>
        <Trans i18nKey={'convertDialog.setUpFor'} values={{ printer: conversion.from }} components={{ b: <b /> }} />
      </p>
      <label className="field">
        <span>{t('convertDialog.printer')}</span>
        <Picker field label={t('convertDialog.convertTo')} value={printer} options={printers.map((p) => ({ value: p.name, label: p.name }))} onChange={setTarget} />
      </label>
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        <span>{t('convertDialog.keep')}</span>
      </label>
      <label className="switch-row">
        <input className="switch" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>{t('convertDialog.remember')}</span>
      </label>
      <p className="muted small">
        {t('convertDialog.note', { printer: printer || t('convertDialog.yourPrinter') })}
      </p>
    </Dialog>
  );
}
