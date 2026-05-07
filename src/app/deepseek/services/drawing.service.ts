// drawing.service.ts

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DrawingLine, ValidationResult } from '../models/drawing.model';

@Injectable({ providedIn: 'root' })
export class DrawingService {
  private adminLines = new Map<number, DrawingLine[]>();
  private userLines  = new Map<number, DrawingLine[]>();

  constructor() {
    this.loadFromLocalStorage();
  }

  // ═══════════════════════════ ADMIN ═══════════════════════════

  getAdminLines(testId: number): Observable<DrawingLine[]> {
    return of([...(this.adminLines.get(testId) ?? [])]);
  }

  addAdminLine(testId: number, line: DrawingLine): Observable<DrawingLine> {
    const lines = this.adminLines.get(testId) ?? [];
    if (!lines.find(l => l.id === line.id)) {
      lines.push({ ...line });
    }
    this.adminLines.set(testId, lines);
    this.persist();
    return of({ ...line });
  }

  saveAdminLines(testId: number, lines: DrawingLine[]): Observable<DrawingLine[]> {
    this.adminLines.set(testId, lines.map(l => ({ ...l })));
    this.persist();
    return of([...lines]);
  }

  updateAdminLine(testId: number, lineId: string, updates: Partial<DrawingLine>): Observable<DrawingLine[]> {
    return this._updateInMap(this.adminLines, testId, lineId, updates);
  }

  deleteAdminLine(testId: number, lineId: string): Observable<DrawingLine[]> {
    return this._deleteFromMap(this.adminLines, testId, lineId);
  }

  clearAdminLines(testId: number): Observable<void> {
    this.adminLines.set(testId, []);
    this.persist();
    return of(void 0);
  }

  // ═══════════════════════════ USER ════════════════════════════

  getUserLines(testId: number): Observable<DrawingLine[]> {
    return of([...(this.userLines.get(testId) ?? [])]);
  }

  saveUserLine(testId: number, line: DrawingLine): Observable<DrawingLine> {
    const lines = this.userLines.get(testId) ?? [];
    if (!lines.find(l => l.id === line.id)) {
      lines.push({ ...line });
    }
    this.userLines.set(testId, lines);
    this.persist();
    return of({ ...line });
  }

  updateUserLine(testId: number, lineId: string, updates: Partial<DrawingLine>): Observable<DrawingLine[]> {
    const lines = this.userLines.get(testId) ?? [];
    const idx = lines.findIndex(l => l.id === lineId);
    if (idx !== -1) {
      lines[idx] = { ...lines[idx], ...updates, updatedAt: new Date() };
      this.userLines.set(testId, lines);
      this.persist();
    }
    return of([...lines]);
  }

  deleteUserLine(testId: number, lineId: string): Observable<DrawingLine[]> {
    const filtered = (this.userLines.get(testId) ?? []).filter(l => l.id !== lineId);
    this.userLines.set(testId, filtered);
    this.persist();
    return of([...filtered]);
  }

  clearAllUserLines(testId: number): Observable<void> {
    this.userLines.set(testId, []);
    this.persist();
    console.log(`[Store] clearAllUserLines | testId=${testId}`);
    return of(void 0);
  }

  // aliases kept for compatibility
  resetUserLines(testId: number): Observable<void>    { return this.clearAllUserLines(testId); }
  deleteAllUserLines(testId: number): Observable<void> { return this.clearAllUserLines(testId); }

  // ═══════════════════════════ SAVE ALL (role-aware) ════════════

  /**
   * Explicitly persist whatever is in memory right now.
   * Admin  → re-saves adminLines (correct answers).
   * User   → re-saves userLines.
   * Returns the saved array so the component can confirm.
   */
  saveAllLines(testId: number, role: 'admin' | 'user'): Observable<DrawingLine[]> {
    if (role === 'admin') {
      const lines = [...(this.adminLines.get(testId) ?? [])];
      this.adminLines.set(testId, lines);
      this.persist();
      console.log(`[Store] saveAllLines admin | testId=${testId} | count=${lines.length}`);
      return of(lines);
    } else {
      const lines = [...(this.userLines.get(testId) ?? [])];
      this.userLines.set(testId, lines);
      this.persist();
      console.log(`[Store] saveAllLines user | testId=${testId} | count=${lines.length}`);
      return of(lines);
    }
  }

  // ═══════════════════════════ DUPLICATE ═══════════════════════

