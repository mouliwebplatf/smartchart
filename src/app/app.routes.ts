import { Routes } from '@angular/router';
import { LoginComponent } from './deepseek/auth/login/login.component';
import { AuthGuard } from './deepseek/guards/auth.guard';
import { RoleGuard } from './deepseek/guards/role.guard';
import { DashboardComponent } from './deepseek/dashboard/dashboard.component';

import { ChartComponent } from './deepseek/chart/chart.component';
// import { ChartComponent } from './deepseek/chart/chart.component';


export const routes: Routes = [
  //    { path: '', component: LoginComponent },

  // { path: 'user', component: UserTestListComponent },
  // { path: 'user/test/:id', component: UserTestPlayerComponent },

  // { path: 'admin', component: AdminTestListComponent },
  // { path: 'admin/editor', component: AdminTestEditorComponent },
  // {path:'test-1',component:Test}
  { path: 'login', component: LoginComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: 'admin',
    canActivate: [AuthGuard, RoleGuard],
    data: { expectedRole: 'admin' },
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'chart/:id', component: ChartComponent }
    ]
  },
  {
    path: 'user',
    canActivate: [AuthGuard, RoleGuard],
    data: { expectedRole: 'user' },
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'chart/:id', component: ChartComponent }
    ]
  },

];
