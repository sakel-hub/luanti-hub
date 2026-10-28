import { Injectable, signal, computed } from '@angular/core';
import { AuthUser, GitProvider } from '../models/package.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly _currentUser = signal<AuthUser | null>(null);
  private readonly _isAuthModalOpen = signal<boolean>(false);
  private readonly _isProfileDrawerOpen = signal<boolean>(false);
  private readonly _isLoading = signal<boolean>(false);

  readonly currentUser = this._currentUser.asReadonly();
  readonly isAuthModalOpen = this._isAuthModalOpen.asReadonly();
  readonly isProfileDrawerOpen = this._isProfileDrawerOpen.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  readonly isLoggedIn = computed(() => this._currentUser() !== null);
  readonly linkedIdentities = computed(() => this._currentUser()?.identities || []);

  constructor() {
    this.initAuth();
  }

  async initAuth(): Promise<void> {
    try {
      this._isLoading.set(true);
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          this._currentUser.set(data.user);
        }
      }
    } catch {
      // offline / unauthenticated
    } finally {
      this._isLoading.set(false);
    }
  }

  openAuthModal(): void {
    this._isAuthModalOpen.set(true);
  }

  closeAuthModal(): void {
    this._isAuthModalOpen.set(false);
  }

  openProfileDrawer(): void {
    this._isProfileDrawerOpen.set(true);
  }

  closeProfileDrawer(): void {
    this._isProfileDrawerOpen.set(false);
  }

  loginWith(provider: GitProvider): void {
    if (typeof window !== 'undefined') {
      window.location.href = `/api/auth/${provider}/login`;
    }
  }

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      this._currentUser.set(null);
      this.closeProfileDrawer();
    } catch {
      this._currentUser.set(null);
    }
  }

  async syncContentDbAccount(contentDbUsername: string): Promise<{ success: boolean; count?: number; message?: string }> {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(contentDbUsername)}/sync-contentdb`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Failed to sync ContentDB account.' };
      }

      // Re-fetch current user profile to reflect newly linked packages
      await this.initAuth();
      return { success: true, count: data.syncedCount };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection error syncing ContentDB.' };
    }
  }
}
