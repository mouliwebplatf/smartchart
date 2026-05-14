// drawing.service.ts
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DrawingLine, LineTool, ValidationResult } from '../models/drawing.model';

@Injectable({ providedIn: 'root' })
export class DrawingService {
  private adminLines   = new Map<number, DrawingLine[]>();
  private userLines    = new Map<number, DrawingLine[]>();
  private matchedLines = new Map<number, Set<string>>();

  // Tolerance for exact matching (users must draw precisely)
  private readonly EXACT_TIME_TOLERANCE_SEC = 1;     // 1 second
  private readonly EXACT_PRICE_TOLERANCE    = 0.01; // 0.01 price units

  constructor() {
    this.loadFromLocalStorage();
  }

  // ═══════════════════════════ ADMIN LINES ═══════════════════════════

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

  updateAdminLine(
    testId: number,
    lineId: string,
    updates: Partial<DrawingLine>
  ): Observable<DrawingLine[]> {
    const lines = this.adminLines.get(testId) ?? [];
    const idx   = lines.findIndex(l => l.id === lineId);
    if (idx !== -1) {
      lines[idx] = { ...lines[idx], ...updates, updatedAt: new Date() };
      this.adminLines.set(testId, lines);
      this.persist();
    }
    return of([...lines]);
  }

