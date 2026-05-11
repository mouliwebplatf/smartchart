// drawing.service.ts (UPDATED with Line Width Tolerance)

import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DrawingLine, ValidationResult } from '../models/drawing.model';

@Injectable({ providedIn: 'root' })
export class DrawingService {
  private adminLines   = new Map<number, DrawingLine[]>();
  private userLines    = new Map<number, DrawingLine[]>();
  private matchedLines = new Map<number, Set<string>>();

  // Configuration for validation tolerance
  private readonly DEFAULT_PRICE_TOLERANCE_PERCENT = 0.05; // 5% price tolerance (increased from 3%)
  private readonly DEFAULT_SLOPE_TOLERANCE = 0.15; // 15% slope tolerance
  private readonly SAMPLE_POINTS = 10; // Number of points to sample for distance calculation

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
    return of({ ...line });
  }

  saveAdminLines(testId: number, lines: DrawingLine[]): Observable<DrawingLine[]> {
    this.adminLines.set(testId, lines.map(l => ({ ...l })));
    this.persist();
    return of([...lines]);
  }

  updateAdminLine(
    testId: number,
    lineId: string,
    updates: Partial<DrawingLine>
  ): Observable<DrawingLine[]> {
    const lines = this.adminLines.get(testId) ?? [];
    const idx   = lines.findIndex(l => l.id === lineId);
    if (idx !== -1) {
      lines[idx] = { ...lines[idx], ...updates };
      this.adminLines.set(testId, lines);
    }
    return of([...lines]);
  }

  deleteAdminLine(testId: number, lineId: string): Observable<DrawingLine[]> {
    const filtered = (this.adminLines.get(testId) ?? []).filter(l => l.id !== lineId);
    this.adminLines.set(testId, filtered);
    return of([...filtered]);
  }

  clearAdminLines(testId: number): Observable<void> {
    this.adminLines.set(testId, []);
    this.persist();
    return of(void 0);
  }

  /**
   * Wipes in-memory admin lines so admin starts with a blank canvas each session.
   * Does NOT call persist() — saved answers in localStorage stay intact
   * so users can still be validated against them.
   */
  clearAdminLinesInMemoryOnly(testId: number): void {
    this.adminLines.set(testId, []);
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
    return of({ ...line });
  }

  updateUserLine(
    testId: number,
    lineId: string,
    updates: Partial<DrawingLine>
  ): Observable<DrawingLine[]> {
    const lines = this.userLines.get(testId) ?? [];
    const idx   = lines.findIndex(l => l.id === lineId);
    if (idx !== -1) {
      lines[idx] = { ...lines[idx], ...updates, updatedAt: new Date() };
      this.userLines.set(testId, lines);
    }
    return of([...lines]);
  }

  deleteUserLine(testId: number, lineId: string): Observable<DrawingLine[]> {
    const filtered = (this.userLines.get(testId) ?? []).filter(l => l.id !== lineId);
    this.userLines.set(testId, filtered);
    return of([...filtered]);
  }

  clearAllUserLines(testId: number): Observable<void> {
    this.userLines.set(testId, []);
    this.matchedLines.set(testId, new Set());
    console.log(`[Store] clearAllUserLines | testId=${testId}`);
    return of(void 0);
  }

  resetUserLines(testId: number): Observable<void>     { return this.clearAllUserLines(testId); }
  deleteAllUserLines(testId: number): Observable<void> { return this.clearAllUserLines(testId); }

  // ═══════════════════════════ SAVE ALL (role-aware) ════════════

  saveAllLines(testId: number, role: 'admin' | 'user'): Observable<DrawingLine[]> {
    if (role === 'admin') {
      const lines = [...(this.adminLines.get(testId) ?? [])];
      this.adminLines.set(testId, lines);
      this.persist();
      console.log(`[Store] saveAllLines admin | testId=${testId} | count=${lines.length}`);
      return of(lines);
    } else {
      const lines = [...(this.userLines.get(testId) ?? [])];
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
      duplicateCount: (original.duplicateCount || 0) + 1,
      type: 'admin',
      startTime:  original.startTime  + offsetTime,
      endTime:    original.endTime    + offsetTime,
      startPrice: original.startPrice + offsetPrice,
      endPrice:   original.endPrice   + offsetPrice,
      color: this.getDuplicateColor(original.duplicateCount || 0),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const lines = this.adminLines.get(testId) ?? [];
    lines.push(dup);
    this.adminLines.set(testId, lines);

    return of({ ...dup });
  }

  private getDuplicateColor(count: number): string {
    const colors = ['#FFA500', '#FF6B6B', '#4ECDC4', '#95E77E', '#FFD93D'];
    return colors[count % colors.length];
  }

  // ═══════════════════════════ MATCHED LINES TRACKING ══════════

  getMatchedLines(testId: number): Set<string> {
    return this.matchedLines.get(testId) ?? new Set();
  }

  getMatchedAdminLines(testId: number): DrawingLine[] {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.filter(line => !matchedIds.has(line.id));
  }

  clearMatchedLines(testId: number): void {
    this.matchedLines.set(testId, new Set());
  }

  // ═══════════════════════════ VALIDATION WITH WIDTH TOLERANCE ══════════════════════

  /**
   * Validates a user-drawn line against remaining unmatched admin reference lines.
   * 
   * NEW: Includes line width tolerance - users can draw lines that are close to
   * the admin line within a tolerance band (5% of price range by default).
   * 
   * Returns a ValidationResult with details about the match.
   */
  validateUserLine(testId: number, userLine: DrawingLine): ValidationResult {
    const adminLines = this.adminLines.get(testId) ?? [];
    console.log(`[Validate] Admin lines: ${adminLines.length}`);

    if (adminLines.length === 0) {
      return {
        isValid: true,
        score: 0,
        isWithinTolerance: true,
        remainingCount: 0,
        message: 'No correct lines defined – line accepted.',
      };
    }

    const matched   = this.matchedLines.get(testId) ?? new Set<string>();
    const remaining = adminLines.filter(al => !matched.has(al.id));
    console.log(`[Validate] Matched: ${matched.size}, Remaining: ${remaining.length}`);

    if (remaining.length === 0) {
      return {
        isValid: true,
        score: 0,
        isWithinTolerance: true,
        remainingCount: 0,
        message: 'All lines already matched! Test complete.',
      };
    }

    // Calculate price range for tolerance
    const priceRange = this.calculatePriceRange(adminLines);
    const tolerancePrice = priceRange * this.DEFAULT_PRICE_TOLERANCE_PERCENT;

    // Find the best-matching unmatched admin line
    let bestMatch: DrawingLine | null = null;
    let bestScore = Infinity;
    let bestDistance = Infinity;

    for (const al of remaining) {
      const score = this.calculateSimilarityWithTolerance(userLine, al, tolerancePrice);
      const avgDistance = this.calculateAverageDistance(userLine, al, tolerancePrice);
      
      console.log(`[Validate] Admin ${al.id.substring(0, 8)}: score=${score.toFixed(4)}, avgDistance=${avgDistance.toFixed(4)}`);
      
      if (score < bestScore) {
        bestScore = score;
        bestDistance = avgDistance;
        bestMatch = al;
      }
    }

    // Check if line is within tolerance
    const isWithinTolerance = bestScore < 1.0;
    const isValid = isWithinTolerance && bestMatch !== null;

    if (isValid && bestMatch) {
      matched.add(bestMatch.id);
      this.matchedLines.set(testId, matched);

      const stillRemaining = adminLines.filter(al => !matched.has(al.id));
      console.log(`[Validate] After match, still remaining: ${stillRemaining.length}`);

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
      message: `✗ Incorrect line. Try drawing closer to the hint line (tolerance: ±${tolerancePrice.toFixed(2)}).`,
    };
  }

  /**
   * Calculate similarity score between user line and admin line with tolerance.
   * Lower score is better. Score < 1.0 means within tolerance.
   */
  private calculateSimilarityWithTolerance(
    user: DrawingLine, 
    admin: DrawingLine, 
    tolerancePrice: number
  ): number {
    // Calculate overlapping time range
    const overlapStart = Math.max(user.startTime, admin.startTime);
    const overlapEnd = Math.min(user.endTime, admin.endTime);

    // No temporal overlap
    if (overlapEnd <= overlapStart) return 2.0;

    // Calculate slopes
    const userTimeRange = Math.max(user.endTime - user.startTime, 1);
    const adminTimeRange = Math.max(admin.endTime - admin.startTime, 1);
    
    const userSlope = (user.endPrice - user.startPrice) / userTimeRange;
    const adminSlope = (admin.endPrice - admin.startPrice) / adminTimeRange;
    
    // Calculate intercepts
    const userIntercept = user.startPrice - userSlope * user.startTime;
    const adminIntercept = admin.startPrice - adminSlope * admin.startTime;

    // Sample points across the overlap
    let totalDeviation = 0;
    let maxDeviation = 0;
    let slopeDeviationSum = 0;
    
    for (let i = 0; i <= this.SAMPLE_POINTS; i++) {
      const t = overlapStart + (overlapEnd - overlapStart) * (i / this.SAMPLE_POINTS);
      const userPrice = userSlope * t + userIntercept;
      const adminPrice = adminSlope * t + adminIntercept;
      const deviation = Math.abs(userPrice - adminPrice);
      
      totalDeviation += deviation;
      maxDeviation = Math.max(maxDeviation, deviation);
      
      // Track slope deviation at endpoints
      if (i === 0 || i === this.SAMPLE_POINTS) {
        slopeDeviationSum += Math.abs(userSlope - adminSlope);
      }
    }
    
    const avgDeviation = totalDeviation / (this.SAMPLE_POINTS + 1);
    const avgSlopeDeviation = slopeDeviationSum / 2;
    
    // Combined score: weighted average of deviation and slope difference
    const deviationScore = avgDeviation / tolerancePrice;
    const slopeScore = avgSlopeDeviation / (Math.abs(adminSlope) * this.DEFAULT_SLOPE_TOLERANCE + 0.01);
    
    // Weight: 70% deviation, 30% slope
    return (deviationScore * 0.7) + (Math.min(slopeScore, 1.0) * 0.3);
  }

  /**
   * Calculate the average distance between user line and admin line across sample points
   */
  private calculateAverageDistance(
    user: DrawingLine, 
    admin: DrawingLine, 
    tolerancePrice: number
  ): number {
    const overlapStart = Math.max(user.startTime, admin.startTime);
    const overlapEnd = Math.min(user.endTime, admin.endTime);
    
    if (overlapEnd <= overlapStart) return Infinity;
    
    const userSlope = (user.endPrice - user.startPrice) / Math.max(user.endTime - user.startTime, 1);
    const adminSlope = (admin.endPrice - admin.startPrice) / Math.max(admin.endTime - admin.startTime, 1);
    const userIntercept = user.startPrice - userSlope * user.startTime;
    const adminIntercept = admin.startPrice - adminSlope * admin.startTime;
    
    let totalDistance = 0;
    
    for (let i = 0; i <= this.SAMPLE_POINTS; i++) {
      const t = overlapStart + (overlapEnd - overlapStart) * (i / this.SAMPLE_POINTS);
      const userPrice = userSlope * t + userIntercept;
      const adminPrice = adminSlope * t + adminIntercept;
      totalDistance += Math.abs(userPrice - adminPrice);
    }
    
    return totalDistance / (this.SAMPLE_POINTS + 1);
  }

  /**
   * Calculate the price range across all admin lines for tolerance calculation
   */
  private calculatePriceRange(adminLines: DrawingLine[]): number {
    if (!adminLines.length) return 1000; // Default range
    
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (const line of adminLines) {
      minPrice = Math.min(minPrice, line.startPrice, line.endPrice);
      maxPrice = Math.max(maxPrice, line.startPrice, line.endPrice);
    }
    
    return maxPrice - minPrice;
  }

  /**
   * Returns the first admin line whose time range overlaps the user line's time range
   * (within a 2-day tolerance on each side). Used to flash a hint when the user draws
   * in the right zone but with the wrong slope/price.
   */
  findAdminLineContainingTimeRange(
    testId: number,
    userLine: DrawingLine
  ): DrawingLine | null {
    const adminLines   = this.adminLines.get(testId) ?? [];
    const toleranceSec = 2 * 86400;

    for (const admin of adminLines) {
      const adminStart = admin.startTime - toleranceSec;
      const adminEnd   = admin.endTime   + toleranceSec;
      if (userLine.startTime <= adminEnd && userLine.endTime >= adminStart) {
        return admin;
      }
    }
    return null;
  }

  /**
   * Get remaining unmatched admin lines for a test
   */
  getRemainingAdminLines(testId: number): DrawingLine[] {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.filter(line => !matchedIds.has(line.id));
  }

  /**
   * Check if a specific admin line has been matched
   */
  isAdminLineMatched(testId: number, adminLineId: string): boolean {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.has(adminLineId);
  }

  /**
   * Get match count for a test
   */
  getMatchCount(testId: number): number {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.size;
  }

  /**
   * Check if test is complete (all admin lines matched)
   */
  isTestComplete(testId: number): boolean {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.length > 0 && matchedIds.size >= allAdminLines.length;
  }

  // ═══════════════════════════ PRIVATE HELPERS ═════════════════

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
      ),
      1,
    );
    return slopeDiff * 0.4 + posDiff * 0.6;
  }

  // ═══════════════════════════ PERSISTENCE ═════════════════════

  private persist(): void {
    try {
      localStorage.setItem(
        'drawing_data',
        JSON.stringify({
          adminLines: Array.from(this.adminLines.entries()),
        })
      );
    } catch (e) {
      console.warn('[Store] persist failed:', e);
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem('drawing_data');
      if (!raw) return;

      const { adminLines } = JSON.parse(raw);

      this.adminLines = new Map(
        (adminLines ?? []).map(([k, v]: [any, DrawingLine[]]) => [Number(k), v])
      );
      this.userLines    = new Map();
      this.matchedLines = new Map();
    } catch {
      this.adminLines   = new Map();
      this.userLines    = new Map();
      this.matchedLines = new Map();
    }
  }
  
}