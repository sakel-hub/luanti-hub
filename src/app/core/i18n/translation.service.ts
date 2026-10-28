import { Injectable, computed, signal } from '@angular/core';
import { LocaleId, LocaleMeta, SUPPORTED_LOCALES, TranslationDictionary, TranslationKey } from './translation.types';
import { en } from './locales/en';
import { sk } from './locales/sk';
import { de } from './locales/de';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { ru } from './locales/ru';

const DICTIONARIES: Record<LocaleId, TranslationDictionary> = {
  en,
  sk,
  de,
  fr,
  es,
  ru
};

const STORAGE_KEY = 'luantihub_locale';

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  readonly supportedLocales: LocaleMeta[] = SUPPORTED_LOCALES;

  readonly currentLocale = signal<LocaleId>(this.detectInitialLocale());

  readonly currentDictionary = computed<TranslationDictionary>(() => {
    return DICTIONARIES[this.currentLocale()] || DICTIONARIES.en;
  });

  constructor() {
    this.persistLocale(this.currentLocale());
  }

  private detectInitialLocale(): LocaleId {
    if (typeof window === 'undefined') return 'en';

    try {
      // 1. URL search param (?lang=sk)
      const urlParams = new URLSearchParams(window.location.search);
      const queryLang = urlParams.get('lang') as LocaleId;
      if (queryLang && DICTIONARIES[queryLang]) {
        return queryLang;
      }

      // 2. Local storage
      const saved = localStorage.getItem(STORAGE_KEY) as LocaleId;
      if (saved && DICTIONARIES[saved]) {
        return saved;
      }

      // 3. Browser language
      const browserLang = (navigator.language || '').slice(0, 2).toLowerCase() as LocaleId;
      if (browserLang && DICTIONARIES[browserLang]) {
        return browserLang;
      }
    } catch {
      // Fallback
    }

    return 'en';
  }

  setLocale(locale: LocaleId): void {
    if (DICTIONARIES[locale]) {
      this.currentLocale.set(locale);
      this.persistLocale(locale);
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

  t(key: TranslationKey | string, params?: Record<string, string | number>): string {
    const dict = this.currentDictionary();
    let text = this.resolveKey(dict, key);

    if (text === undefined) {
      text = this.resolveKey(DICTIONARIES.en, key);
    }

    if (text === undefined) {
      return key;
    }

    if (params) {
      for (const [paramKey, paramVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(paramVal));
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
