import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from './translation.service';
import { TranslationDictionary, TranslationKey, LocaleId } from './translation.types';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private readonly translationService = inject(TranslationService);

  private lastKey = '';
  private lastLocale: LocaleId | '' = '';
  private lastDict: TranslationDictionary | null = null;
  private lastParamsSig = '';
  private lastValue = '';

  transform(key: TranslationKey | string, params?: Record<string, string | number>): string {
    if (!key) return '';
    const locale = this.translationService.currentLocale();
    const dict = this.translationService.currentDictionary();
    const paramsSig = params ? JSON.stringify(params) : '';

    if (
      key === this.lastKey &&
      locale === this.lastLocale &&
      dict === this.lastDict &&
      paramsSig === this.lastParamsSig
    ) {
      return this.lastValue;
    }

    this.lastKey = key;
    this.lastLocale = locale;
    this.lastDict = dict;
    this.lastParamsSig = paramsSig;
    this.lastValue = this.translationService.t(key as TranslationKey, params);
    return this.lastValue;
  }
}
