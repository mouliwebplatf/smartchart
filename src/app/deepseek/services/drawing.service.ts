// drawing.service.ts (UPDATED with Line Width Tolerance + Hint Blink Support)

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
  private readonly DEFAULT_PRICE_TOLERANCE_PERCENT = 0.05; // 5% price tolerance
  private readonly DEFAULT_SLOPE_TOLERANCE = 0.15;         // 15% slope tolerance
  private readonly SAMPLE_POINTS = 10;                     // Points to sample for distance calculation
private readonly EXACT_TIME_TOLERANCE_SEC = 1;     // 1 second
  private readonly EXACT_PRICE_TOLERANCE    = 0.01; 
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
   * Includes line width tolerance - users can draw lines that are close to
   * the admin line within a tolerance band (5% of price range by default).
   *
   * Returns a ValidationResult with details about the match.
   */
validateUserLine(testId: number, userLine: DrawingLine): ValidationResult {
    const adminLines = this.adminLines.get(testId) ?? [];
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

    if (remaining.length === 0) {
      return {
        isValid: true,
        score: 0,
        isWithinTolerance: true,
        remainingCount: 0,
        message: 'All lines already matched! Test complete.',
      };
    }

    // Find an exact match among remaining admin lines
    let matchedAdminLine: DrawingLine | null = null;
    for (const al of remaining) {
      if (this.isExactMatch(userLine, al)) {
        matchedAdminLine = al;
        break;
      }
    }

    if (matchedAdminLine) {
      matched.add(matchedAdminLine.id);
      this.matchedLines.set(testId, matched);

      const stillRemaining = adminLines.filter(al => !matched.has(al.id));

      return {
        isValid: true,
        score: 0,
        isWithinTolerance: true,
        correctLine: matchedAdminLine,
        remainingCount: stillRemaining.length,
        message: stillRemaining.length === 0
          ? '✓ All lines matched! Test complete!'
          : `✓ Correct! ${stillRemaining.length} line(s) remaining.`,
      };
    }

    // No exact match found
    return {
      isValid: false,
      score: 1.0,           // not used for exact matching, but kept for compatibility
      isWithinTolerance: false,
      correctLine: undefined,
      remainingCount: remaining.length,
      message: '✗ Line does not match any admin line exactly. Draw the exact same start and end points.',
    };
  }

   private isExactMatch(user: DrawingLine, admin: DrawingLine): boolean {
    // Tool type must be the same (or compatible if needed)
    if (user.tool !== admin.tool) return false;

    // For horizontal line: only start price and end price matter (times are irrelevant)
    if (user.tool === 'hline') {
      return Math.abs(user.startPrice - admin.startPrice) <= this.EXACT_PRICE_TOLERANCE
          && Math.abs(user.endPrice   - admin.endPrice)   <= this.EXACT_PRICE_TOLERANCE;
    }

    // For vertical line: only start time and end time matter
    if (user.tool === 'vline') {
      return Math.abs(user.startTime - admin.startTime) <= this.EXACT_TIME_TOLERANCE_SEC
          && Math.abs(user.endTime   - admin.endTime)   <= this.EXACT_TIME_TOLERANCE_SEC;
    }

    // For ray: check start point and slope (end point is ignored because ray extends infinitely)
    if (user.tool === 'ray') {
      const startTimeMatch  = Math.abs(user.startTime - admin.startTime) <= this.EXACT_TIME_TOLERANCE_SEC;
      const startPriceMatch = Math.abs(user.startPrice - admin.startPrice) <= this.EXACT_PRICE_TOLERANCE;
      if (!startTimeMatch || !startPriceMatch) return false;

      // Slope must match (direction)
      const userSlope  = this.calcSlope(user);
      const adminSlope = this.calcSlope(admin);
      return Math.abs(userSlope - adminSlope) <= 0.0001; // very small slope tolerance
    }

    // For trendline and straightline: both endpoints must match
    const startTimeMatch  = Math.abs(user.startTime - admin.startTime) <= this.EXACT_TIME_TOLERANCE_SEC;
    const endTimeMatch    = Math.abs(user.endTime   - admin.endTime)   <= this.EXACT_TIME_TOLERANCE_SEC;
    const startPriceMatch = Math.abs(user.startPrice - admin.startPrice) <= this.EXACT_PRICE_TOLERANCE;
    const endPriceMatch   = Math.abs(user.endPrice   - admin.endPrice)   <= this.EXACT_PRICE_TOLERANCE;

    return startTimeMatch && endTimeMatch && startPriceMatch && endPriceMatch;
  }

  private calcSlope(line: DrawingLine): number {
    const dt = line.endTime - line.startTime;
    if (Math.abs(dt) < 0.001) return 0;
    return (line.endPrice - line.startPrice) / dt;
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
    const overlapStart = Math.max(user.startTime, admin.startTime);
    const overlapEnd   = Math.min(user.endTime,   admin.endTime);

    if (overlapEnd <= overlapStart) return 2.0;

    const userTimeRange  = Math.max(user.endTime  - user.startTime,  1);
    const adminTimeRange = Math.max(admin.endTime - admin.startTime, 1);

    const userSlope  = (user.endPrice  - user.startPrice)  / userTimeRange;
    const adminSlope = (admin.endPrice - admin.startPrice) / adminTimeRange;

    const userIntercept  = user.startPrice  - userSlope  * user.startTime;
    const adminIntercept = admin.startPrice - adminSlope * admin.startTime;

    let totalDeviation = 0;
    let maxDeviation   = 0;
    let slopeDeviationSum = 0;

    for (let i = 0; i <= this.SAMPLE_POINTS; i++) {
      const t          = overlapStart + (overlapEnd - overlapStart) * (i / this.SAMPLE_POINTS);
      const userPrice  = userSlope  * t + userIntercept;
      const adminPrice = adminSlope * t + adminIntercept;
      const deviation  = Math.abs(userPrice - adminPrice);

      totalDeviation += deviation;
      maxDeviation    = Math.max(maxDeviation, deviation);

      if (i === 0 || i === this.SAMPLE_POINTS) {
        slopeDeviationSum += Math.abs(userSlope - adminSlope);
      }
    }

    const avgDeviation     = totalDeviation / (this.SAMPLE_POINTS + 1);
    const avgSlopeDeviation = slopeDeviationSum / 2;

    const deviationScore = avgDeviation / tolerancePrice;
    const slopeScore     = avgSlopeDeviation / (Math.abs(adminSlope) * this.DEFAULT_SLOPE_TOLERANCE + 0.01);

    // Weight: 70% deviation, 30% slope
    return (deviationScore * 0.7) + (Math.min(slopeScore, 1.0) * 0.3);
  }

  /**
   * Calculate the average distance between user line and admin line across sample points.
   */
  private calculateAverageDistance(
    user: DrawingLine,
    admin: DrawingLine,
    tolerancePrice: number
  ): number {
    const overlapStart = Math.max(user.startTime, admin.startTime);
    const overlapEnd   = Math.min(user.endTime,   admin.endTime);

    if (overlapEnd <= overlapStart) return Infinity;

    const userSlope  = (user.endPrice  - user.startPrice)  / Math.max(user.endTime  - user.startTime,  1);
    const adminSlope = (admin.endPrice - admin.startPrice) / Math.max(admin.endTime - admin.startTime, 1);

    const userIntercept  = user.startPrice  - userSlope  * user.startTime;
    const adminIntercept = admin.startPrice - adminSlope * admin.startTime;

    let totalDistance = 0;

    for (let i = 0; i <= this.SAMPLE_POINTS; i++) {
      const t          = overlapStart + (overlapEnd - overlapStart) * (i / this.SAMPLE_POINTS);
      const userPrice  = userSlope  * t + userIntercept;
      const adminPrice = adminSlope * t + adminIntercept;
      totalDistance   += Math.abs(userPrice - adminPrice);
    }

    return totalDistance / (this.SAMPLE_POINTS + 1);
  }

  /**
   * Calculate the price range across all admin lines for tolerance calculation.
   */
  private calculatePriceRange(adminLines: DrawingLine[]): number {
    if (!adminLines.length) return 1000;

    let minPrice =  Infinity;
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

  // ═══════════════════════════ HINT BLINK SUPPORT ══════════════════════════════

  /**
   * Returns all unmatched admin lines whose time range overlaps the user's
   * current preview line time range.
   *
   * Called on every crosshair move while the user is drawing.
   * Once an admin line is matched (correct answer drawn), it is automatically
   * excluded — its hint blink is permanently disabled with no extra handling needed.
   *
   * All three hint conditions collapse to a single time-range overlap check:
   *   1. Price range overlaps admin line price band        → time overlap is enough
   *   2. Time AND price both overlap admin line            → time overlap is enough
   *   3. Endpoint above/below admin line in the same zone → time overlap is enough
   */
  getUnmatchedAdminLinesInTimeRange(
    testId: number,
    previewStartTime: number,
    previewEndTime:   number
  ): DrawingLine[] {
    const adminLines = this.adminLines.get(testId) ?? [];
    const matched    = this.matchedLines.get(testId) ?? new Set<string>();

    const pvMin = Math.min(previewStartTime, previewEndTime);
    const pvMax = Math.max(previewStartTime, previewEndTime);

    return adminLines.filter(al => {
      // Already correctly answered — never blink again
      if (matched.has(al.id)) return false;

      const alMin = Math.min(al.startTime, al.endTime);
      const alMax = Math.max(al.startTime, al.endTime);

      // Time ranges must overlap
      return pvMax >= alMin && pvMin <= alMax;
    });
  }

  // ═══════════════════════════ REMAINING / STATUS HELPERS ══════════════════════

  /**
   * Get remaining unmatched admin lines for a test.
   */
  getRemainingAdminLines(testId: number): DrawingLine[] {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds    = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.filter(line => !matchedIds.has(line.id));
  }

  /**
   * Check if a specific admin line has been matched.
   */
  isAdminLineMatched(testId: number, adminLineId: string): boolean {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.has(adminLineId);
  }

  /**
   * Get match count for a test.
   */
  getMatchCount(testId: number): number {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.size;
  }

  /**
   * Check if test is complete (all admin lines matched).
   */
  isTestComplete(testId: number): boolean {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds    = this.matchedLines.get(testId) ?? new Set();
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