// test.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Test, CreateTestDTO, UpdateTestDTO } from '../models/test.model';

@Injectable({
  providedIn: 'root'
})
export class TestService {
  private testsSubject: BehaviorSubject<Test[]>;
  public tests: Observable<Test[]>;

  private mockTests: Test[] = [];

  constructor() {
    this.loadFromLocalStorage();
    this.testsSubject = new BehaviorSubject<Test[]>(this.mockTests);
    this.tests = this.testsSubject.asObservable();
  }

  // ═══════════════════════════ BASIC CRUD OPERATIONS ═══════════════════════════

  getTests(): Observable<Test[]> {
    return this.tests;
  }

  getTestById(id: number): Observable<Test | undefined> {
    const test = this.mockTests.find(t => t.id === id);
    return of(test);
  }

  getTestByName(name: string): Observable<Test | undefined> {
    const test = this.mockTests.find(t => t.name === name);
    return of(test);
  }

  addTest(testData: CreateTestDTO): Observable<Test> {
    console.log('[TestService] Adding new test:', testData);
    
    const newTest: Test = {
      id: Math.max(...this.mockTests.map(t => t.id), 0) + 1,
      name: testData.name,
      description: testData.description,
      symbol: testData.symbol || 'Unknown',
      timeframe: testData.timeframe || 'Daily',
      difficulty: testData.difficulty || 'Beginner',
      status: testData.status || 'active',
      passingScore: testData.passingScore || 80,
      timeLimit: testData.timeLimit || 60,
      totalPoints: testData.totalPoints || 100,
      data: testData.data || this.generateMockChartData(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.mockTests.push(newTest);
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    
    console.log('[TestService] Test added successfully:', newTest);
    return of(newTest);
  }

  updateTest(id: number, updates: UpdateTestDTO): Observable<Test> {
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
    throw new Error(`Test with id ${id} not found`);
  }

  deleteTest(id: number): Observable<void> {
    this.mockTests = this.mockTests.filter(t => t.id !== id);
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    return of(void 0);
  }

  duplicateTest(id: number): Observable<Test> {
    const original = this.mockTests.find(t => t.id === id);
    if (!original) {
      throw new Error(`Test with id ${id} not found`);
    }
    
    const duplicated: Test = {
      ...original,
      id: Math.max(...this.mockTests.map(t => t.id), 0) + 1,
      name: `${original.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
      data: this.generateMockChartData()
    };
    
    this.mockTests.push(duplicated);
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    
    return of(duplicated);
  }

  // ═══════════════════════════ CHART DATA MANAGEMENT ═══════════════════════════

  updateTestChartData(id: number, chartData: any[]): Observable<Test> {
    const index = this.mockTests.findIndex(t => t.id === id);
    if (index !== -1) {
      this.mockTests[index] = {
        ...this.mockTests[index],
        data: chartData,
        updatedAt: new Date()
      };
      this.saveToLocalStorage();
      this.testsSubject.next([...this.mockTests]);
      return of(this.mockTests[index]);
    }
    throw new Error(`Test with id ${id} not found`);
  }

  getTestChartData(id: number): Observable<any[]> {
    const test = this.mockTests.find(t => t.id === id);
    return of(test?.data || []);
  }

  // ═══════════════════════════ TEST METADATA AND FILTERING ═══════════════════════════

  getTestsByDifficulty(difficulty: 'Beginner' | 'Intermediate' | 'Advanced'): Observable<Test[]> {
    const filtered = this.mockTests.filter(t => t.difficulty === difficulty);
    return of(filtered);
  }

  getTestsBySymbol(symbol: string): Observable<Test[]> {
    const filtered = this.mockTests.filter(t => t.symbol === symbol);
    return of(filtered);
  }

  getTestsByStatus(status: 'active' | 'archived' | 'draft'): Observable<Test[]> {
    const filtered = this.mockTests.filter(t => t.status === status);
    return of(filtered);
  }

  searchTests(query: string): Observable<Test[]> {
    const lowerQuery = query.toLowerCase();
    const filtered = this.mockTests.filter(test => 
      test.name.toLowerCase().includes(lowerQuery) ||
      test.description.toLowerCase().includes(lowerQuery) ||
      (test.symbol && test.symbol.toLowerCase().includes(lowerQuery))
    );
    return of(filtered);
  }

  getActiveTests(): Observable<Test[]> {
    const filtered = this.mockTests.filter(t => t.status === 'active');
    return of(filtered);
  }

  getTestStats(): Observable<{ 
    total: number; 
    byDifficulty: Record<string, number>;
    bySymbol: Record<string, number>;
    byStatus: Record<string, number>;
    averagePassingScore: number;
  }> {
    const stats = {
      total: this.mockTests.length,
      byDifficulty: {
        Beginner: this.mockTests.filter(t => t.difficulty === 'Beginner').length,
        Intermediate: this.mockTests.filter(t => t.difficulty === 'Intermediate').length,
        Advanced: this.mockTests.filter(t => t.difficulty === 'Advanced').length
      },
      bySymbol: {} as Record<string, number>,
      byStatus: {
        active: this.mockTests.filter(t => t.status === 'active').length,
        archived: this.mockTests.filter(t => t.status === 'archived').length,
        draft: this.mockTests.filter(t => t.status === 'draft').length
      },
      averagePassingScore: 0
    };
    
    this.mockTests.forEach(test => {
      if (test.symbol) {
        stats.bySymbol[test.symbol] = (stats.bySymbol[test.symbol] || 0) + 1;
      }
    });
    
    const totalScore = this.mockTests.reduce((sum, test) => sum + (test.passingScore || 0), 0);
    stats.averagePassingScore = this.mockTests.length > 0 ? totalScore / this.mockTests.length : 0;
    
    return of(stats);
  }

  // ═══════════════════════════ BULK OPERATIONS ═══════════════════════════

  importTests(tests: Test[]): Observable<Test[]> {
    const importedTests: Test[] = [];
    
    tests.forEach(test => {
      const newTest = {
        ...test,
        id: Math.max(...this.mockTests.map(t => t.id), 0) + 1,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.mockTests.push(newTest);
      importedTests.push(newTest);
    });
    
    this.saveToLocalStorage();
    this.testsSubject.next([...this.mockTests]);
    return of(importedTests);
  }

  exportTests(): Observable<Test[]> {
    return of([...this.mockTests]);
  }

  clearAllTests(): Observable<void> {
    this.mockTests = [];
    this.saveToLocalStorage();
    this.testsSubject.next([]);
    return of(void 0);
  }

  // ═══════════════════════════ VALIDATION ═══════════════════════════

  validateTestData(test: Partial<Test>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!test.name || test.name.trim().length === 0) {
      errors.push('Test name is required');
    }
    
    if (test.name && test.name.length > 100) {
      errors.push('Test name must be less than 100 characters');
    }
    
    if (!test.description || test.description.trim().length === 0) {
      errors.push('Test description is required');
    }
    
    if (test.description && test.description.length > 500) {
      errors.push('Test description must be less than 500 characters');
    }
    
    if (test.difficulty && !['Beginner', 'Intermediate', 'Advanced'].includes(test.difficulty)) {
      errors.push('Difficulty must be Beginner, Intermediate, or Advanced');
    }
    
    if (test.status && !['active', 'archived', 'draft'].includes(test.status)) {
      errors.push('Status must be active, archived, or draft');
    }
    
    if (test.passingScore !== undefined && (test.passingScore < 0 || test.passingScore > 100)) {
      errors.push('Passing score must be between 0 and 100');
    }
    
    if (test.timeLimit !== undefined && test.timeLimit <= 0) {
      errors.push('Time limit must be greater than 0');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  isTestNameUnique(name: string, excludeId?: number): boolean {
    return !this.mockTests.some(test => 
      test.name.toLowerCase() === name.toLowerCase() && test.id !== excludeId
    );
  }

  // ═══════════════════════════ MOCK DATA GENERATION ═══════════════════════════

  generateMockChartData(days: number = 730, startPrice: number = 100, volatility: number = 0.02): any[] {
    const data = [];
    let currentPrice = startPrice;
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - Math.ceil(days / 365));
    
    const trend = (Math.random() - 0.5) * 0.001;
    
    for (let i = 0; i < days; i++) {
      const change = currentPrice * (trend + (Math.random() - 0.5) * volatility);
      currentPrice = Math.max(currentPrice + change, startPrice * 0.3);
      currentPrice = Math.min(currentPrice, startPrice * 5);
      
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      
      if (date.getDay() === 0 || date.getDay() === 6) {
        continue;
      }
      
      const open = parseFloat(currentPrice.toFixed(2));
      const high = parseFloat((currentPrice + Math.abs(change) * 0.8 + Math.random() * currentPrice * 0.01).toFixed(2));
      const low = parseFloat((currentPrice - Math.abs(change) * 0.6 - Math.random() * currentPrice * 0.01).toFixed(2));
      const close = parseFloat((currentPrice + (Math.random() - 0.5) * currentPrice * 0.015).toFixed(2));
      
      data.push({
        time: Math.floor(date.getTime() / 1000),
        open: open,
        high: Math.max(open, close, high),
        low: Math.min(open, close, low),
        close: close,
      });
    }
    
    return data;
  }

  generatePatternChartData(pattern: 'uptrend' | 'downtrend' | 'sideways' | 'volatile', days: number = 365): any[] {
    const data = [];
    let price = 100;
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    
    for (let i = 0; i < days; i++) {
      let change = 0;
      
      switch(pattern) {
        case 'uptrend':
          change = (Math.random() - 0.4) * 3;
          price += change;
          break;
        case 'downtrend':
          change = (Math.random() - 0.6) * 3;
          price += change;
          break;
        case 'sideways':
          change = (Math.random() - 0.5) * 1.5;
          price += change;
          break;
        case 'volatile':
          change = (Math.random() - 0.5) * 8;
          price += change;
          break;
      }
      
      price = Math.max(price, 50);
      price = Math.min(price, 200);
      
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      
      data.push({
        time: Math.floor(date.getTime() / 1000),
        open: parseFloat(price.toFixed(2)),
        high: parseFloat((price + Math.random() * 3).toFixed(2)),
        low: parseFloat((price - Math.random() * 3).toFixed(2)),
        close: parseFloat((price + (Math.random() - 0.5) * 2).toFixed(2))
      });
    }
    
    return data;
  }

  // ═══════════════════════════ PERSISTENCE ═══════════════════════════

  private saveToLocalStorage(): void {
    try {
      const dataToStore = {
        tests: this.mockTests,
        version: '1.0',
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem('tests', JSON.stringify(dataToStore));
      console.log('[TestService] Tests saved to localStorage');
    } catch (e) {
      console.error('[TestService] Failed to save tests:', e);
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem('tests');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.tests && Array.isArray(parsed.tests)) {
          this.mockTests = parsed.tests.map((test: any) => ({
            ...test,
            createdAt: new Date(test.createdAt),
            updatedAt: new Date(test.updatedAt)
          }));
        } else if (Array.isArray(parsed)) {
          this.mockTests = parsed.map((test: any) => ({
            ...test,
            createdAt: new Date(test.createdAt),
            updatedAt: new Date(test.updatedAt)
          }));
        }
        console.log('[TestService] Tests loaded from localStorage');
      }
    } catch (e) {
      console.error('[TestService] Failed to load tests:', e);
    }
  }

  // ═══════════════════════════ UTILITY METHODS ═══════════════════════════

  getTestCount(): number {
    return this.mockTests.length;
  }

  getLatestTests(limit: number = 5): Observable<Test[]> {
    const sorted = [...this.mockTests].sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
    return of(sorted.slice(0, limit));
  }

  testExists(id: number): boolean {
    return this.mockTests.some(t => t.id === id);
  }

  archiveTest(id: number): Observable<Test> {
    return this.updateTest(id, { status: 'archived' });
  }

  activateTest(id: number): Observable<Test> {
    return this.updateTest(id, { status: 'active' });
  }

  refreshTestData(id: number): Observable<Test> {
    const index = this.mockTests.findIndex(t => t.id === id);
    if (index !== -1) {
      this.mockTests[index] = {
        ...this.mockTests[index],
        data: this.generateMockChartData(),
        updatedAt: new Date()
      };
      this.saveToLocalStorage();
      this.testsSubject.next([...this.mockTests]);
      return of(this.mockTests[index]);
    }
    throw new Error(`Test with id ${id} not found`);
  }
}