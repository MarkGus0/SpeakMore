import { type TranslationKey } from './i18n'

export type Page = 'home' | 'history' | 'dictionary' | 'settings'

export const pages: { labelKey: TranslationKey; page: Page }[] = [
  { labelKey: 'nav.home', page: 'home' },
  { labelKey: 'nav.history', page: 'history' },
  { labelKey: 'nav.dictionary', page: 'dictionary' },
  { labelKey: 'nav.settings', page: 'settings' },
]
