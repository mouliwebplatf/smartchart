export interface User {
  id: number;
  username: string;
  password: string;
  role: 'admin' | 'user';
}

export interface AuthResponse {
  user: User;
  token: string;
}