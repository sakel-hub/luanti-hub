import { ApplicationConfig, Injectable, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  BaseRouteReuseStrategy,
  provideRouter,
  RouteReuseStrategy,
  withComponentInputBinding
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';

@Injectable()
export class CatalogRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.component && future.component === curr.component) {
      return true;
    }
    return super.shouldReuseRoute(future, curr);
  }
}

const isLocalhostBrowser = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  if (host === 'localhost' || host === '127.0.0.1') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        for (const reg of regs) {
          reg.unregister().catch(() => {});
        }
      }).catch(() => {});
    }
    if ('caches' in window) {
      window.caches.keys().then(keys => {
        for (const key of keys) {
          if (key.startsWith('ngsw:')) {
            window.caches.delete(key).catch(() => {});
          }
        }
      }).catch(() => {});
    }
    return true;
  }
  return false;
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: RouteReuseStrategy, useClass: CatalogRouteReuseStrategy },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !isLocalhostBrowser(),
      registrationStrategy: 'registerImmediately'
    })
  ]
};
