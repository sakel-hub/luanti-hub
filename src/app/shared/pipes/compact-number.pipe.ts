import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'compactNumber',
  standalone: true,
  pure: true
})
export class CompactNumberPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) {
      return '0';
    }
    if (num < 1000) {
      return String(Math.round(num));
    }
    if (num < 1_000_000) {
      return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    if (num < 1_000_000_000) {
      return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    }
    return `${(num / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  }
}
