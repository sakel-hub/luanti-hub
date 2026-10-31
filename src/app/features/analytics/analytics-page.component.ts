import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { PackageService } from '../../core/services/package.service';
import { AuthService } from '../../core/services/auth.service';
import { LuantiPackage } from '../../core/models/package.model';
import { DownloadAnalyticsChartComponent } from '../../shared/components/download-analytics-chart.component';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import {
  LucideArrowLeft,
  LucideTrendingUp,
  LucidePackage,
  LucideShieldAlert,
  LucideSearch,
  LucideExternalLink
} from '@lucide/angular';

@Component({
  selector: 'app-analytics-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    TranslatePipe,
    DownloadAnalyticsChartComponent,
    LucideArrowLeft,
    LucideTrendingUp,
    LucidePackage,
    LucideShieldAlert,
    LucideSearch,
    LucideExternalLink
  ],
  template: `
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <!-- Top Navigation & Context Bar -->
      <div class="p-4 sm:p-5 rounded-3xl glass-panel flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            (click)="goBack()"
            class="px-3.5 py-2 rounded-xl glass-btn text-slate-200 hover:text-white text-xs font-bold flex items-center gap-2 transition cursor-pointer flex-shrink-0">
            <svg lucideArrowLeft class="w-4 h-4 text-sky-400"></svg>
            <span>{{ 'analytics.backToStore' | translate }}</span>
          </button>

          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-base sm:text-xl font-black text-white tracking-tight truncate">
                {{ 'analytics.dashboardTitle' | translate }}
              </h1>
              @if (effectiveUsername(); as uname) {
                <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-sky-500/15 border border-sky-400/30 text-sky-300">
                  &#64;{{ uname }}
                </span>
              }
            </div>
            <p class="text-xs text-slate-400 truncate">
              {{ 'analytics.dashboardSubtitle' | translate }}
            </p>
          </div>
        </div>

        <!-- Admin Author Switcher (Admins Only) -->
        @if (authService.isAdmin()) {
          <form (ngSubmit)="applyAdminAuthorLookup()" class="flex items-center gap-2 ml-auto">
            <div class="relative flex items-center">
              <svg lucideSearch class="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none"></svg>
              <input
                type="text"
                [(ngModel)]="adminLookupInput"
                name="adminAuthorLookup"
                [placeholder]="'analytics.inspectAuthorPlaceholder' | translate"
                class="pl-8 pr-3 py-1.5 rounded-xl glass-input text-xs text-white placeholder-slate-400 w-44 sm:w-56 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <button
              type="submit"
              class="px-3 py-1.5 rounded-xl glass-btn-sky text-white text-xs font-bold transition cursor-pointer">
              {{ 'analytics.inspectBtn' | translate }}
            </button>
          </form>
        }
      </div>

      <!-- Access Control Guard: Restricted to Package Author or Admin -->
      @if (!canViewAnalytics()) {
        <div class="p-8 sm:p-12 rounded-3xl glass-panel text-center max-w-xl mx-auto space-y-4 my-8">
          <div class="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/30 text-amber-400 flex items-center justify-center mx-auto">
            <svg lucideShieldAlert class="w-6 h-6"></svg>
          </div>
          <h2 class="text-lg font-extrabold text-white">
            {{ 'analytics.restrictedTitle' | translate }}
          </h2>
          <p class="text-xs sm:text-sm text-slate-300 leading-relaxed">
            {{ 'analytics.restrictedDesc' | translate }}
          </p>
          <div class="flex items-center justify-center gap-3 pt-2">
            @if (!authService.currentUser()) {
              <button
                type="button"
                (click)="authService.openAuthModal()"
                class="px-4 py-2 rounded-xl glass-btn-primary text-white text-xs font-bold transition cursor-pointer">
                {{ 'header.signIn' | translate }}
              </button>
            }
            <button
              type="button"
              (click)="goBack()"
              class="px-4 py-2 rounded-xl glass-btn text-slate-200 hover:text-white text-xs font-bold transition cursor-pointer">
              {{ 'analytics.backToStore' | translate }}
            </button>
          </div>
        </div>
      } @else {
        <!-- Scope Selector Bar: All Packages Overview vs Individual Author Packages -->
        <div class="p-4 rounded-2xl glass-panel space-y-3">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <svg lucidePackage class="w-3.5 h-3.5 text-sky-400"></svg>
              <span>{{ 'analytics.scopeLabel' | translate }}</span>
            </span>

            @if (selectedPackage(); as activePkg) {
              <button
                type="button"
                (click)="openPackageDetails(activePkg)"
                class="px-3 py-1 rounded-xl glass-btn text-sky-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer">
                <span>{{ 'card.viewPackageDetails' | translate }}</span>
                <svg lucideExternalLink class="w-3.5 h-3.5"></svg>
              </button>
            }
          </div>

          <div class="flex items-center gap-2 overflow-x-auto pb-1">
            <!-- All Packages Pill -->
            <button
              type="button"
              (click)="selectAllPackages()"
              [class]="!selectedPackageName()
                ? 'glass-btn-sky text-white shadow-sm'
                : 'glass-btn text-slate-300 hover:text-white'"
              class="px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition cursor-pointer flex-shrink-0">
              <svg lucideTrendingUp class="w-3.5 h-3.5"></svg>
              <span>{{ 'analytics.allPackages' | translate }} ({{ authorPackages().length }})</span>
            </button>

            <!-- Individual Package Pills -->
            @for (pkg of authorPackages(); track pkg.id) {
              <button
                type="button"
                (click)="selectSpecificPackage(pkg.author, pkg.name)"
                [class]="selectedPackageName()?.toLowerCase() === pkg.name.toLowerCase()
                  ? 'glass-btn-sky text-white shadow-sm'
                  : 'glass-btn text-slate-300 hover:text-white'"
                class="px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-2 transition cursor-pointer flex-shrink-0">
                <img
                  [src]="pkg.thumbnail || 'logo.svg'"
                  [alt]="pkg.title"
                  class="w-4 h-4 rounded object-cover bg-slate-900 flex-shrink-0"
                />
                <span>{{ pkg.title }}</span>
              </button>
            }
          </div>
        </div>

        <!-- Main Chart.js v4 Analytics Workspace -->
        <app-download-analytics-chart
          [package]="selectedPackage()"
          [authorUsername]="selectedPackage() ? null : effectiveUsername()"
          [showExpandButton]="false"
          (selectPackage)="onSelectPackageFromBreakdown($event)">
        </app-download-analytics-chart>
      }
    </div>
  `
})
export class AnalyticsPageComponent implements OnInit, OnDestroy {
  readonly packageService = inject(PackageService);
  readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly routeUsername = signal<string>('');
  readonly selectedPackageName = signal<string>('');
  adminLookupInput = '';

