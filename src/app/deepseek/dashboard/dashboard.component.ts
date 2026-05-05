import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { TestService } from '../services/test.service';
import { Test } from '../models/test.model';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-dashboard',
  imports:[CommonModule,FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  tests: Test[] = [];
  userRole: string | null = null;
  showAddModal: boolean = false;
  showEditModal: boolean = false;
  selectedTest: Test | null = null;
  newTest = { name: '', description: '' ,data:''};
  editTest = { name: '', description: '' };

  constructor(
    private router: Router,
    private authService: AuthService,
    private testService: TestService
  ) {}

  ngOnInit(): void {
    this.userRole = this.authService.getRole();
    this.loadTests();
  }

  loadTests(): void {
    this.testService.getTests().subscribe(tests => {
      this.tests = tests;
    });
  }

  openChart(testId: number): void {
    this.router.navigate([`/${this.userRole}/chart`, testId]);
  }

  addTest(): void {
    if (this.newTest.name && this.newTest.description) {
      this.testService.addTest(this.newTest).subscribe(() => {
        this.newTest = { name: '', description: '',data:'' };
        this.showAddModal = false;
        this.loadTests();
      });
    }
  }

  editTests(test: Test): void {
    this.selectedTest = test;
    this.editTest = { name: test.name, description: test.description };
    this.showEditModal = true;
  }

  updateTest(): void {
    if (this.selectedTest && this.editTest.name && this.editTest.description) {
      this.testService.updateTest(this.selectedTest.id, this.editTest).subscribe(() => {
        this.showEditModal = false;
        this.selectedTest = null;
        this.loadTests();
      });
    }
  }

  deleteTest(testId: number): void {
    if (confirm('Are you sure you want to delete this test?')) {
      this.testService.deleteTest(testId).subscribe(() => {
        this.loadTests();
      });
    }
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}