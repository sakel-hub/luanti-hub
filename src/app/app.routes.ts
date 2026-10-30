import { Routes } from '@angular/router';
import { CatalogComponent } from './features/catalog/catalog.component';

export const routes: Routes = [
  {
    path: '',
    component: CatalogComponent
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
