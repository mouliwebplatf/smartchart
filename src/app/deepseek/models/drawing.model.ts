// drawing.model.ts — Enhanced with handle, drag, and duplicate support

export type ThemeMode = 'dark' | 'light';
export type LineTool = 'trendline' | 'hline' | 'vline' | 'ray' | 'select';

export interface Point {
  x: number;
  y: number;
  time: number;
  price: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface LineHandle {
  type: 'start' | 'end' | 'midpoint';
  position: ScreenPoint;
}

export interface DrawingLine {
  id: string;
  testId: number;
  type: 'admin' | 'user';
  tool: LineTool;
   // For duplicate tracking
  duplicateCount?: number;   // For duplicate color variation


  // Chart-coordinate anchors (persisted to DB)
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;

  // Legacy pixel coords kept for similarity scoring
  startX: number;
  startY: number;
  endX: number;
  endY: number;

  color?: string;
  lineWidth?: number;
  createdAt: Date;
  updatedAt?: Date;

  // Duplicate lineage
  parentId?: string;
  isDuplicate?: boolean;
}

export interface ValidationResult {
   isValid: boolean;
  score: number;
  isWithinTolerance: boolean;
  correctLine?: DrawingLine;
  remainingCount?: number;
  message: string;
}

export interface DragState {
  active: boolean;
  lineId: string | null;
  handleType: 'start' | 'end' | 'body' | null;
  lastPoint: Point | null;
  distance: number; // px travelled since mousedown
}