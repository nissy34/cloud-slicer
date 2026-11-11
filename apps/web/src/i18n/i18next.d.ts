// Lets TypeScript check every t('…') key against en.json, so a typo fails the build.
import type en from './en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
