import {
  Component,
  ChangeDetectionStrategy,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewInit,
  inject,
  signal,
  computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Chart,
  LineController,
  BarController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
  Plugin
} from 'chart.js';
import { PackageService } from '../../core/services/package.service';
import {
  LuantiPackage,
  DownloadAnalyticsData,
  AuthorPackageBreakdownItem
} from '../../core/models/package.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TranslationService } from '../../core/i18n/translation.service';
import { FrostedPreloaderComponent } from './frosted-preloader.component';
import {
  LucideDownload,
  LucideTrendingUp,
  LucideGamepad2,
  LucideEye,
  LucideLayers,
  LucideRefreshCw,
  LucideMaximize2,
  LucideSparkles,
  LucidePackage
} from '@lucide/angular';

const luantiCrosshairPlugin: Plugin = {
  id: 'luantiCrosshair',
  afterDraw(chart: Chart) {
    const tooltip = chart.tooltip;
    if (!tooltip || !tooltip.getActiveElements()?.length) return;
    const activePoint = tooltip.getActiveElements()[0];
    if (!activePoint) return;
    const x = activePoint.element.x;
    const topY = chart.scales['y']?.top ?? chart.chartArea.top;
    const bottomY = chart.scales['y']?.bottom ?? chart.chartArea.bottom;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, bottomY);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.restore();
  }
};

Chart.register(
  LineController,
  BarController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
  Legend,
  luantiCrosshairPlugin
);

export type AnalyticsTimeframe = 7 | 30 | 90 | 365;
export type AnalyticsSeriesMode = 'reason' | 'platform' | 'source' | 'packages';
export type AnalyticsChartStyle = 'area' | 'bar';

interface ChartSeriesDef {
  key: string;
  label: string;
  color: string;
  bgColor: string;
  data: number[];
}

const PACKAGE_PALETTE: Array<{ border: string; bg: string }> = [
  { border: '#38bdf8', bg: 'rgba(56, 189, 248, 0.28)' },
  { border: '#34d399', bg: 'rgba(52, 211, 153, 0.28)' },
  { border: '#a855f7', bg: 'rgba(168, 85, 247, 0.28)' },
  { border: '#fbbf24', bg: 'rgba(251, 191, 36, 0.28)' },
  { border: '#f43f5e', bg: 'rgba(244, 63, 94, 0.28)' },
  { border: '#818cf8', bg: 'rgba(129, 140, 248, 0.28)' }
];

