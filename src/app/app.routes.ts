import { Routes } from '@angular/router';
import { CatalogComponent } from './features/catalog/catalog.component';
import { AnalyticsPageComponent } from './features/analytics/analytics-page.component';

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
    component: AnalyticsPageComponent
  },
  {
    path: 'analytics/:username',
    component: AnalyticsPageComponent
  },
  {
    path: 'analytics/:username/:packageName',
    component: AnalyticsPageComponent
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
    path: 'legal',
    component: CatalogComponent
  },
  {
    path: '**',
    redirectTo: ''
  }
];