  private routeSub: Subscription | null = null;

  readonly effectiveUsername = computed<string>(() => {
    const fromRoute = this.routeUsername().trim();
    if (fromRoute) return fromRoute;
    return (this.authService.currentUser()?.username || '').trim();
  });

  readonly authorPackages = computed<LuantiPackage[]>(() => {
    const uname = this.effectiveUsername();
    if (!uname) return [];
    return this.packageService.getAuthorPackages(uname);
  });

  readonly selectedPackage = computed<LuantiPackage | null>(() => {
    const pkgName = this.selectedPackageName().trim().toLowerCase();
    const uname = this.effectiveUsername().trim();
    if (!pkgName || !uname) return null;
    const match = this.authorPackages().find(p => p.name.toLowerCase() === pkgName);
    if (match) return match;
    return {
      id: `${uname}/${pkgName}`,
      author: uname,
      name: pkgName,
      title: pkgName.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      type: 'mod',
      short_desc: '',
      thumbnail: 'logo.svg',
      score: 0,
      downloads: 0,
      license: 'MIT',
      source: 'official',
      tags: ['mod']
    };
  });

  readonly canViewAnalytics = computed<boolean>(() => {
    if (this.authService.isAdmin()) return true;
    const user = this.authService.currentUser();
    if (!user) return false;

    const pkg = this.selectedPackage();
    if (pkg && this.authService.canManagePackage(pkg)) {
      return true;
    }

    const target = this.effectiveUsername().toLowerCase();
    if (!target) return false;
    const baseTarget = target.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, '');

    const userHandles = new Set<string>();
    if (user.username) {
      const u = user.username.toLowerCase();
      userHandles.add(u);
      userHandles.add(u.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, ''));
    }
    for (const id of user.identities || []) {
      if (id.verified !== false && id.username) {
        const h = id.username.toLowerCase();
        userHandles.add(h);
        userHandles.add(h.replace(/[-_](?:hub|git|dev|lab|mods?|gi|gl|co|cd|me)$/i, ''));
      }
    }

    return userHandles.has(target) || (baseTarget.length > 0 && userHandles.has(baseTarget));
  });

  ngOnInit(): void {
    this.routeSub = this.route.paramMap.subscribe(params => {
      const u = (params.get('username') || '').trim();
      const p = (params.get('packageName') || '').trim();
      this.routeUsername.set(u);
      this.selectedPackageName.set(p);
      this.adminLookupInput = u || this.authService.currentUser()?.username || '';
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  goBack(): void {
    this.packageService.closeAnalyticsPage();
  }

  selectAllPackages(): void {
    const uname = this.effectiveUsername();
    if (!uname) return;
    this.selectedPackageName.set('');
    this.router.navigate(['/analytics', uname]);
  }

  selectSpecificPackage(author: string, name: string): void {
    const cleanA = (author || this.effectiveUsername()).trim();
    const cleanN = (name || '').trim();
    if (!cleanA || !cleanN) return;
    this.selectedPackageName.set(cleanN);
    this.router.navigate(['/analytics', cleanA, cleanN]);
  }

  onSelectPackageFromBreakdown(ev: { author: string; name: string }): void {
    this.selectSpecificPackage(ev.author || this.effectiveUsername(), ev.name);
  }

  openPackageDetails(pkg: LuantiPackage): void {
    this.packageService.openPackageModal(pkg, true);
  }

  applyAdminAuthorLookup(): void {
    const clean = (this.adminLookupInput || '').trim().replace(/^@/, '');
    if (!clean) return;
    this.selectedPackageName.set('');
    this.router.navigate(['/analytics', clean]);
  }
}