@Component({
  selector: 'app-download-analytics-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    TranslatePipe,
    FrostedPreloaderComponent,
    LucideDownload,
    LucideTrendingUp,
    LucideGamepad2,
    LucideEye,
    LucideLayers,
    LucideRefreshCw,
    LucideMaximize2,
    LucideSparkles,
    LucidePackage
  ],
  template: `
    <div class="space-y-5">
      <!-- Top Controls Bar: Timeframe + Series Mode + Chart Style + Export CSV / Expand -->
      <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl glass-panel">
        <!-- Timeframe Selector (7D / 30D / 90D / 1Y) -->
        <div class="flex items-center gap-1.5" role="group" aria-label="Timeframe presets">
          @for (tf of timeframes; track tf.days) {
            <button
              type="button"
              (click)="setTimeframe(tf.days)"
              [class]="selectedDays() === tf.days
                ? 'glass-btn-sky text-white shadow-sm'
                : 'glass-btn text-slate-300 hover:text-white'"
              class="px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer">
              {{ tf.label }}
            </button>
          }
        </div>

        <!-- Series Grouping Mode Selector -->
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            (click)="setSeriesMode('reason')"
            [class]="seriesMode() === 'reason' ? 'glass-btn-sky text-white' : 'glass-btn text-slate-300 hover:text-white'"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer">
            {{ 'analytics.byReason' | translate }}
          </button>
          <button
            type="button"
            (click)="setSeriesMode('platform')"
            [class]="seriesMode() === 'platform' ? 'glass-btn-sky text-white' : 'glass-btn text-slate-300 hover:text-white'"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer">
            {{ 'analytics.byPlatform' | translate }}
          </button>
          <button
            type="button"
            (click)="setSeriesMode('source')"
            [class]="seriesMode() === 'source' ? 'glass-btn-sky text-white' : 'glass-btn text-slate-300 hover:text-white'"
            class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer">
            {{ 'analytics.bySource' | translate }}
          </button>
          @if (hasMultiplePackages()) {
            <button
              type="button"
              (click)="setSeriesMode('packages')"
              [class]="seriesMode() === 'packages' ? 'glass-btn-sky text-white' : 'glass-btn text-slate-300 hover:text-white'"
              class="px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer">
              {{ 'analytics.byPackage' | translate }}
            </button>
          }
        </div>

        <!-- Right Actions: Area/Bar Style + Refresh + CSV Export + Full Page Expand -->
        <div class="flex items-center gap-1.5 ml-auto">
          <div class="flex items-center rounded-xl glass-input p-0.5 border border-white/10">
            <button
              type="button"
              (click)="setChartStyle('area')"
              [class]="chartStyle() === 'area' ? 'bg-sky-500/25 text-sky-200 border border-sky-400/30' : 'text-slate-400 hover:text-white'"
              class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer">
              {{ 'analytics.styleArea' | translate }}
            </button>
            <button
              type="button"
              (click)="setChartStyle('bar')"
              [class]="chartStyle() === 'bar' ? 'bg-sky-500/25 text-sky-200 border border-sky-400/30' : 'text-slate-400 hover:text-white'"
              class="px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer">
              {{ 'analytics.styleBar' | translate }}
            </button>
          </div>

          <button
            type="button"
            (click)="loadStats(true)"
            [disabled]="isLoading()"
            [attr.aria-label]="'common.refresh' | translate"
            class="p-2 rounded-xl glass-btn text-slate-300 hover:text-white transition cursor-pointer disabled:opacity-50">
            <svg lucideRefreshCw class="w-3.5 h-3.5" [class.animate-spin]="isLoading()"></svg>
          </button>

          <button
            type="button"
            (click)="exportCsv()"
            [disabled]="!statsData()"
            class="px-3 py-1.5 rounded-xl glass-btn text-slate-200 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50">
            <svg lucideDownload class="w-3.5 h-3.5 text-emerald-400"></svg>
            <span>{{ 'analytics.exportCsv' | translate }}</span>
          </button>

          @if (showExpandButton) {
            <button
              type="button"
              (click)="openFullAnalyticsPage()"
              class="px-3 py-1.5 rounded-xl glass-btn-sky text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer">
              <svg lucideMaximize2 class="w-3.5 h-3.5"></svg>
              <span>{{ 'analytics.expandFullPage' | translate }}</span>
            </button>
          }
        </div>
      </div>

      @if (isLoading() && !statsData()) {
        <div class="py-16 flex items-center justify-center rounded-2xl glass-panel">
          <app-frosted-preloader
            variant="inline"
            size="md"
            [label]="'analytics.loadingStats' | translate">
          </app-frosted-preloader>
        </div>
      } @else if (statsData(); as data) {
        <!-- 4 KPI Summary Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <!-- KPI 1: Period Downloads & Velocity Delta -->
          <div class="p-4 rounded-2xl glass-panel space-y-1.5">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="font-semibold">{{ 'analytics.periodDownloads' | translate }}</span>
              <svg lucideDownload class="w-4 h-4 text-sky-400"></svg>
            </div>
            <div class="flex items-baseline gap-2.5">
              <span class="text-2xl font-black text-white tabular-nums">
                {{ data.summary.periodDownloads | number }}
              </span>
              <span
                [class]="data.summary.trendPercent >= 0
                  ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/30'
                  : 'text-rose-300 bg-rose-500/15 border-rose-400/30'"
                class="px-2 py-0.5 rounded-full text-[11px] font-bold border tabular-nums">
                {{ data.summary.trendPercent >= 0 ? '+' : '' }}{{ data.summary.trendPercent }}%
              </span>
            </div>
            <p class="text-[11px] text-slate-400 tabular-nums">
              {{ data.summary.avgPerDay | number:'1.1-1' }} / {{ 'analytics.perDayAvg' | translate }}
            </p>
          </div>

          <!-- KPI 2: Primary Install Driver -->
          <div class="p-4 rounded-2xl glass-panel space-y-1.5">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="font-semibold">{{ 'analytics.primaryDriver' | translate }}</span>
              <svg lucideSparkles class="w-4 h-4 text-emerald-400"></svg>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-xl font-black text-white truncate">
                {{ primaryDriver().label | translate }}
              </span>
              <span class="text-xs font-bold text-emerald-400 tabular-nums">
                {{ primaryDriver().percent }}%
              </span>
            </div>
            <p class="text-[11px] text-slate-400 tabular-nums">
              {{ primaryDriver().count | number }} {{ 'analytics.downloadsInPeriod' | translate }}
            </p>
          </div>

          <!-- KPI 3: Client Ratio (Luanti In-Game vs Web) -->
          <div class="p-4 rounded-2xl glass-panel space-y-1.5">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="font-semibold">{{ 'analytics.clientPlatformRatio' | translate }}</span>
              <svg lucideGamepad2 class="w-4 h-4 text-purple-400"></svg>
            </div>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-black text-white tabular-nums">
                {{ luantiPlatformPercent() }}%
              </span>
              <span class="text-xs text-purple-300 font-semibold">
                {{ 'analytics.platformLuanti' | translate }}
              </span>
            </div>
            <p class="text-[11px] text-slate-400 tabular-nums">
              {{ data.summary.platformsTotal.luanti | number }} {{ 'analytics.inGame' | translate }} •
              {{ data.summary.platformsTotal.web | number }} {{ 'analytics.web' | translate }}
            </p>
          </div>

          <!-- KPI 4: Store Views & View-to-Download Conversion -->
          <div class="p-4 rounded-2xl glass-panel space-y-1.5">
            <div class="flex items-center justify-between text-xs text-slate-400">
              <span class="font-semibold">{{ 'analytics.viewsAndConversion' | translate }}</span>
              <svg lucideEye class="w-4 h-4 text-amber-400"></svg>
            </div>
            <div class="flex items-baseline gap-2.5">
              <span class="text-2xl font-black text-white tabular-nums">
                {{ data.summary.totalViews | number }}
              </span>
              @if (data.summary.totalViews > 0) {
                <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 border border-amber-400/30 text-amber-300 tabular-nums">
                  {{ data.summary.conversionRatePercent }}% {{ 'analytics.converted' | translate }}
                </span>
              }
            </div>
            <p class="text-[11px] text-slate-400 tabular-nums">
              {{ data.summary.viewsLuanti | number }} {{ 'analytics.inGameViews' | translate }} •
              {{ data.summary.viewsWeb | number }} {{ 'analytics.webViews' | translate }}
            </p>
          </div>
        </div>

        <!-- Interactive Chart.js Timeline Stage -->
        <div class="p-4 sm:p-5 rounded-2xl glass-panel space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-sm font-bold text-white flex items-center gap-2">
                <svg lucideTrendingUp class="w-4 h-4 text-sky-400"></svg>
                <span>{{ 'analytics.timelineTitle' | translate }}</span>
              </h3>
              <p class="text-xs text-slate-400">
                {{ data.dates[0] }} — {{ data.dates[data.dates.length - 1] }}
              </p>
            </div>

            <!-- Interactive Series Legend Pills -->
            <div class="flex flex-wrap items-center gap-1.5">
              @for (s of activeSeriesList(); track s.key) {
                <button
                  type="button"
                  (click)="toggleSeriesVisibility(s.key)"
                  [class.opacity-40]="isSeriesHidden(s.key)"
                  class="px-2.5 py-1 rounded-lg glass-btn text-[11px] font-semibold text-slate-200 hover:text-white flex items-center gap-1.5 transition cursor-pointer">
                  <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" [style.backgroundColor]="s.color"></span>
                  <span>{{ s.label }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Responsive Touch-Friendly Canvas Container -->
          <div class="relative w-full h-64 sm:h-80 select-none" style="touch-action: pan-y;">
            <canvas #chartCanvas class="w-full h-full"></canvas>
          </div>

          <!-- Hover / Touch Day Readout Strip -->
          @if (inspectedDay(); as dayInfo) {
            <div class="p-3 rounded-xl bg-slate-900/80 border border-sky-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div class="flex items-center gap-2">
                <span class="font-mono font-bold text-sky-300">{{ dayInfo.date }}</span>
                <span class="text-slate-500">•</span>
                <span class="font-bold text-white">{{ dayInfo.total | number }} {{ 'card.downloads' | translate }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-3">
                @for (item of dayInfo.items; track item.label) {
                  <span class="flex items-center gap-1.5 text-slate-300 tabular-nums">
                    <span class="w-2 h-2 rounded-full" [style.backgroundColor]="item.color"></span>
                    <span>{{ item.label }}: <strong class="text-white">{{ item.value | number }}</strong></span>
                  </span>
                }
              </div>
            </div>
          }
        </div>

        <!-- Download Reason Breakdown Bar & Cards -->
        <div class="p-4 sm:p-5 rounded-2xl glass-panel space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-bold text-white flex items-center gap-2">
              <svg lucideLayers class="w-4 h-4 text-emerald-400"></svg>
              <span>{{ 'analytics.reasonBreakdownTitle' | translate }}</span>
            </h3>
            <span class="text-xs text-slate-400 tabular-nums">
              {{ data.summary.periodDownloads | number }} {{ 'card.downloads' | translate }}
            </span>
          </div>

          <!-- Stacked Percentage Progress Bar -->
          <div class="w-full h-3 rounded-full bg-slate-900/90 overflow-hidden flex border border-white/10">
            @for (rb of reasonBreakdownItems(); track rb.key) {
              @if (rb.percent > 0) {
                <div
                  [style.width.%]="rb.percent"
                  [style.backgroundColor]="rb.color"
                  [title]="(rb.labelKey | translate) + ': ' + rb.count + ' (' + rb.percent + '%)'"
                  class="h-full transition-all duration-300">
                </div>
              }
            }
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            @for (rb of reasonBreakdownItems(); track rb.key) {
              <div class="p-3 rounded-xl bg-slate-900/55 border border-white/10 space-y-1">
                <div class="flex items-center justify-between text-xs">
                  <span class="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" [style.backgroundColor]="rb.color"></span>
                    <span>{{ rb.labelKey | translate }}</span>
                  </span>
                  <span class="font-bold text-white tabular-nums">{{ rb.percent }}%</span>
                </div>
                <div class="text-lg font-extrabold text-white tabular-nums">
                  {{ rb.count | number }}
                </div>
                <p class="text-[11px] text-slate-400 leading-snug">
                  {{ rb.descKey | translate }}
                </p>
              </div>
            }
          </div>
        </div>

        <!-- Author Portfolio Per-Package Leaderboard (when in Author Overview mode) -->
        @if (data.package_breakdown && data.package_breakdown.length > 0) {
          <div class="p-4 sm:p-5 rounded-2xl glass-panel space-y-3.5">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-white flex items-center gap-2">
                <svg lucidePackage class="w-4 h-4 text-sky-400"></svg>
                <span>{{ 'analytics.packageBreakdownTitle' | translate }} ({{ data.package_breakdown.length }})</span>
              </h3>
              <span class="text-xs text-slate-400">
                {{ 'analytics.clickPackageToFilter' | translate }}
              </span>
            </div>

            <div class="space-y-2">
              @for (pkgItem of data.package_breakdown.slice(0, 15); track pkgItem.id) {
                <button
                  type="button"
                  (click)="onPackageBreakdownClick(pkgItem)"
                  class="w-full p-3 rounded-xl bg-slate-900/55 hover:bg-slate-800/75 border border-white/10 hover:border-sky-400/40 transition flex items-center justify-between gap-4 text-left cursor-pointer group">
                  <div class="min-w-0 flex-1 space-y-1.5">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-xs sm:text-sm font-bold text-white group-hover:text-sky-300 transition truncate">
                        {{ pkgItem.title }}
                        <span class="text-[11px] font-mono text-slate-400 font-normal ml-1">({{ pkgItem.name }})</span>
                      </span>
                      <span class="text-xs font-extrabold text-white tabular-nums flex-shrink-0">
                        {{ pkgItem.totalPeriodDownloads | number }}
                        <span class="text-sky-400 font-semibold ml-1">({{ pkgItem.sharePercent }}%)</span>
                      </span>
                    </div>
                    <div class="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden">
                      <div
                        class="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all duration-300"
                        [style.width.%]="Math.max(2, pkgItem.sharePercent)">
                      </div>
                    </div>
                  </div>
                </button>
              }
            </div>
          </div>
        }
      }
    </div>
  `
})
export class DownloadAnalyticsChartComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() package?: LuantiPackage | null;
  @Input() authorUsername?: string | null;
  @Input() showExpandButton = false;
  @Output() selectPackage = new EventEmitter<{ author: string; name: string }>();

  @ViewChild('chartCanvas') chartCanvasRef?: ElementRef<HTMLCanvasElement>;

  private readonly packageService = inject(PackageService);
  private readonly translationService = inject(TranslationService);

  readonly Math = Math;

  readonly timeframes: Array<{ days: AnalyticsTimeframe; label: string }> = [
    { days: 7, label: '7D' },
    { days: 30, label: '30D' },
    { days: 90, label: '90D' },
    { days: 365, label: '1Y' }
  ];

  readonly selectedDays = signal<AnalyticsTimeframe>(30);
  readonly seriesMode = signal<AnalyticsSeriesMode>('reason');
  readonly chartStyle = signal<AnalyticsChartStyle>('area');
  readonly statsData = signal<DownloadAnalyticsData | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly hiddenSeries = signal<Set<string>>(new Set());
  readonly hoveredIndex = signal<number | null>(null);

  private chartInstance: Chart | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private viewReady = false;
  private requestSeq = 0;

  readonly hasMultiplePackages = computed<boolean>(() => {
    const breakdown = this.statsData()?.package_breakdown;
    return Array.isArray(breakdown) && breakdown.length > 0;
  });

  readonly luantiPlatformPercent = computed<number>(() => {
    const s = this.statsData()?.summary;
    if (!s) return 0;
    const tot = (s.platformsTotal.luanti || 0) + (s.platformsTotal.web || 0);
    if (tot <= 0) return 0;
    return Number(((s.platformsTotal.luanti / tot) * 100).toFixed(1));
  });

  readonly primaryDriver = computed<{ label: string; count: number; percent: number }>(() => {
    const s = this.statsData()?.summary;
    if (!s) {
      return { label: 'analytics.reasonNew', count: 0, percent: 0 };
    }
    const entries = [
      { label: 'analytics.reasonNew', count: s.reasonsTotal.new || 0 },
      { label: 'analytics.reasonUpdate', count: s.reasonsTotal.update || 0 },
      { label: 'analytics.reasonDependency', count: s.reasonsTotal.dependency || 0 },
      { label: 'analytics.reasonWeb', count: s.reasonsTotal.web || 0 }
    ].sort((a, b) => b.count - a.count);
    const top = entries[0];
    const tot = Math.max(1, s.periodDownloads || 0);
    const pct = s.periodDownloads > 0 ? Number(((top.count / tot) * 100).toFixed(1)) : 0;
    return { label: top.label, count: top.count, percent: pct };
  });

  readonly reasonBreakdownItems = computed(() => {
    const s = this.statsData()?.summary;
    const total = Math.max(1, s?.periodDownloads || 0);
    const hasDownloads = (s?.periodDownloads || 0) > 0;
    const items = [
      {
        key: 'new',
        labelKey: 'analytics.reasonNew',
        descKey: 'analytics.reasonNewDesc',
        color: '#34d399',
        count: s?.reasonsTotal.new || 0
      },
      {
        key: 'update',
        labelKey: 'analytics.reasonUpdate',
        descKey: 'analytics.reasonUpdateDesc',
        color: '#38bdf8',
        count: s?.reasonsTotal.update || 0
      },
      {
        key: 'dependency',
        labelKey: 'analytics.reasonDependency',
        descKey: 'analytics.reasonDependencyDesc',
        color: '#a855f7',
        count: s?.reasonsTotal.dependency || 0
      },
      {
        key: 'web',
        labelKey: 'analytics.reasonWeb',
        descKey: 'analytics.reasonWebDesc',
        color: '#fbbf24',
        count: s?.reasonsTotal.web || 0
      }
    ];
    return items.map(item => ({
      ...item,
      percent: hasDownloads ? Number(((item.count / total) * 100).toFixed(1)) : 0
    }));
  });

  readonly activeSeriesList = computed<ChartSeriesDef[]>(() => {
    const data = this.statsData();
    if (!data) return [];
    const mode = this.seriesMode();
    const t = (key: string) => this.translationService.translate(key);

    if (mode === 'platform') {
      return [
        {
          key: 'platform_luanti',
          label: t('analytics.platformLuanti'),
          color: '#38bdf8',
          bgColor: 'rgba(56, 189, 248, 0.28)',
          data: data.platform_luanti
        },
        {
          key: 'platform_web',
          label: t('analytics.platformWeb'),
          color: '#fbbf24',
          bgColor: 'rgba(251, 191, 36, 0.28)',
          data: data.platform_web
        }
      ];
    }

    if (mode === 'source') {
      return [
        {
          key: 'source_contentdb',
          label: 'ContentDB',
          color: '#38bdf8',
          bgColor: 'rgba(56, 189, 248, 0.28)',
          data: data.source_contentdb
        },
        {
          key: 'source_luantihub',
          label: 'LuantiHub Edge',
          color: '#34d399',
          bgColor: 'rgba(52, 211, 153, 0.28)',
          data: data.source_luantihub
        }
      ];
    }

    if (mode === 'packages' && Array.isArray(data.package_breakdown) && data.package_breakdown.length > 0) {
      return data.package_breakdown.slice(0, 6).map((pkg, idx) => {
        const pal = PACKAGE_PALETTE[idx % PACKAGE_PALETTE.length];
        return {
          key: `pkg_${pkg.id}`,
          label: pkg.title,
          color: pal.border,
          bgColor: pal.bg,
          data: pkg.daily
        };
      });
    }

    return [
      {
        key: 'reason_new',
        label: t('analytics.reasonNew'),
        color: '#34d399',
        bgColor: 'rgba(52, 211, 153, 0.28)',
        data: data.reason_new
      },
      {
        key: 'reason_update',
        label: t('analytics.reasonUpdate'),
        color: '#38bdf8',
        bgColor: 'rgba(56, 189, 248, 0.28)',
        data: data.reason_update
      },
      {
        key: 'reason_dependency',
        label: t('analytics.reasonDependency'),
        color: '#a855f7',
        bgColor: 'rgba(168, 85, 247, 0.28)',
        data: data.reason_dependency
      },
      {
        key: 'reason_web',
        label: t('analytics.reasonWeb'),
        color: '#fbbf24',
        bgColor: 'rgba(251, 191, 36, 0.28)',
        data: data.reason_web
      }
    ];
  });

  readonly inspectedDay = computed(() => {
    const data = this.statsData();
    const idx = this.hoveredIndex();
    if (!data || idx === null || idx < 0 || idx >= data.dates.length) return null;
    const series = this.activeSeriesList().filter(s => !this.hiddenSeries().has(s.key));
    return {
      date: data.dates[idx],
      total: data.total[idx] || 0,
      items: series.map(s => ({
        label: s.label,
        color: s.color,
        value: s.data[idx] || 0
      }))
    };
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['package'] || changes['authorUsername']) {
      this.loadStats(false);
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderOrUpdateChart();
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  setTimeframe(days: AnalyticsTimeframe): void {
    if (this.selectedDays() === days) return;
    this.selectedDays.set(days);
    this.loadStats(false);
  }

  setSeriesMode(mode: AnalyticsSeriesMode): void {
    if (this.seriesMode() === mode) return;
    this.seriesMode.set(mode);
    this.hiddenSeries.set(new Set());
    this.renderOrUpdateChart();
  }

  setChartStyle(style: AnalyticsChartStyle): void {
    if (this.chartStyle() === style) return;
    this.chartStyle.set(style);
    this.renderOrUpdateChart();
  }

  isSeriesHidden(key: string): boolean {
    return this.hiddenSeries().has(key);
  }

  toggleSeriesVisibility(key: string): void {
    const next = new Set(this.hiddenSeries());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.hiddenSeries.set(next);
    this.renderOrUpdateChart();
  }

  async loadStats(forceRefresh = false): Promise<void> {
    const reqId = ++this.requestSeq;
    const pkg = this.package;
    const authorUser = (this.authorUsername || '').trim();
    const days = this.selectedDays();

    if (!pkg && !authorUser) return;

    this.isLoading.set(true);
    try {
      const result = pkg
        ? await this.packageService.fetchPackageStats(pkg.author, pkg.name, days, forceRefresh)
        : await this.packageService.fetchAuthorStats(authorUser, days, forceRefresh);

      if (reqId !== this.requestSeq) return;
      this.statsData.set(result);
      this.hoveredIndex.set(result && result.dates.length > 0 ? result.dates.length - 1 : null);
      setTimeout(() => this.renderOrUpdateChart(), 0);
    } finally {
      if (reqId === this.requestSeq) {
        this.isLoading.set(false);
      }
    }
  }

  openFullAnalyticsPage(): void {
    if (this.package) {
      this.packageService.openAnalyticsPage(this.package.author, this.package.name);
    } else if (this.authorUsername) {
      this.packageService.openAnalyticsPage(this.authorUsername);
    }
  }

  onPackageBreakdownClick(item: AuthorPackageBreakdownItem): void {
    this.selectPackage.emit({ author: item.author, name: item.name });
  }

  exportCsv(): void {
    const data = this.statsData();
    if (!data || typeof document === 'undefined') return;

    const headers = [
      'date',
      'total',
      'reason_new',
      'reason_update',
      'reason_dependency',
      'reason_web',
      'platform_luanti',
      'platform_web',
      'source_contentdb',
      'source_luantihub',
      'views_luanti',
      'views_web'
    ];
    const rows = data.dates.map((dt, i) =>
      [
        dt,
        data.total[i] || 0,
        data.reason_new[i] || 0,
        data.reason_update[i] || 0,
        data.reason_dependency[i] || 0,
        data.reason_web[i] || 0,
        data.platform_luanti[i] || 0,
        data.platform_web[i] || 0,
        data.source_contentdb[i] || 0,
        data.source_luantihub[i] || 0,
        data.views_luanti[i] || 0,
        data.views_web[i] || 0
      ].join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const slug = (data.name || data.username || 'luantihub').replace(/[^a-z0-9_-]/gi, '_');
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${slug}_analytics_${data.days}d.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  private destroyChart(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  private renderOrUpdateChart(): void {
    if (!this.viewReady) return;
    const canvas = this.chartCanvasRef?.nativeElement;
    const data = this.statsData();
    if (!canvas || !data) return;

    // Guard for jsdom unit test environment where HTMLCanvasElement.getContext is not implemented
    if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '')) {
      return;
    }

    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    if (!ctx) return;

    this.destroyChart();

    const isBar = this.chartStyle() === 'bar';
    const hidden = this.hiddenSeries();
    const datasets = this.activeSeriesList()
      .filter(s => !hidden.has(s.key))
      .map(s => ({
        label: s.label,
        data: s.data,
        borderColor: s.color,
        backgroundColor: isBar ? s.color : s.bgColor,
        borderWidth: isBar ? 0 : 2,
        borderRadius: isBar ? 4 : 0,
        fill: !isBar,
        tension: 0.32,
        pointRadius: data.dates.length <= 14 ? 3 : 0,
        pointHoverRadius: 5,
        stack: 'downloads'
      }));

    this.chartInstance = new Chart(ctx, {
      type: isBar ? 'bar' : 'line',
      data: {
        labels: data.dates.map(d => d.slice(5)),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            backgroundColor: 'rgba(9, 14, 28, 0.94)',
            titleColor: '#f8fafc',
            bodyColor: '#cbd5e1',
            borderColor: 'rgba(56, 189, 248, 0.35)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 12
          }
        },
        onHover: (_event, elements) => {
          if (elements && elements.length > 0) {
            this.hoveredIndex.set(elements[0].index);
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.04)'
            },
            ticks: {
              color: '#94a3b8',
              maxTicksLimit: 10,
              font: { size: 11 }
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.06)'
            },
            ticks: {
              color: '#94a3b8',
              precision: 0,
              font: { size: 11 }
            }
          }
        }
      }
    });
  }
}
