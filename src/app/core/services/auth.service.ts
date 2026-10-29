import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthUser, GitProvider, ModerationReport, LuantiPackage } from '../models/package.model';
import { SettingsService } from './settings.service';
import { PwaService } from './pwa.service';

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
  private readonly _authError = signal<string | null>(null);
  private readonly _selectedProvider = signal<GitProvider>('contentdb');
  private readonly _oauthProviders = signal<Record<string, boolean>>({});
  private readonly _moderationReports = signal<ModerationReport[]>([]);
  private readonly _delistedPackages = signal<LuantiPackage[]>([]);
  private lastModerationFetchAt = 0;
  private lastAuthFetchAt = 0;

  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthModalOpen = this._isAuthModalOpen.asReadonly();
  readonly isProfileDrawerOpen = this._isProfileDrawerOpen.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly authError = this._authError.asReadonly();
  readonly selectedProvider = this._selectedProvider.asReadonly();
  readonly oauthProviders = this._oauthProviders.asReadonly();
  readonly moderationReports = this._moderationReports.asReadonly();
  readonly delistedPackages = this._delistedPackages.asReadonly();

  readonly isLoggedIn = computed(() => this._currentUser() !== null);
  readonly isAdmin = computed(() => Boolean(this._currentUser()?.is_admin || this._currentUser()?.role === 'admin'));
  readonly openReportsCount = computed(() => this._currentUser()?.open_reports_count || 0);
  readonly linkedIdentities = computed(() => this._currentUser()?.identities || []);

  constructor() {
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
        this._authError.set(authError);
        this._isAuthModalOpen.set(true);
      } else if (authSuccess) {
        this.clearAuthCache();
        this._isProfileDrawerOpen.set(true);
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

  openAuthModal(): void {
    this._authError.set(null);
    this._isAuthModalOpen.set(true);
  }

  closeAuthModal(): void {
    this._isAuthModalOpen.set(false);
    this._authError.set(null);
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

  loginWith(provider: GitProvider, loginHint?: string): void {
    this._selectedProvider.set(provider);
    if (this.isOAuthConfigured(provider)) {
      this.clearAuthCache();
      if (typeof window !== 'undefined') {
        const cleanHint = (loginHint || '').trim();
        window.location.href = `/api/auth/${provider}/login${cleanHint ? `?login=${encodeURIComponent(cleanHint)}` : ''}`;
      }
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
          return { success: false, message: data.error || 'Could not verify account handle.' };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        this.closeAuthModal();
        this.openProfileDrawer();
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
      this.closeAuthModal();
      this.openProfileDrawer();
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection error during sign-in.' };
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
            message: data.error || 'Could not verify token against the Git provider API.'
          };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        return { success: true };
      }

      return { success: false, message: 'Verification endpoint unavailable.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Network error while verifying repository ownership.' };
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
      return { success: false, message: data.error || 'Could not unlink identity.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Error unlinking identity.' };
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
          return { success: false, message: data.error || 'Failed to sync ContentDB account.' };
        }
        this.clearAuthCache();
        await this.initAuth(true);
        return { success: true, count: data.syncedCount };
      }
      return { success: false, message: 'ContentDB sync endpoint unreachable.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection error syncing ContentDB.' };
    }
  }

  async fetchModerationQueue(force = false): Promise<void> {
    if (!this.isAdmin()) return;
    if (!force && this.lastModerationFetchAt > 0 && Date.now() - this.lastModerationFetchAt < 60_000) {
      return;
    }
    this.lastModerationFetchAt = Date.now();
    try {
      const res = await fetch('/api/admin/moderation');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.reports)) {
          this._moderationReports.set(data.reports);
        }
        if (Array.isArray(data.delistedPackages)) {
          this._delistedPackages.set(data.delistedPackages);
        }
        this._currentUser.update(u => u ? { ...u, open_reports_count: (data.reports || []).length } : null);
      }
    } catch {
      // Ignore
    }
  }
}
