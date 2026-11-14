import {
  ApplicationConfig,
  ErrorHandler,
  Injectable,
  isDevMode,
  provideBrowserGlobalErrorListeners
} from '@angular/core';
import {
  ActivatedRouteSnapshot,
  BaseRouteReuseStrategy,
  provideRouter,
  RouteReuseStrategy,
  withComponentInputBinding
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { GlobalErrorHandler } from './core/services/global-error-handler.service';
import { provideLuantiWebMcpTools } from './core/services/webmcp.tools';

@Injectable()
export class CatalogRouteReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
    if (future.component && future.component === curr.component) {
      return true;
    }
    return super.shouldReuseRoute(future, curr);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useExisting: GlobalErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    { provide: RouteReuseStrategy, useClass: CatalogRouteReuseStrategy },
    provideLuantiWebMcpTools(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately'
    })
  ]
};
