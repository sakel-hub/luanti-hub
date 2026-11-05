import { Routes } from '@angular/router';
import { CatalogComponent } from './features/catalog/catalog.component';

const loadAnalyticsPage = () =>
  import('./features/analytics/analytics-page.component').then(m => m.AnalyticsPageComponent);

export const routes: Routes = [
  {
    path: '',
    component: CatalogComponent
  },
  {
    path: 'games',
    component: CatalogComponent
  },
  {
    path: 'mods',
    component: CatalogComponent
  },
  {
    path: 'texture-packs',
    component: CatalogComponent
  },
  {
    path: 'git',
    component: CatalogComponent
  },
  {
    path: 'analytics',
    loadComponent: loadAnalyticsPage
  },
  {
    path: 'analytics/:username',
    loadComponent: loadAnalyticsPage
  },
  {
    path: 'analytics/:username/:packageName',
    loadComponent: loadAnalyticsPage
  },
  {
    path: 'package/:author/:name',
    component: CatalogComponent
  },
  {
    path: 'packages/:author/:name',
    component: CatalogComponent
  },
  {
    path: 'submit',
    component: CatalogComponent
  },
  {
    path: 'setup',
    component: CatalogComponent
  },
  {
    path: 'profile',
    component: CatalogComponent
  },
  {
    path: 'author/:username',
    component: CatalogComponent
  },
  {
    path: 'privacy',
    redirectTo: 'legal',
    pathMatch: 'full'
  },
  {
    path: 'delete-account',
    redirectTo: 'legal',
    pathMatch: 'full'
  },
  {
    path: 'legal',
    component: CatalogComponent
  },
  {
    path: 'blog',
    component: CatalogComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
