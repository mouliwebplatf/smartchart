import { Component } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  imports:[CommonModule,FormsModule,ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  loginForm: FormGroup;
  errorMessage: string = '';
  loading: boolean = false;

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    private authService: AuthService
  ) {
    this.loginForm = this.formBuilder.group({
      username: ['', Validators.required],
      password: ['', Validators.required]
    });
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      return;
    }

    this.loading = true;
    const { username, password } = this.loginForm.value;

    try {
      this.authService.login(username, password).subscribe({
        next: (response) => {
          const dashboardUrl = response.user.role === 'admin' ? '/admin/dashboard' : '/user/dashboard';
          this.router.navigate([dashboardUrl]);
        },
        error: (error) => {
          this.errorMessage = 'Invalid username or password';
          this.loading = false;
        }
      });
    } catch (error) {
      this.errorMessage = 'Login failed. Please try again.';
      this.loading = false;
    }
  }
}