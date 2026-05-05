import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { User, AuthResponse } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private currentUserSubject: BehaviorSubject<User | null>;
  public currentUser: Observable<User | null>;
  private readonly MOCK_USERS: User[] = [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin' },
    { id: 2, username: 'user', password: 'user123', role: 'user' }
  ];

  constructor() {
    const storedUser = localStorage.getItem('currentUser');
    this.currentUserSubject = new BehaviorSubject<User | null>(
      storedUser ? JSON.parse(storedUser) : null
    );
    this.currentUser = this.currentUserSubject.asObservable();
  }

  public get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }

  login(username: string, password: string): Observable<AuthResponse> {
    const user = this.MOCK_USERS.find(
      u => u.username === username && u.password === password
    );

    if (user) {
      const token = this.generateToken(user);
      const response: AuthResponse = { user, token };
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('token', token);
      this.currentUserSubject.next(user);
      return of(response);
    }
    throw new Error('Invalid credentials');
  }

  logout(): void {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    this.currentUserSubject.next(null);
  }

  isLoggedIn(): boolean {
    return !!this.currentUserValue && !!localStorage.getItem('token');
  }

  getRole(): string | null {
    return this.currentUserValue?.role || null;
  }

  private generateToken(user: User): string {
    return btoa(`${user.id}:${user.username}:${user.role}:${Date.now()}`);
  }
}