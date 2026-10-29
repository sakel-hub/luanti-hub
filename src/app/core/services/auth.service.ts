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
      if (providerParam && ['codeberg', 'gitlab', 'github', 'contentdb'].includes(providerParam)) {
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
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem('lh_auth_cache_v1');
        sessionStorage.removeItem('lh_auth_cache_v2');
      }
    } catch {
      // Ignore storage error
    }
  }

  async initAuth(forceRefresh = false): Promise<void> {
    try {
      this._isLoading.set(true);

      if (!forceRefresh && typeof sessionStorage !== 'undefined') {
        try {
          const cachedRaw = sessionStorage.getItem('lh_auth_cache_v2');
          if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw) as { ts: number; data: any };
            const cachedUsername = String(parsed?.data?.user?.username || '');
            const hasLegacySuffix = /_(gi|gl|co|cd)$/i.test(cachedUsername);
            if (parsed && parsed.data && !hasLegacySuffix && Date.now() - parsed.ts < 120_000) {
              this.settingsService.edgeApiAvailable.set(true);
              if (parsed.data.oauthProviders && typeof parsed.data.oauthProviders === 'object') {
                this._oauthProviders.set(parsed.data.oauthProviders);
              }
              if (parsed.data.user) {
                this._currentUser.set(parsed.data.user);
                this.settingsService.isAuthenticatedSession.set(true);
                await this.settingsService.mergeServerFavorites(parsed.data.user.favorites);
                return;
              } else {
                this.settingsService.isAuthenticatedSession.set(false);
                return;
              }
            }
          }
        } catch {
          // Proceed to network fetch
        }
      }

      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          this.settingsService.edgeApiAvailable.set(true);
          const data = await res.json();
          try {
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('lh_auth_cache_v2', JSON.stringify({ ts: Date.now(), data }));
            }
          } catch {
            // Ignore storage quota error
          }
          if (data.oauthProviders && typeof data.oauthProviders === 'object') {
            this._oauthProviders.set(data.oauthProviders);
          }
          if (data.user) {
            this._currentUser.set(data.user);
            this.settingsService.isAuthenticatedSession.set(true);
            await this.settingsService.mergeServerFavorites(data.user.favorites);
            return;
          }
        }
      }

      this.settingsService.isAuthenticatedSession.set(false);
      // Check local fallback user if running in static/dev mode without D1
      const savedLocalUser = typeof localStorage !== 'undefined' ? localStorage.getItem('lh_local_user') : null;
      if (savedLocalUser) {
        this._currentUser.set(JSON.parse(savedLocalUser));
      }
    } catch {
      // Offline / unauthenticated
      try {
        const savedLocalUser = typeof localStorage !== 'undefined' ? localStorage.getItem('lh_local_user') : null;
        if (savedLocalUser) {
          this._currentUser.set(JSON.parse(savedLocalUser));
        }
      } catch {
        // Ignore
      }
    } finally {
      this._isLoading.set(false);
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

  loginWith(provider: GitProvider): void {
    this._selectedProvider.set(provider);
    if (this.isOAuthConfigured(provider)) {
      this.clearAuthCache();
      if (typeof window !== 'undefined') {
        window.location.href = `/api/auth/${provider}/login`;
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

      // Fallback when running `ng serve` locally without Cloudflare Pages Worker
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
              : `https://${provider}.com/${cleanHandle}`,
            verified: false
          }
        ],
        packages: []
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('lh_local_user', JSON.stringify(localUser));
      }
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

      // Local fallback update
      this._currentUser.update(u => {
        if (!u) return null;
        const updated = {
          ...u,
          display_name: payload.display_name ?? u.display_name,
          bio: payload.bio ?? u.bio,
          avatar_url: payload.avatar_url ?? u.avatar_url
        };
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('lh_local_user', JSON.stringify(updated));
        }
        return updated;
      });
      this.pwaService.showToast('profile.savedSuccess');
      return { success: true };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update profile.' };
    }
  }

  async unlinkIdentity(provider: GitProvider): Promise<{ success: boolean; message?: string }> {
    try {
      const res = await fetch(`/api/auth/me?provider=${encodeURIComponent(provider)}`, {
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