  deleteAdminLine(testId: number, lineId: string): Observable<DrawingLine[]> {
    const filtered = (this.adminLines.get(testId) ?? []).filter(l => l.id !== lineId);
    this.adminLines.set(testId, filtered);
    this.persist();
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

  // ═══════════════════════════ USER LINES ════════════════════════════

  getUserLines(testId: number): Observable<DrawingLine[]> {
    return of([...(this.userLines.get(testId) ?? [])]);
  }

  saveUserLine(testId: number, line: DrawingLine): Observable<DrawingLine> {
    const lines = this.userLines.get(testId) ?? [];
    const existingIdx = lines.findIndex(l => l.id === line.id);
    if (existingIdx !== -1) {
      lines[existingIdx] = { ...line, updatedAt: new Date() };
    } else {
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
    // Also remove from matchedLines if it was matched? No, matchedLines tracks admin lines only.
    return of([...filtered]);
  }

  clearAllUserLines(testId: number): Observable<void> {
    this.userLines.set(testId, []);
    this.matchedLines.set(testId, new Set());
    console.log(`[DrawingService] clearAllUserLines | testId=${testId}`);
    return of(void 0);
  }

  resetUserLines(testId: number): Observable<void>     { return this.clearAllUserLines(testId); }
  deleteAllUserLines(testId: number): Observable<void> { return this.clearAllUserLines(testId); }

  // ═══════════════════════════ SAVE ALL (role-aware) ═══════════════════

  saveAllLines(testId: number, role: 'admin' | 'user'): Observable<DrawingLine[]> {
    if (role === 'admin') {
      const lines = [...(this.adminLines.get(testId) ?? [])];
      this.adminLines.set(testId, lines);
      this.persist();
      console.log(`[DrawingService] saveAllLines admin | testId=${testId} | count=${lines.length}`);
      return of(lines);
    } else {
      const lines = [...(this.userLines.get(testId) ?? [])];
      console.log(`[DrawingService] saveAllLines user | testId=${testId} | count=${lines.length}`);
      return of(lines);
    }
  }

  // ═══════════════════════════ DUPLICATE ═══════════════════════════

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
    this.persist();

    return of({ ...dup });
  }

  private getDuplicateColor(count: number): string {
    const colors = ['#FFA500', '#FF6B6B', '#4ECDC4', '#95E77E', '#FFD93D'];
    return colors[count % colors.length];
  }

  // ═══════════════════════════ MATCHED LINES TRACKING ═══════════════

  getMatchedLines(testId: number): Set<string> {
    return this.matchedLines.get(testId) ?? new Set();
  }

  getMatchedAdminLines(testId: number): DrawingLine[] {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.filter(line => matchedIds.has(line.id));
  }

  clearMatchedLines(testId: number): void {
    this.matchedLines.set(testId, new Set());
  }

  // ═══════════════════════════ VALIDATION (EXACT MATCHING) ══════════════════════

  /**
   * Validates a user-drawn line against remaining unmatched admin reference lines.
   * Uses exact time/price tolerances (strict matching).
   * Returns a ValidationResult with details.
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
      score: 1.0,
      isWithinTolerance: false,
      correctLine: undefined,
      remainingCount: remaining.length,
      message: '✗ Line does not match any admin line exactly. Draw the exact same start and end points.',
    };
  }

  /**
   * Checks if a user line exactly matches an admin line within tolerances.
   */
  private isExactMatch(user: DrawingLine, admin: DrawingLine): boolean {
    if (user.tool !== admin.tool) return false;

    // Horizontal line: only prices matter (times are ignored)
    if (user.tool === 'hline') {
      return Math.abs(user.startPrice - admin.startPrice) <= this.EXACT_PRICE_TOLERANCE
          && Math.abs(user.endPrice   - admin.endPrice)   <= this.EXACT_PRICE_TOLERANCE;
    }

    // Vertical line: only times matter
    if (user.tool === 'vline') {
      return Math.abs(user.startTime - admin.startTime) <= this.EXACT_TIME_TOLERANCE_SEC
          && Math.abs(user.endTime   - admin.endTime)   <= this.EXACT_TIME_TOLERANCE_SEC;
    }

    // Ray: start point and slope must match
    if (user.tool === 'ray') {
      const startTimeMatch  = Math.abs(user.startTime - admin.startTime) <= this.EXACT_TIME_TOLERANCE_SEC;
      const startPriceMatch = Math.abs(user.startPrice - admin.startPrice) <= this.EXACT_PRICE_TOLERANCE;
      if (!startTimeMatch || !startPriceMatch) return false;

      const userSlope  = this.calcSlope(user);
      const adminSlope = this.calcSlope(admin);
      return Math.abs(userSlope - adminSlope) <= 0.0001; // very small slope tolerance
    }

    // Trendline and straightline: both endpoints must match
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

  // ═══════════════════════════ HINT BLINK SUPPORT ══════════════════════════════

  /**
   * Returns all unmatched admin lines whose time range overlaps the user's
   * current preview line time range.
   *
   * Called on every crosshair move while the user is drawing.
   * Once an admin line is matched (correct answer drawn), it is automatically excluded.
   */
  getUnmatchedAdminLinesInTimeRange(
    testId: number,
    previewStartTime: number,
    previewEndTime: number
  ): DrawingLine[] {
    const adminLines = this.adminLines.get(testId) ?? [];
    const matched    = this.matchedLines.get(testId) ?? new Set<string>();

    const pvMin = Math.min(previewStartTime, previewEndTime);
    const pvMax = Math.max(previewStartTime, previewEndTime);

    return adminLines.filter(al => {
      if (matched.has(al.id)) return false;
      const alMin = Math.min(al.startTime, al.endTime);
      const alMax = Math.max(al.startTime, al.endTime);
      return pvMax >= alMin && pvMin <= alMax;
    });
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

  // ═══════════════════════════ REMAINING / STATUS HELPERS ══════════════════════

  getRemainingAdminLines(testId: number): DrawingLine[] {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds    = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.filter(line => !matchedIds.has(line.id));
  }

  isAdminLineMatched(testId: number, adminLineId: string): boolean {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.has(adminLineId);
  }

  getMatchCount(testId: number): number {
    const matchedIds = this.matchedLines.get(testId) ?? new Set();
    return matchedIds.size;
  }

  isTestComplete(testId: number): boolean {
    const allAdminLines = this.adminLines.get(testId) ?? [];
    const matchedIds    = this.matchedLines.get(testId) ?? new Set();
    return allAdminLines.length > 0 && matchedIds.size >= allAdminLines.length;
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
      console.warn('[DrawingService] persist failed:', e);
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
      // userLines and matchedLines are not persisted; they are session-only.
      this.userLines    = new Map();
      this.matchedLines = new Map();
    } catch {
      this.adminLines   = new Map();
      this.userLines    = new Map();
      this.matchedLines = new Map();
    }
  }
}