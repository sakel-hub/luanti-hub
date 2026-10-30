import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthUser, GitProvider, ModerationReport, LuantiPackage } from '../models/package.model';
import { SettingsService } from './settings.service';
import { PwaService } from './pwa.service';

export function sanitizeUserFacingError(
  rawError: any,
  fallbackMessage = 'A temporary error occurred. Please try again in a moment.'
): string {
  const raw = typeof rawError === 'string' ? rawError.trim() : String(rawError?.message || '').trim();
  if (!raw) return fallbackMessage;

  const sensitivePattern =
    /\b(D1_[A-Z_]*|SQLITE_[A-Z_]*|SQLITE\b|no such table|no such column|has no column named|table [a-z0-9_]+ has no|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed|CHECK constraint failed|SYNTAX_ERROR|near ".+": syntax error|PRAGMA\b|ALTER TABLE\b|INSERT INTO\b|UPDATE [a-z0-9_]+ SET|DELETE FROM\b|SELECT .+ FROM|TypeError:|ReferenceError:|SyntaxError:|RangeError:|Cannot read propert(y|ies) of|Workers? runtime|cloudflare-internal)/i;

  if (sensitivePattern.test(raw) || raw.startsWith('<!DOCTYPE') || raw.startsWith('<html')) {
    return fallbackMessage;
  }

  return raw;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly settingsService = inject(SettingsService);
  private readonly pwaService = inject(PwaService);
  private readonly router = inject(Router, { optional: true });

  private readonly _currentUser = signal<AuthUser | null>(null);
  private readonly _isAuthModalOpen = signal<boolean>(false);
  private readonly _isProfileDrawerOpen = signal<boolean>(false);
  private readonly _isLoading = signal<boolean>(false);
  private readonly _isOAuthRedirecting = signal<boolean>(false);
  private readonly _isCompletingOAuth = signal<boolean>(false);
  private readonly _authError = signal<string | null>(null);
  private readonly _selectedProvider = signal<GitProvider>('contentdb');
  private readonly _oauthProviders = signal<Record<string, boolean>>({});
  private readonly _moderationReports = signal<ModerationReport[]>([]);
  private readonly _myReports = signal<ModerationReport[]>([]);
  private readonly _myReportsPage = signal<number>(1);
  private readonly _myReportsPageSize = signal<number>(5);
  private readonly _myReportsTotal = signal<number>(0);
  private readonly _myReportsTotalPages = signal<number>(1);
  private readonly _delistedPackages = signal<LuantiPackage[]>([]);
  private readonly _moderationPage = signal<number>(1);
  private readonly _moderationPageSize = signal<number>(10);
  private readonly _moderationTotal = signal<number>(0);
  private readonly _moderationTotalPages = signal<number>(1);
  private readonly _moderationStatusFilter = signal<'open' | 'closed' | 'delisted'>('open');
  private readonly _moderationReasonFilter = signal<string>('all');
  private readonly _closedReportsCount = signal<number>(0);
  private readonly _requestedDrawerTab = signal<'packages' | 'favorites' | 'account' | 'moderation' | null>(null);
  private lastModerationFetchAt = 0;
  private lastMyReportsFetchAt = 0;
  private lastAuthFetchAt = 0;

  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthModalOpen = this._isAuthModalOpen.asReadonly();
  readonly isProfileDrawerOpen = this._isProfileDrawerOpen.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly isOAuthRedirecting = this._isOAuthRedirecting.asReadonly();
  readonly isCompletingOAuth = this._isCompletingOAuth.asReadonly();
  readonly isBusyAuthenticating = computed(
    () =>
      this._isOAuthRedirecting() ||
      this._isCompletingOAuth() ||
      (this._isLoading() && (this._isProfileDrawerOpen() || this._isAuthModalOpen()))
  );
  readonly authError = this._authError.asReadonly();
  readonly selectedProvider = this._selectedProvider.asReadonly();
  readonly oauthProviders = this._oauthProviders.asReadonly();
  readonly moderationReports = this._moderationReports.asReadonly();
  readonly myReports = this._myReports.asReadonly();
  readonly myReportsPage = this._myReportsPage.asReadonly();
  readonly myReportsPageSize = this._myReportsPageSize.asReadonly();
  readonly myReportsTotal = this._myReportsTotal.asReadonly();
  readonly myReportsTotalPages = this._myReportsTotalPages.asReadonly();
  readonly delistedPackages = this._delistedPackages.asReadonly();
  readonly moderationPage = this._moderationPage.asReadonly();
  readonly moderationPageSize = this._moderationPageSize.asReadonly();
  readonly moderationTotal = this._moderationTotal.asReadonly();
  readonly moderationTotalPages = this._moderationTotalPages.asReadonly();
  readonly moderationStatusFilter = this._moderationStatusFilter.asReadonly();
  readonly moderationReasonFilter = this._moderationReasonFilter.asReadonly();
  readonly closedReportsCount = this._closedReportsCount.asReadonly();
  readonly requestedDrawerTab = this._requestedDrawerTab.asReadonly();

  readonly isLoggedIn = computed(() => this._currentUser() !== null);
  readonly isAdmin = computed(() => Boolean(this._currentUser()?.is_admin || this._currentUser()?.role === 'admin'));
  readonly openReportsCount = computed(() => this._currentUser()?.open_reports_count || 0);
  readonly linkedIdentities = computed(() => this._currentUser()?.identities || []);

  constructor() {
    this.pwaService.registerNotificationClickHandler((data: any) => {
      if (data?.targetTab) {
        this._requestedDrawerTab.set(data.targetTab);
        this.openProfileDrawer();
        return;
      }
      if (data?.packageId && typeof data.packageId === 'string') {
        const [author, name] = data.packageId.split('/');
        if (author && name) {
          this.closeProfileDrawer(false);
          if (this.router) {
            this.router.navigate(['/package', author, name]);
          } else if (typeof window !== 'undefined') {
            window.location.href = `/package/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;
          }
          return;
        }
      }
      this.openProfileDrawer();
    });
    this.handleUrlAuthParams();
    this.initAuth();
  }

  setSelectedProvider(provider: GitProvider): void {
    this._selectedProvider.set(provider);
  }

  isOAuthConfigured(provider: GitProvider): boolean {
    return Boolean(this._oauthProviders()[provider]);
  }

  private handleUrlAuthParams(): void {
    if (typeof window === 'undefined' || !window.location?.search) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get('auth_error');
      const authSuccess = params.get('auth_success');
      const providerParam = params.get('provider') as GitProvider | null;
      if (providerParam && ['codeberg', 'mesehub', 'gitlab', 'github', 'contentdb'].includes(providerParam)) {
        this._selectedProvider.set(providerParam);
      }
      if (authError) {
        this.clearAuthCache();
        this._isCompletingOAuth.set(false);
        this._authError.set(authError);
        this._isAuthModalOpen.set(true);
      } else if (authSuccess) {
        this.clearAuthCache();
        this._isCompletingOAuth.set(true);
        let returnedToPackage = false;
        try {
          const savedPath = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('lh_oauth_return_path') : null;
          if (savedPath) {
            sessionStorage.removeItem('lh_oauth_return_path');
            if (savedPath.startsWith('/package/') || savedPath.startsWith('/packages/')) {
              returnedToPackage = true;
              if (this.router) {
                setTimeout(() => this.router?.navigateByUrl(savedPath), 0);
              }
            }
          }
        } catch {
          // Ignore storage error
        }
        if (!returnedToPackage && !window.location.pathname.startsWith('/package/')) {
          this._isProfileDrawerOpen.set(true);
        }
      }
      if (authError || authSuccess) {
        params.delete('auth_error');
        params.delete('auth_success');
        params.delete('provider');
        const cleanQuery = params.toString();
        const cleanUrl = window.location.pathname + (cleanQuery ? `?${cleanQuery}` : '');
        window.history.replaceState({}, '', cleanUrl);
      }
    } catch {
      // Ignore URL parse error
    }
  }

  clearAuthCache(): void {
    this.lastAuthFetchAt = 0;
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('lh_auth_cache_v1');
        sessionStorage.removeItem('lh_auth_cache_v2');
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('lh_local_user');
      }
    } catch {
      // Ignore storage error
    }
  }

  /**
   * Checks whether the currently authenticated user has a cryptographically verified
   * identity on the target Git forge (or is an admin) matching the repository owner.
   */
  hasVerifiedProviderOwnership(provider: GitProvider, repoOwner?: string): boolean {
    const user = this._currentUser();
    if (!user) return false;
    if (this.isAdmin()) return true;

    const verifiedOnProvider = (user.identities || []).filter(
      id => id.provider === provider && Boolean(id.verified)
    );
    if (verifiedOnProvider.length === 0) return false;
    if (!repoOwner) return true;

    const targetOwner = repoOwner.trim().toLowerCase();
    return verifiedOnProvider.some(id => id.username.trim().toLowerCase() === targetOwner);
  }

  inferPackageProvider(pkg?: Partial<LuantiPackage> | null): GitProvider {
    const explicit = String(pkg?.provider || '').trim().toLowerCase();
    if (
      explicit === 'github' ||
      explicit === 'codeberg' ||
      explicit === 'gitlab' ||
      explicit === 'mesehub' ||
      explicit === 'contentdb'
    ) {
      return explicit;
    }
    const repoUrl = String(pkg?.repo_url || '').trim().toLowerCase();
    if (repoUrl.includes('github.com')) return 'github';
    if (repoUrl.includes('codeberg.org')) return 'codeberg';
    if (repoUrl.includes('gitlab.com')) return 'gitlab';
    if (repoUrl.includes('minetest.land')) return 'mesehub';
    return 'contentdb';
  }

  /**
   * Checks whether the current user is an administrator or the cryptographically verified
   * owner of the given package on its hosting forge provider.
   */
  canManagePackage(pkg?: Partial<LuantiPackage> | null): boolean {
    const user = this._currentUser();
    if (!user || !pkg) return false;
    if (this.isAdmin()) return true;

    const provider = this.inferPackageProvider(pkg);
    const pkgAuthor = String(pkg.author || (pkg as any).author_name || '').trim();
    if (pkgAuthor && this.hasVerifiedProviderOwnership(provider, pkgAuthor)) {
      return true;
    }

    if (pkg.repo_url) {
      try {
        const parts = new URL(pkg.repo_url).pathname.split('/').filter(Boolean);
        if (parts.length >= 2 && this.hasVerifiedProviderOwnership(provider, parts[0])) {
          return true;
        }
      } catch {
        // ignore
      }
    }

    const pkgId = String(pkg.id || `${pkgAuthor}/${pkg.name || ''}`).toLowerCase();
    const isSubmittedByCurrentUser = (user.packages || []).some((up: any) => {
      const upAuthor = up.author || up.author_name || user.username;
      const upId = String(up.id || `${upAuthor}/${up.name}`).toLowerCase();
      return upId === pkgId && String(up.author_id || '') === String(user.id);
    });
    if (isSubmittedByCurrentUser && this.hasVerifiedProviderOwnership(provider)) {
      return true;
    }

    return false;
  }

  async initAuth(forceRefresh = false): Promise<void> {
    try {
      this._isLoading.set(true);
      this.clearLegacyBrowserAuthStorage();

      // Use in-memory cache only (never persist user profiles or identities in browser storage)
      if (!forceRefresh && this.lastAuthFetchAt > 0 && Date.now() - this.lastAuthFetchAt < 120_000) {
        return;
      }

      const res = await fetch('/api/auth/me', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        this.settingsService.edgeApiAvailable.set(true);
        const data = await res.json();
        if (data?.oauthProviders && typeof data.oauthProviders === 'object') {
          this._oauthProviders.set(data.oauthProviders);
        }
        if (res.ok) {
          this.lastAuthFetchAt = Date.now();
          if (data.user) {
            this._currentUser.set(data.user);
            this.settingsService.isAuthenticatedSession.set(true);
            this.settingsService.mergeServerDownloads(data.user.downloads);
            await this.settingsService.mergeServerFavorites(data.user.favorites);
            this.processNotificationDigest(data.user);
            if (this._isProfileDrawerOpen() && this.isAdmin()) {
              this.fetchModerationQueue();
            }
            return;
          }
        }
      }

      this.settingsService.isAuthenticatedSession.set(false);
      if (this._isProfileDrawerOpen()) {
        this._isProfileDrawerOpen.set(false);
      }
    } catch {
      // Offline / unauthenticated
    } finally {
      this._isLoading.set(false);
      this._isCompletingOAuth.set(false);
    }
  }

  private clearLegacyBrowserAuthStorage(): void {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('lh_auth_cache_v1');
        sessionStorage.removeItem('lh_auth_cache_v2');
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('lh_local_user');
      }
    } catch {
      // Ignore storage access errors
    }
  }

  private returnToPackageOnAuthClose = false;

  openAuthModal(fromPackageReview = false): void {
    if (this.isBusyAuthenticating()) {
      return;
    }
    if (this._currentUser()) {
      this.openProfileDrawer();
      return;
    }
    this.returnToPackageOnAuthClose = fromPackageReview;
    this._authError.set(null);
    this._isAuthModalOpen.set(true);
  }

  closeAuthModal(): void {
    this._isAuthModalOpen.set(false);
    this._authError.set(null);
    this.returnToPackageOnAuthClose = false;
  }

  openProfileDrawer(updateUrl = true): void {
    this._isProfileDrawerOpen.set(true);
    if (this.isAdmin()) {
      this.fetchModerationQueue();
    }
    if (updateUrl && this.router) {
      const savedY = typeof window !== 'undefined' ? window.scrollY : 0;
      this.router.navigate(['/profile'], { queryParamsHandling: 'preserve' }).then(() => {
        if (typeof window !== 'undefined' && savedY > 0 && window.scrollY !== savedY) {
          window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
        }
      });
    }
  }

  closeProfileDrawer(updateUrl = true): void {
    this._isProfileDrawerOpen.set(false);
    if (updateUrl && this.router && typeof window !== 'undefined' && window.location.pathname === '/profile') {
      const savedY = window.scrollY;
      this.router.navigate(['/'], { queryParamsHandling: 'preserve' }).then(() => {
        if (savedY > 0 && window.scrollY !== savedY) {
          window.scrollTo({ top: savedY, behavior: 'instant' as ScrollBehavior });
        }
      });
    }
  }

  loginWith(provider: GitProvider, loginHint?: string, forceAccountSelect = true): void {
    this._selectedProvider.set(provider);
    this._authError.set(null);
    if (this.isOAuthConfigured(provider)) {
      if (this._isOAuthRedirecting()) return;
      this._isOAuthRedirecting.set(true);
      this.clearAuthCache();
      if (typeof window !== 'undefined') {
        try {
          if (this.returnToPackageOnAuthClose && window.location.pathname.startsWith('/package/')) {
            sessionStorage.setItem('lh_oauth_return_path', window.location.pathname);
          }
        } catch {
          // Ignore storage error
        }
        const cleanHint = (loginHint || '').trim();
        const query = new URLSearchParams();
        if (cleanHint) query.set('login', cleanHint);
        if (forceAccountSelect) query.set('prompt', 'select_account');
        const qs = query.toString();
        window.location.href = `/api/auth/${provider}/login${qs ? `?${qs}` : ''}`;
      }
      setTimeout(() => {
        this._isOAuthRedirecting.set(false);
      }, 4000);
      return;
    }
    // When OAuth Client ID is not configured on the server, open the Auth Modal pre-selected to this provider
    this._isProfileDrawerOpen.set(false);
    this._isAuthModalOpen.set(true);
  }

  async loginWithHandle(provider: GitProvider, username: string, token?: string): Promise<{ success: boolean; message?: string }> {
    const cleanHandle = username.trim();
    const cleanToken = (token || '').trim();
    if (!cleanHandle) {
      return { success: false, message: 'Username is required.' };
    }

    try {
      this._isLoading.set(true);
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          username: cleanHandle,
          token: cleanToken || undefined
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return {
            success: false,
            message: sanitizeUserFacingError(data.error, 'Could not verify account handle.')
          };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        const stayOnPackage = this.returnToPackageOnAuthClose;
        this.closeAuthModal();
        if (!stayOnPackage) {
          this.openProfileDrawer();
        }
        return { success: true };
      }

      // Fallback when running `ng serve` locally without Cloudflare Pages Worker (in-memory only)
      const localUser: AuthUser = {
        id: `local-${cleanHandle.toLowerCase()}`,
        username: cleanHandle,
        display_name: cleanHandle,
        avatar_url: provider === 'github' ? `https://github.com/${cleanHandle}.png` : 'logo.svg',
        bio: 'Luanti Community Member',
        role: 'user',
        is_admin: false,
        identities: [
          {
            provider,
            username: cleanHandle,
            profile_url: provider === 'contentdb'
              ? `https://content.luanti.org/users/${cleanHandle}/`
              : provider === 'mesehub'
                ? `https://git.minetest.land/${cleanHandle}`
                : provider === 'codeberg'
                  ? `https://codeberg.org/${cleanHandle}`
                  : `https://${provider}.com/${cleanHandle}`,
            verified: false
          }
        ],
        packages: []
      };
      this._currentUser.set(localUser);
      const stayOnPackage = this.returnToPackageOnAuthClose;
      this.closeAuthModal();
      if (!stayOnPackage) {
        this.openProfileDrawer();
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Connection error during sign-in.') };
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Inline verification used inside the Submit Modal to verify ownership of a Git provider account
   * via a read-only Personal Access Token over HTTPS without storing credentials in the browser
   * and without closing the Submit Modal.
   */
  async verifyProviderOwnershipInline(
    provider: GitProvider,
    username: string,
    token: string
  ): Promise<{ success: boolean; message?: string }> {
    const cleanHandle = username.trim();
    const cleanToken = token.trim();
    if (!cleanHandle || !cleanToken) {
      return {
        success: false,
        message: 'Both your Git provider username and a read-only Personal Access Token are required to verify ownership.'
      };
    }

    try {
      this._isLoading.set(true);
      const res = await fetch('/api/auth/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          provider,
          username: cleanHandle,
          token: cleanToken
        })
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return {
            success: false,
            message: sanitizeUserFacingError(data.error, 'Could not verify token against the Git provider API.')
          };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        return { success: true };
      }

      return { success: false, message: 'Verification endpoint unavailable.' };
    } catch (err: any) {
      return {
        success: false,
        message: sanitizeUserFacingError(err, 'Network error while verifying repository ownership.')
      };
    } finally {
      this._isLoading.set(false);
    }
  }

  async updateProfile(payload: {
    display_name?: string;
    bio?: string;
    avatar_url?: string;
  }): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json') && res.ok) {
        this.clearAuthCache();
        await this.initAuth(true);
        this.pwaService.showToast('profile.savedSuccess');
        return { success: true };
      }

      // Local in-memory fallback update
      this._currentUser.update(u => {
        if (!u) return null;
        return {
          ...u,
          display_name: payload.display_name ?? u.display_name,
          bio: payload.bio ?? u.bio,
          avatar_url: payload.avatar_url ?? u.avatar_url
        };
      });
      this.pwaService.showToast('profile.savedSuccess');
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update profile.' };
    }
  }

  async unlinkIdentity(provider: GitProvider, username?: string): Promise<{ success: boolean; message?: string }> {
    try {
      const cleanUsername = (username || '').trim();
      const query = `provider=${encodeURIComponent(provider)}${cleanUsername ? `&username=${encodeURIComponent(cleanUsername)}` : ''}`;
      const res = await fetch(`/api/auth/me?${query}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        this.clearAuthCache();
        await this.initAuth(true);
        return { success: true };
      }
      const data = await res.json().catch(() => ({}));
      return { success: false, message: sanitizeUserFacingError(data.error, 'Could not unlink identity.') };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Error unlinking identity.') };
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network error on logout
    } finally {
      this.clearAuthCache();
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('lh_local_user');
      }
      this.settingsService.isAuthenticatedSession.set(false);
      this._currentUser.set(null);
      this.closeProfileDrawer();
    }
  }

  async syncContentDbAccount(contentDbUsername: string): Promise<{ success: boolean; count?: number; message?: string }> {
    const clean = contentDbUsername.trim();
    if (!clean) {
      return { success: false, message: 'Enter a valid ContentDB author username.' };
    }
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(clean)}/sync-contentdb`, {
        method: 'POST'
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (!res.ok) {
          return { success: false, message: sanitizeUserFacingError(data.error, 'Failed to sync ContentDB account.') };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        return { success: true, count: data.syncedCount };
      }
      return { success: false, message: 'ContentDB sync endpoint unreachable.' };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Connection error syncing ContentDB.') };
    }
  }

  async fetchModerationQueue(
    force = false,
    page?: number,
    status?: 'open' | 'closed' | 'delisted',
    reason?: string
  ): Promise<void> {
    if (!this.isAdmin()) return;

    const targetPage = page ?? this._moderationPage();
    const targetStatus = status ?? this._moderationStatusFilter();
    const targetReason = reason ?? this._moderationReasonFilter();

    this._moderationPage.set(targetPage);
    this._moderationStatusFilter.set(targetStatus);
    this._moderationReasonFilter.set(targetReason);

    if (!force && this.lastModerationFetchAt > 0 && Date.now() - this.lastModerationFetchAt < 60_000) {
      return;
    }
    this.lastModerationFetchAt = Date.now();
    try {
      const apiStatus = targetStatus === 'delisted' ? 'open' : targetStatus;
      const params = new URLSearchParams({
        status: apiStatus,
        reason: targetReason,
        page: String(targetPage),
        limit: String(this._moderationPageSize())
      });
      const res = await fetch(`/api/admin/moderation?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.reports)) {
          this._moderationReports.set(data.reports);
        }
        if (Array.isArray(data.delistedPackages)) {
          this._delistedPackages.set(data.delistedPackages);
        }
        const openCnt = typeof data.openCount === 'number'
          ? data.openCount
          : (data.reports || []).filter((r: ModerationReport) => r.status === 'open').length;
        const closedCnt = typeof data.closedCount === 'number' ? data.closedCount : 0;

        this._closedReportsCount.set(closedCnt);
        this._moderationTotal.set(typeof data.total === 'number' ? data.total : (data.reports || []).length);
        this._moderationTotalPages.set(Math.max(1, Number(data.totalPages || 1)));
        this._currentUser.update(u => u ? { ...u, open_reports_count: openCnt } : null);
        this.pwaService.syncAppBadge(openCnt);
      }
    } catch {
      // Ignore
    }
  }

  async fetchMyReports(force = false, page?: number): Promise<void> {
    if (!this.isLoggedIn()) return;
    const targetPage = Math.max(1, page ?? this._myReportsPage());
    const pageChanged = targetPage !== this._myReportsPage();
    this._myReportsPage.set(targetPage);

    if (!force && !pageChanged && this.lastMyReportsFetchAt > 0 && Date.now() - this.lastMyReportsFetchAt < 60_000) {
      return;
    }
    this.lastMyReportsFetchAt = Date.now();
    try {
      const limit = this._myReportsPageSize();
      const params = new URLSearchParams({
        mine: '1',
        page: String(targetPage),
        limit: String(limit)
      });
      const res = await fetch(`/api/admin/moderation?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.reports)) {
          this._myReports.set(data.reports);
          const total = typeof data.total === 'number' ? data.total : data.reports.length;
          const totalPages = typeof data.totalPages === 'number'
            ? Math.max(1, data.totalPages)
            : Math.max(1, Math.ceil(total / limit));
          this._myReportsTotal.set(total);
          this._myReportsTotalPages.set(totalPages);
        }
      }
    } catch {
      // Ignore
    }
  }

  async actOnModerationReport(
    reportId: string | number,
    action: 'dismiss' | 'resolve' | 'reopen' | 'reply' | 'recheck',
    note?: string
  ): Promise<{ success: boolean; message?: string; online?: boolean }> {
    try {
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reportId, note })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: sanitizeUserFacingError(data.error, 'Could not update moderation report.') };
      }
      if (this.isAdmin()) {
        await this.fetchModerationQueue(true);
      }
      await this.fetchMyReports(true);
      if (data.message) {
        this.pwaService.showToast(data.message);
      }
      return { success: true, message: data.message, online: data.online };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Network error updating report.') };
    }
  }

  async bulkModerationAction(
    action: 'dismiss_all_broken' | 'clear_closed',
    note?: string
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch('/api/admin/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { success: false, message: sanitizeUserFacingError(data.error, 'Bulk moderation action failed.') };
      }
      await this.fetchModerationQueue(true, 1);
      if (data.message) {
        this.pwaService.showToast(data.message);
      }
      return { success: true, message: data.message };
    } catch (err: any) {
      return { success: false, message: sanitizeUserFacingError(err, 'Network error executing bulk action.') };
    }
  }

  consumeRequestedDrawerTab(): 'packages' | 'favorites' | 'account' | 'moderation' | null {
    const tab = this._requestedDrawerTab();
    this._requestedDrawerTab.set(null);
    return tab;
  }

  private processNotificationDigest(user: AuthUser): void {
    const digest = user.notification_digest;
    const openCnt = Number(user.open_reports_count || 0);
    this.pwaService.syncAppBadge(openCnt);

    if (!digest) return;

    if (Array.isArray(digest.user_alerts)) {
      this._myReports.set(digest.user_alerts);
      const total = typeof digest.my_reports_total === 'number'
        ? Math.max(digest.my_reports_total, digest.user_alerts.length)
        : digest.user_alerts.length;
      this._myReportsTotal.set(total);
      this._myReportsTotalPages.set(Math.max(1, Math.ceil(total / this._myReportsPageSize())));

      for (const alert of digest.user_alerts) {
        const isResolvedOrReplied = alert.status !== 'open' || Boolean(alert.resolution_note);
        const isAuthorAlert = String(alert.reporter_user_id || '') !== String(user.id);
        if (!isResolvedOrReplied && !isAuthorAlert) continue;

        const stamp = alert.updated_at || alert.resolved_at || alert.created_at;
        const tag = `lh-mod-user-${alert.id}-${alert.status}-${stamp}`;
        const title = alert.status === 'resolved'
          ? `Issue Resolved · ${alert.package_id}`
          : alert.status === 'dismissed'
            ? `Report Dismissed · ${alert.package_id}`
            : `Moderation Update · ${alert.package_id}`;
        const body = alert.resolution_note
          ? String(alert.resolution_note).split('\n').pop() || String(alert.resolution_note)
          : `${alert.reason.toUpperCase()}: ${alert.details || ''}`;

        this.pwaService.sendNativeNotification({
          title,
          body,
          tag,
          category: 'moderation',
          data: {
            targetTab: 'account',
            packageId: alert.package_id,
            reportId: String(alert.id)
          }
        });
      }
    }

    if (user.is_admin && Array.isArray(digest.admin_latest_open)) {
      for (const rep of digest.admin_latest_open) {
        const tag = `lh-mod-admin-${rep.id}-${rep.created_at}`;
        this.pwaService.sendNativeNotification({
          title: `New Moderation Report · ${rep.package_id}`,
          body: `[${String(rep.reason || 'other').toUpperCase()}] ${rep.details || 'Requires moderator review.'}`,
          tag,
          category: 'admin_queue',
          data: {
            targetTab: 'moderation',
            packageId: rep.package_id,
            reportId: String(rep.id)
          }
        });
      }
    }

    if (Array.isArray(digest.latest_git_packages) && digest.latest_git_packages.length > 0) {
      this.pwaService.checkAndNotifyNewGitPackages(digest.latest_git_packages, {
        isBaselineSeedAllowed: false
      });
    }
  }
}