  duplicateLine(
    testId: number,
    original: DrawingLine,
    offsetPrice: number,
    offsetTime: number
  ): Observable<DrawingLine> {
    const dup: DrawingLine = {
      ...original,
      id: uuidv4(),
      parentId: original.id,
      type: 'user',
      duplicateCount: (original.duplicateCount || 0) + 1,
      startTime:  original.startTime  + offsetTime,
      endTime:    original.endTime    + offsetTime,
      startPrice: original.startPrice + offsetPrice,
      endPrice:   original.endPrice   + offsetPrice,
      color: this.getDuplicateColor(original.duplicateCount || 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const lines = this.userLines.get(testId) ?? [];
    lines.push(dup);
    this.userLines.set(testId, lines);
    this.persist();
    return of({ ...dup });
  }

  private getDuplicateColor(count: number): string {
    const colors = ['#FFA500', '#FF6B6B', '#4ECDC4', '#95E77E', '#FFD93D'];
    return colors[count % colors.length];
  }

  // ═══════════════════════════ VALIDATION ══════════════════════

// Track which admin lines have been matched per test
private matchedLines = new Map<number, Set<string>>();

getMatchedLines(testId: number): Set<string> {
  return this.matchedLines.get(testId) ?? new Set();
}

clearMatchedLines(testId: number): void {
  this.matchedLines.set(testId, new Set());
  this.persist();
}

// drawing.service.ts – updated validation logic

validateUserLine(testId: number, userLine: DrawingLine): ValidationResult {
  const adminLines = this.adminLines.get(testId) ?? [];
  if (adminLines.length === 0) {
    return {
      isValid: true,
      score: 0,
      isWithinTolerance: true,
      remainingCount: 0,
      message: 'No correct lines defined – line accepted.'
    };
  }

  const matched = this.matchedLines.get(testId) ?? new Set();
  const remaining = adminLines.filter(al => !matched.has(al.id));
  if (remaining.length === 0) {
    return {
      isValid: true,
      score: 0,
      isWithinTolerance: true,
      remainingCount: 0,
      message: 'All lines already matched!'
    };
  }

  let bestMatch: DrawingLine | null = null;
  let bestScore = Infinity;

  for (const al of remaining) {
    const score = this._similarityWithContainment(userLine, al);
    if (score < bestScore) {
      bestScore = score;
      bestMatch = al;
    }
  }

  const isValid = bestScore < 0.02;   // threshold for slope+price match

  if (isValid && bestMatch) {
    matched.add(bestMatch.id);
    this.matchedLines.set(testId, matched);
    this.persist();
    const stillRemaining = adminLines.filter(al => !matched.has(al.id));
    return {
      isValid: true,
      score: bestScore,
      isWithinTolerance: true,
      correctLine: bestMatch,
      remainingCount: stillRemaining.length,
      message: stillRemaining.length === 0
        ? '✓ All lines matched! Test complete!'
        : `✓ Correct! ${stillRemaining.length} line(s) remaining.`,
    };
  }

  return {
    isValid: false,
    score: bestScore,
    isWithinTolerance: false,
    correctLine: bestMatch ?? undefined,
    remainingCount: remaining.length,
    message: '✗ Incorrect – draw closer to the correct line.',
  };
}

private _similarityWithContainment(user: DrawingLine, admin: DrawingLine): number {
  const toleranceSec = 86400; // 1 day tolerance on endpoints

  const userStart  = user.startTime;
  const userEnd    = user.endTime;
  const adminStart = admin.startTime;
  const adminEnd   = admin.endTime;

  // 1. Endpoint proximity — user's start must be close to admin's start
  //    and user's end must be close to admin's end
  const startDiff = Math.abs(userStart - adminStart);
  const endDiff   = Math.abs(userEnd   - adminEnd);

  if (startDiff > toleranceSec || endDiff > toleranceSec) {
    return 2.0; // endpoints too far from admin endpoints → invalid
  }

  // 2. Slope and price similarity — sample points across the overlap
  const overlapStart = Math.max(userStart, adminStart);
  const overlapEnd   = Math.min(userEnd,   adminEnd);
  if (overlapEnd <= overlapStart) return 2.0;

  const slopeUser  = (user.endPrice  - user.startPrice)  / (user.endTime  - user.startTime);
  const slopeAdmin = (admin.endPrice - admin.startPrice) / (admin.endTime - admin.startTime);
  const interceptUser  = user.startPrice  - slopeUser  * user.startTime;
  const interceptAdmin = admin.startPrice - slopeAdmin * admin.startTime;

  const priceLevel     = Math.max(Math.abs(admin.startPrice), Math.abs(admin.endPrice), 1);
  const tolerancePrice = priceLevel * 0.03; // 3% price tolerance (tighter than before)

  let totalDiff = 0;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t          = overlapStart + (overlapEnd - overlapStart) * (i / steps);
    const priceUser  = slopeUser  * t + interceptUser;
    const priceAdmin = slopeAdmin * t + interceptAdmin;
    totalDiff += Math.abs(priceUser - priceAdmin) / tolerancePrice;
  }

  return totalDiff / (steps + 1);
}

  // ═══════════════════════════ PRIVATE HELPERS ═════════════════

  private _updateInMap(
    map: Map<number, DrawingLine[]>,
    testId: number, lineId: string,
    updates: Partial<DrawingLine>,
  ): Observable<DrawingLine[]> {
    const lines = map.get(testId) ?? [];
    const idx   = lines.findIndex(l => l.id === lineId);
    if (idx !== -1) {
      lines[idx] = { ...lines[idx], ...updates, updatedAt: new Date() };
      map.set(testId, lines);
      this.persist();
    }
    return of([...lines]);
  }

  private _deleteFromMap(
    map: Map<number, DrawingLine[]>,
    testId: number, lineId: string,
  ): Observable<DrawingLine[]> {
    const filtered = (map.get(testId) ?? []).filter(l => l.id !== lineId);
    map.set(testId, filtered);
    this.persist();
    return of([...filtered]);
  }

  private _similarity(a: DrawingLine, b: DrawingLine): number {
    const slope = (l: DrawingLine) => {
      const dx = l.endX - l.startX;
      return dx === 0 ? Infinity : (l.endY - l.startY) / dx;
    };
    const s1 = slope(a), s2 = slope(b);
    const slopeDiff =
      s1 === Infinity && s2 === Infinity ? 0
      : s1 === Infinity || s2 === Infinity ? 1
      : Math.min(Math.abs(s1 - s2) / 10, 1);
    const posDiff = Math.min(
      Math.hypot(
        (a.startX + a.endX) / 2 - (b.startX + b.endX) / 2,
        (a.startY + a.endY) / 2 - (b.startY + b.endY) / 2,
      ), 1,
    );
    return slopeDiff * 0.4 + posDiff * 0.6;
  }

  // ═══════════════════════════ PERSISTENCE ═════════════════════

private persist(): void {
  try {
    localStorage.setItem('drawing_data', JSON.stringify({
      adminLines:  Array.from(this.adminLines.entries()),
      userLines:   Array.from(this.userLines.entries()),
      matchedLines: Array.from(this.matchedLines.entries()).map(
        ([testId, set]) => [testId, Array.from(set)]
      ),
    }));
   
  } catch (e) {
    console.warn('[Store] persist failed:', e);
  }
}

  private loadFromLocalStorage(): void {
  try {
    const raw = localStorage.getItem('drawing_data');
    if (!raw) return;
    const { adminLines, userLines, matchedLines } = JSON.parse(raw);
    this.adminLines = new Map(adminLines);
    this.userLines  = new Map(userLines);
    if (matchedLines) {
      this.matchedLines = new Map(
        matchedLines.map(([id, arr]: [number, string[]]) => [id, new Set(arr)])
      );
    }
  } catch {
    this.adminLines   = new Map();
    this.userLines    = new Map();
    this.matchedLines = new Map();
  }
}
// Add this method to DrawingService
findAdminLineContainingTimeRange(testId: number, userLine: DrawingLine): DrawingLine | null {
  const adminLines = this.adminLines.get(testId) ?? [];
  const toleranceSec = 2 * 86400; // 2 days

  for (const admin of adminLines) {
    const adminStart = admin.startTime;
    const adminEnd   = admin.endTime;
    const userStart  = userLine.startTime;
    const userEnd    = userLine.endTime;

    const startInside = (userStart >= adminStart - toleranceSec && userStart <= adminEnd + toleranceSec);
    const endInside   = (userEnd   >= adminStart - toleranceSec && userEnd   <= adminEnd + toleranceSec);

    if (startInside && endInside) {
      return admin; // first matching admin line
    }
  }
  return null;
}
}