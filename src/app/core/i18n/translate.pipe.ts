import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslationService } from './translation.service';
import { TranslationKey, LocaleId } from './translation.types';

@Pipe({
  name: 'translate',
  standalone: true,
  pure: false
})
export class TranslatePipe implements PipeTransform {
  private readonly translationService = inject(TranslationService);

  private lastKey = '';
  private lastLocale: LocaleId | '' = '';
  private lastParamsSig = '';
  private lastValue = '';

  transform(key: TranslationKey | string, params?: Record<string, string | number>): string {
    if (!key) return '';
    const locale = this.translationService.currentLocale();
    const paramsSig = params ? JSON.stringify(params) : '';

    if (
      key === this.lastKey &&
      locale === this.lastLocale &&
      paramsSig === this.lastParamsSig
    ) {
      return this.lastValue;
    }

    this.lastKey = key;
    this.lastLocale = locale;
    this.lastParamsSig = paramsSig;
    this.lastValue = this.translationService.t(key as TranslationKey, params);
    return this.lastValue;
  }
}
