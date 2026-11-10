import { Injectable, computed, signal } from '@angular/core';
import { LocaleId, LocaleMeta, SUPPORTED_LOCALES, TranslationDictionary, TranslationKey } from './translation.types';
import { en } from './locales/en';

const SUPPORTED_LOCALE_IDS = new Set<LocaleId>(['en', 'sk', 'de', 'fr', 'es', 'ru']);

const LOADED_DICTIONARIES: Partial<Record<LocaleId, TranslationDictionary>> = {
  en
};

const IN_FLIGHT_LOADS: Partial<Record<LocaleId, Promise<TranslationDictionary | null>>> = {};
const GLOBAL_DICTIONARY_REVISION = signal<number>(0);

const LOCALE_LOADERS: Record<Exclude<LocaleId, 'en'>, () => Promise<TranslationDictionary>> = {
  sk: () => import('./locales/sk').then(m => m.sk),
  de: () => import('./locales/de').then(m => m.de),
  fr: () => import('./locales/fr').then(m => m.fr),
  es: () => import('./locales/es').then(m => m.es),
  ru: () => import('./locales/ru').then(m => m.ru)
};

export async function preloadAllTranslationLocales(): Promise<void> {
  const entries = Object.entries(LOCALE_LOADERS) as Array<
    [Exclude<LocaleId, 'en'>, () => Promise<TranslationDictionary>]
  >;
  let updated = false;
  await Promise.all(
    entries.map(async ([loc, loader]) => {
      if (!LOADED_DICTIONARIES[loc]) {
        LOADED_DICTIONARIES[loc] = await loader();
        updated = true;
      }
    })
  );
  if (updated) {
    GLOBAL_DICTIONARY_REVISION.update(v => v + 1);
  }
}

const STORAGE_KEY = 'luantihub_locale';

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  readonly supportedLocales: LocaleMeta[] = SUPPORTED_LOCALES;

  readonly currentLocale = signal<LocaleId>(this.detectInitialLocale());

  readonly currentDictionary = computed<TranslationDictionary>(() => {
    GLOBAL_DICTIONARY_REVISION();
    return LOADED_DICTIONARIES[this.currentLocale()] || en;
  });

  constructor() {
    const initial = this.currentLocale();
    this.persistLocale(initial);
    if (initial !== 'en' && !LOADED_DICTIONARIES[initial]) {
      void this.ensureLocaleLoaded(initial);
    }
  }

  private isSupportedLocale(val: string | null | undefined): val is LocaleId {
    return Boolean(val && SUPPORTED_LOCALE_IDS.has(val as LocaleId));
  }

  private detectInitialLocale(): LocaleId {
    if (typeof window === 'undefined') return 'en';

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const queryLang = urlParams.get('lang');
      if (this.isSupportedLocale(queryLang)) {
        return queryLang;
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (this.isSupportedLocale(saved)) {
        return saved;
      }

      const browserLang = (navigator.language || '').slice(0, 2).toLowerCase();
      if (this.isSupportedLocale(browserLang)) {
        return browserLang;
      }
    } catch {
      // Fallback
    }

    return 'en';
  }

  async ensureLocaleLoaded(locale: LocaleId): Promise<void> {
    if (locale === 'en' || LOADED_DICTIONARIES[locale]) {
      return;
    }
    const loader = LOCALE_LOADERS[locale];
    if (!loader) return;
    if (!IN_FLIGHT_LOADS[locale]) {
      IN_FLIGHT_LOADS[locale] = loader()
        .then(dict => {
          LOADED_DICTIONARIES[locale] = dict;
          GLOBAL_DICTIONARY_REVISION.update(v => v + 1);
          return dict;
        })
        .catch(() => null)
        .finally(() => {
          delete IN_FLIGHT_LOADS[locale];
        });
    }
    await IN_FLIGHT_LOADS[locale];
  }

  setLocale(locale: LocaleId): void {
    if (this.isSupportedLocale(locale)) {
      this.currentLocale.set(locale);
      this.persistLocale(locale);
      if (locale !== 'en' && !LOADED_DICTIONARIES[locale]) {
        void this.ensureLocaleLoaded(locale);
      }
    }
  }

  private persistLocale(loc: LocaleId): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, loc);
      }
      if (typeof document !== 'undefined') {
        document.documentElement.lang = loc;
      }
    } catch {
      // Ignore
    }
  }

  translate(key: TranslationKey | string, params?: Record<string, string | number>): string {
    return this.t(key, params);
  }

  t(key: TranslationKey | string, params?: Record<string, string | number>): string {
    const dict = this.currentDictionary();
    let text = this.resolveKey(dict, key);

    if (text === undefined) {
      text = this.resolveKey(en, key);
    }

    if (text === undefined) {
      return key;
    }

    if (params) {
      const normalizedParams: Record<string, string | number> = { ...params };
      if ('shown' in normalizedParams && !('visible' in normalizedParams)) {
        normalizedParams['visible'] = normalizedParams['shown'];
      }
      if ('visible' in normalizedParams && !('shown' in normalizedParams)) {
        normalizedParams['shown'] = normalizedParams['visible'];
      }
      for (const [paramKey, paramVal] of Object.entries(normalizedParams)) {
        text = text.replaceAll(`{${paramKey}}`, () => String(paramVal));
      }
    }

    return text;
  }

  private resolveKey(obj: any, path: string): string | undefined {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let curr = obj;
    for (const part of parts) {
      if (curr && typeof curr === 'object' && part in curr) {
        curr = curr[part];
      } else {
        return undefined;
      }
    }
    return typeof curr === 'string' ? curr : undefined;
  }
}
