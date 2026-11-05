import { Component, ChangeDetectionStrategy, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LuantiPackage, SortOption } from '../../core/models/package.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { LucideChevronLeft, LucideChevronRight } from '@lucide/angular';

export const DRAWER_PACKAGES_PAGE_SIZE = 8;

export type DrawerPackageCategoryFilter = 'all' | 'game' | 'mod' | 'txp' | 'git';

export interface DrawerPackageFilterOptions {
  category?: DrawerPackageCategoryFilter;
  tag?: string;
  searchTerm?: string;
  sortBy?: SortOption;
}

export function filterAndSortDrawerPackages(
  packages: LuantiPackage[],
  options: DrawerPackageFilterOptions
): LuantiPackage[] {
  const cat = options.category ?? 'all';
  const tag = (options.tag ?? 'all').toLowerCase();
  const q = (options.searchTerm ?? '').trim().toLowerCase();
  const sort = options.sortBy ?? 'downloads';

  const filtered = (packages || []).filter(pkg => {
    if (cat === 'git') {
      if (!pkg.sources?.includes('git') && pkg.source !== 'git') return false;
    } else if (cat !== 'all' && pkg.type !== cat) {
      return false;
    }

    if (tag !== 'all') {
      const hasTag = (pkg.tags || []).some(t => t.toLowerCase() === tag);
      if (!hasTag) return false;
    }

    if (q) {
      const hay = `${pkg.title} ${pkg.name} ${pkg.short_desc}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  return [...filtered].sort((a, b) => {
    if (sort === 'score') {
      return (b.score || 0) - (a.score || 0) || (b.downloads || 0) - (a.downloads || 0);
    }
    if (sort === 'updated') {
      const tB =
        b.updated_at || b.created_at
          ? new Date(b.updated_at || b.created_at!).getTime() || 0
          : Number(b.release_id || 0);
      const tA =
        a.updated_at || a.created_at
          ? new Date(a.updated_at || a.created_at!).getTime() || 0
          : Number(a.release_id || 0);
      return tB - tA || (b.downloads || 0) - (a.downloads || 0);
    }
    if (sort === 'title') {
      return (a.title || a.name).localeCompare(b.title || b.name);
    }
    return (b.downloads || 0) - (a.downloads || 0);
  });
}

export function computeDrawerTotalPages(
  totalItems: number,
  pageSize = DRAWER_PACKAGES_PAGE_SIZE
): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function sliceDrawerPage<T>(
  items: T[],
  currentPage: number,
  pageSize = DRAWER_PACKAGES_PAGE_SIZE
): T[] {
  const totalPages = computeDrawerTotalPages(items.length, pageSize);
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

@Component({
  selector: 'app-drawer-pagination',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [':host { display: block; }'],
  imports: [CommonModule, TranslatePipe, LucideChevronLeft, LucideChevronRight],
  template: `
    @if (totalPages > 1) {
      <div class="pt-2 flex items-center justify-between gap-2 text-xs" data-testid="drawer-pagination-bar">
        <button
          type="button"
          (click)="onPrev()"
          [disabled]="currentPage <= 1"
          class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 font-semibold flex items-center gap-1 transition cursor-pointer">
          <svg lucideChevronLeft class="w-3.5 h-3.5"></svg>
          <span>{{ 'profile.prevPage' | translate }}</span>
        </button>

        <span class="text-slate-400 font-mono text-[11px]">
          {{ 'profile.pageLabel' | translate }} {{ currentPage }} / {{ totalPages }}@if (totalItems !== undefined) { ({{ totalItems }})}
        </span>

        <button
          type="button"
          (click)="onNext()"
          [disabled]="currentPage >= totalPages"
          class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white disabled:opacity-40 font-semibold flex items-center gap-1 transition cursor-pointer">
          <span>{{ 'profile.nextPage' | translate }}</span>
          <svg lucideChevronRight class="w-3.5 h-3.5"></svg>
        </button>
      </div>
    }
  `
})
export class DrawerPaginationComponent {
  @Input({ required: true }) currentPage = 1;
  @Input({ required: true }) totalPages = 1;
  @Input() totalItems?: number;
  @Output() readonly pageChange = new EventEmitter<number>();

  onPrev(): void {
    if (this.currentPage > 1) {
      this.pageChange.emit(this.currentPage - 1);
    }
  }

  onNext(): void {
    if (this.currentPage < this.totalPages) {
      this.pageChange.emit(this.currentPage + 1);
    }
  }
}
