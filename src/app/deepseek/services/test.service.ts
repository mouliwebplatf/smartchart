import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Test } from '../models/test.model';

@Injectable({
  providedIn: 'root'
})
export class TestService {
  private testsSubject: BehaviorSubject<Test[]>;
  public tests: Observable<Test[]>;

  private mockTests: Test[] = [
    {
      id: 1,
      name: 'BTC/USD Analysis',
      description: 'Bitcoin price analysis with key support/resistance levels',
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    },
    {
      id: 2,
      name: 'ETH/USD Trend Analysis',
      description: 'Ethereum trend identification and breakout points',
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    },
    {
      id: 3,
      name: 'Gold Futures',
      description: 'Gold price patterns and key levels',
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    },
    {
      id: 4,
      name: 'S&P 500 Index',
      description: 'Index analysis with support/resistance zones',
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    }
  ];

  constructor() {
    const storedTests = localStorage.getItem('tests');
    if (storedTests) {
      this.mockTests = JSON.parse(storedTests);
    }
    this.testsSubject = new BehaviorSubject<Test[]>(this.mockTests);
    this.tests = this.testsSubject.asObservable();
  }

  getTests(): Observable<Test[]> {
    return this.tests;
  }

  getTestById(id: number): Observable<Test | undefined> {
    const test = this.mockTests.find(t => t.id === id);
    return of(test);
  }

  addTest(test: Omit<Test, 'id' | 'createdAt' | 'updatedAt'>): Observable<Test> {
    const newTest: Test = {
      ...test,
      id: Math.max(...this.mockTests.map(t => t.id), 0) + 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    };
    this.mockTests.push(newTest);
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    return of(newTest);
  }

  updateTest(id: number, updates: Partial<Test>): Observable<Test> {
    const index = this.mockTests.findIndex(t => t.id === id);
    if (index !== -1) {
      this.mockTests[index] = {
        ...this.mockTests[index],
        ...updates,
        updatedAt: new Date()
      };
      this.saveToLocalStorage();
      this.testsSubject.next([...this.mockTests]);
      return of(this.mockTests[index]);
    }
    throw new Error('Test not found');
  }

  deleteTest(id: number): Observable<void> {
    this.mockTests = this.mockTests.filter(t => t.id !== id);
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    return of(void 0);
  }

  private saveToLocalStorage(): void {
    localStorage.setItem('tests', JSON.stringify(this.mockTests));
  }
  private generateMockChartData(): any[] {
  const data = [];
  let basePrice = 100;
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 2); // 2 years of data
  
  for (let i = 0; i < 730; i++) {
    const change = (Math.random() - 0.5) * 4;
    basePrice += change;
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    
    data.push({
      x: date.getTime(),
      y: [
        parseFloat((basePrice).toFixed(2)),
        parseFloat((basePrice + Math.random() * 2).toFixed(2)),
        parseFloat((basePrice - Math.random() * 2).toFixed(2)),
        parseFloat((basePrice + (Math.random() - 0.5) * 1.5).toFixed(2))
      ]
    });
  }
  return data;
}
}