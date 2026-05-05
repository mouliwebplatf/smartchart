import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { v4 as uuidv4 } from 'uuid';
import * as LightweightCharts from 'lightweight-charts';

import { DrawingService } from '../services/drawing.service';
import { AuthService } from '../services/auth.service';
import { DrawingLine, Point, ScreenPoint, ThemeMode } from '../models/drawing.model';
import { Subject, takeUntil } from 'rxjs';

type ToolMode = 'trendline' | 'hline' | 'vline' | 'ray' | 'select';

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss']
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  private dragLineSnapshot: DrawingLine | null = null;
  shiftHeld: boolean = false;
  totalAdminLines: number = 0;
  matchedCount: number = 0;
  testComplete: boolean = false;
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('handleCanvas') handleCanvas!: ElementRef<HTMLCanvasElement>;

  // Extension controls properties
  extendLeftValue: number = 0;
  extendRightValue: number = 0;
  showExtendControls: boolean = false;
  extendingLineId: string | null = null;

  // Handle drag states
  public isExtendingLeftHandle: boolean = false;
  public isExtendingRightHandle: boolean = false;
  private extendingLineIdHandle: string | null = null;
  private handleCanvasContext: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private originalLineState: DrawingLine | null = null;

  private destroy$ = new Subject<void>();
  private isResetting = false;

  testId: number = 0;
  testName: string = '';
  userRole: string | null = null;
  currentTheme: ThemeMode = 'dark';

  durationValue: number = 1;
  durationType: string = 'month';

  activeTool: ToolMode = 'trendline';
  isDrawing: boolean = false;
  private drawingStartPoint: Point | null = null;

  private previewSeries: any = null;
  private hasFirstPoint: boolean = false;

  userLines: DrawingLine[] = [];
  adminLines: DrawingLine[] = [];
  selectedLineId: string | null = null;
  selectedLineOwner: 'user' | 'admin' | null = null;

  // Drag state for line movement
  private isDraggingLine: boolean = false;
  private draggedLineId: string | null = null;
  private dragStartPoint: { time: number; price: number } | null = null;
  private dragDistance: number = 0;
  private hoveredLineId: string | null = null;
  cursorIsOverInteractable: boolean = false;

  // Double-click prevention
  private clickTimeout: any = null;
  private lastClickTime: number = 0;
  private pendingClickParam: any = null;

  validationMessage: string = '';
  messageType: 'success' | 'error' | 'info' = 'info';
  showTolerance: boolean = false;
  currentCorrectLine: DrawingLine | null = null;
  private toleranceZoneSeries: any[] = [];

  private chart: any = null;
  private candlestickSeries: any = null;
  private lineSeriesMap: Map<string, any> = new Map();
  private chartData: any[] = [];

  private themes = {
    light: { background: '#ffffff', textColor: '#333333', gridColor: '#e0e0e0', borderColor: '#d1d1d1' },
    dark: { background: '#1e222d', textColor: '#d1d4dc', gridColor: '#2a2e39', borderColor: '#2a2e39' }
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private drawingService: DrawingService
  ) {}

  ngAfterViewInit(): void {
    this.testId = Number(this.route.snapshot.paramMap.get('id'));
    this.userRole = this.authService.getRole();
    this.testName = this.route.snapshot.queryParams['name'] || 'NIFTY 50';
    console.log('[Chart] Initialized, role:', this.userRole);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.initChart().then(() => this.loadData());
      });
    });
  }

  ngOnDestroy(): void {
    if (this.chart) this.chart.remove();
    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener('resize', this.handleResize);
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
    }
  }

  // ==================== THEME ====================
  toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
  }

  private applyTheme(): void {
    const t = this.themes[this.currentTheme];
    if (!this.chart) return;
    this.chart.applyOptions({
      layout: { background: { color: t.background }, textColor: t.textColor },
      grid: { vertLines: { color: t.gridColor }, horzLines: { color: t.gridColor } },
      timeScale: { borderColor: t.borderColor },
      rightPriceScale: { borderColor: t.borderColor },
    });
    this.renderLines();
    this.drawHandles();
  }

  // ==================== INIT ====================
  private handleResize = (): void => {
    if (this.chart && this.chartContainer) {
      this.chart.applyOptions({ width: this.chartContainer.nativeElement.clientWidth });
      this.updateCanvasSize();
    }
  };

  private async initChart(): Promise<void> {
    const container = this.chartContainer.nativeElement;
    if (container.clientWidth === 0) {
      console.error('Chart container has zero width');
      return;
    }
    const t = this.themes[this.currentTheme];
    this.chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 600,
      layout: { background: { color: t.background }, textColor: t.textColor },
      grid: { vertLines: { color: t.gridColor }, horzLines: { color: t.gridColor } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: t.borderColor },
      rightPriceScale: { borderColor: t.borderColor },
      crosshair: { mode: 0 },
    });

    this.candlestickSeries = this.chart.addCandlestickSeries({
      upColor: '#00B746', downColor: '#EF403C',
      borderVisible: false,
      wickUpColor: '#00B746', wickDownColor: '#EF403C',
    });

    // Click handler with proper double-click prevention
    this.chart.subscribeClick((param: any) => {
      if (!param?.point) return;
      
      const now = Date.now();
      const timeSinceLastClick = now - this.lastClickTime;
      
      // If this is a double-click (within 300ms), ignore it completely
      if (timeSinceLastClick < 300 && this.lastClickTime > 0) {
        // This is a double-click - do nothing
        this.lastClickTime = 0;
        if (this.clickTimeout) {
          clearTimeout(this.clickTimeout);
          this.clickTimeout = null;
        }
        return;
      }
      
      // Store this as a potential single click
      this.lastClickTime = now;
      this.pendingClickParam = param;
      
      // Clear any existing timeout
      if (this.clickTimeout) {
        clearTimeout(this.clickTimeout);
      }
      
      // Set timeout to process the click if no double-click follows
      this.clickTimeout = setTimeout(() => {
        if (this.pendingClickParam && !this.isDraggingLine) {
          if (this.activeTool === 'select') {
            if (this.dragDistance <= 5) {
              this.handleSelectClick(this.pendingClickParam);
            }
            this.dragDistance = 0;
          } else {
            this.handleChartClick(this.pendingClickParam);
          }
        }
        this.pendingClickParam = null;
        this.clickTimeout = null;
      }, 300);
    });

    this.chart.subscribeCrosshairMove((param: any) => {
      if (!param?.point) return;
      if (this.isDrawing && this.hasFirstPoint && this.previewSeries) {
        this.updatePreviewLine(param);
      }
    });

    window.addEventListener('resize', this.handleResize);
    await this.loadChartData();
    
    setTimeout(() => {
      this.setupHandleCanvas();
    }, 100);
  }

  private setupHandleCanvas(): void {
    const canvas = this.handleCanvas?.nativeElement;
    const container = this.chartContainer?.nativeElement;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';

    this.handleCanvasContext = canvas.getContext('2d');
    this.handleCanvasContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.startHandleRendering();
  }

  private startHandleRendering(): void {
    const draw = () => {
      this.drawHandles();
      this.animationFrameId = requestAnimationFrame(draw);
    };
    this.animationFrameId = requestAnimationFrame(draw);
  }

  private drawHandles(): void {
    if (!this.handleCanvasContext || !this.selectedLineId) {
      this.clearHandles();
      return;
    }

    const line = this.userLines.find(l => l.id === this.selectedLineId) ??
                 this.adminLines.find(l => l.id === this.selectedLineId);

    if (!line) {
      this.clearHandles();
      return;
    }

    const startPoint = this.chartToScreenPoint(line.startTime, line.startPrice);
    const endPoint = this.chartToScreenPoint(line.endTime, line.endPrice);
    if (!startPoint || !endPoint) {
      this.clearHandles();
      return;
    }

    this.clearHandles();
    this.drawHandle(startPoint.x, startPoint.y);
    this.drawHandle(endPoint.x, endPoint.y);
  }

  private drawHandle(x: number, y: number): void {
    if (!this.handleCanvasContext) return;
    const ctx = this.handleCanvasContext;
    
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#FFA500';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private clearHandles(): void {
    if (!this.handleCanvasContext || !this.handleCanvas?.nativeElement) return;
    const canvas = this.handleCanvas.nativeElement;
    this.handleCanvasContext.clearRect(0, 0, canvas.width, canvas.height);
  }

  private updateCanvasSize(): void {
    const canvas = this.handleCanvas?.nativeElement;
    const container = this.chartContainer?.nativeElement;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';
    this.handleCanvasContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHandles();
  }

  private getHandleAtPoint(sp: ScreenPoint): { type: 'left' | 'right', lineId: string } | null {
    if (!this.selectedLineId) return null;

    const line = this.userLines.find(l => l.id === this.selectedLineId) ??
                 this.adminLines.find(l => l.id === this.selectedLineId);
    if (!line) return null;

    const startPoint = this.chartToScreenPoint(line.startTime, line.startPrice);
    const endPoint = this.chartToScreenPoint(line.endTime, line.endPrice);
    if (!startPoint || !endPoint) return null;

    if (Math.hypot(sp.x - startPoint.x, sp.y - startPoint.y) < 10)
      return { type: 'left', lineId: line.id };
    if (Math.hypot(sp.x - endPoint.x, sp.y - endPoint.y) < 10)
      return { type: 'right', lineId: line.id };

    return null;
  }

  // ==================== TOOL SELECTION ====================
  setActiveTool(tool: ToolMode): void {
    this.cancelDrawing();

    if (tool !== 'select') {
      this.selectedLineId = null;
      this.selectedLineOwner = null;
      this.hoveredLineId = null;
      this.isDraggingLine = false;
      this.draggedLineId = null;
      this.isExtendingLeftHandle = false;
      this.isExtendingRightHandle = false;
      this.extendingLineIdHandle = null;
      this.cursorIsOverInteractable = false;
      this.clearHandles();
    }

    this.activeTool = tool;
    this.showMessage(`Tool: ${tool}`, 'info');
    this.renderLines();
    this.drawHandles();
  }

  // ==================== DRAWING ====================
  private cancelDrawing(): void {
    if (this.previewSeries) {
      try { this.chart.removeSeries(this.previewSeries); } catch { }
      this.previewSeries = null;
    }
    this.isDrawing = false;
    this.hasFirstPoint = false;
    this.drawingStartPoint = null;
  }

  private handleChartClick(param: any): void {
    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    const cp = this.screenToChartPoint(sp);
    if (!cp) return;

    if (!this.isDrawing) {
      this.isDrawing = true;
      this.hasFirstPoint = false;
      this.drawingStartPoint = cp;

      this.previewSeries = this.chart.addLineSeries({
        color: '#FFD700', lineWidth: 2, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
      });
      this.hasFirstPoint = true;
    } else {
      let endPoint = cp;
      if (this.shiftHeld) {
        endPoint = this.snapToAngle(this.drawingStartPoint!, cp);
      }
      this.finishDrawing(endPoint);
      this.cancelDrawing();
    }
  }

  private finishDrawing(endPoint: Point): void {
    if (!this.drawingStartPoint) return;
    let start = { ...this.drawingStartPoint };
    let end = { ...endPoint };

    switch (this.activeTool) {
      case 'hline':
        end.price = start.price;
        if (end.time === start.time) end.time = start.time + 86400;
        break;
      case 'vline':
        end.price = start.price;
        break;
    }
    if (this.activeTool !== 'ray' && this.activeTool !== 'vline' && start.time > end.time) {
      [start, end] = [end, start];
    }

    const newLine: DrawingLine = {
      id: uuidv4(),
      testId: this.testId,
      type: this.userRole === 'admin' ? 'admin' : 'user',
      tool: this.activeTool as 'trendline' | 'hline' | 'vline' | 'ray',
      startX: start.x, startY: start.y,
      endX: end.x, endY: end.y,
      startTime: start.time, startPrice: start.price,
      endTime: end.time, endPrice: end.price,
      color: this.userRole === 'admin' ? '#FF6B6B' : '#4ECDC4',
      createdAt: new Date(),
    };

    if (this.userRole === 'admin') {
      this.adminLines.push(newLine);
      this.drawingService.addAdminLine(this.testId, newLine).subscribe();
      this.renderLines();
      this.showMessage('✓ Admin line drawn. Click Save to persist.', 'success');
    } else {
      this.validateAndSaveUserLine(newLine);
    }
  }

  private updatePreviewLine(param: any): void {
    if (!this.drawingStartPoint || !this.previewSeries || !this.hasFirstPoint) return;
    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    let cp = this.screenToChartPoint(sp);
    if (!cp) return;

    let end = { ...cp };
    if (this.shiftHeld) {
      end = this.snapToAngle(this.drawingStartPoint, end);
    }
    if (this.activeTool === 'hline') end.price = this.drawingStartPoint.price;
    if (this.activeTool === 'vline') end.time = this.drawingStartPoint.time;

    if (this.activeTool === 'hline' || this.activeTool === 'ray') {
      const pts = this.getExtendedPoints(this.drawingStartPoint, end);
      if (pts.length >= 2) this.previewSeries.setData(pts);
    } else {
      const t1 = this.drawingStartPoint.time;
      const t2 = end.time;
      if (t1 === t2) return;
      const ordered = t1 < t2
        ? [{ time: t1, value: this.drawingStartPoint.price }, { time: t2, value: end.price }]
        : [{ time: t2, value: end.price }, { time: t1, value: this.drawingStartPoint.price }];
      this.previewSeries.setData(ordered);
    }
  }

  private snapToAngle(start: Point, end: Point): Point {
    const startScreen = this.chartToScreenPoint(start.time, start.price);
    const endScreen = this.chartToScreenPoint(end.time, end.price);
    if (!startScreen || !endScreen) return end;

    const dx = endScreen.x - startScreen.x;
    const dy = endScreen.y - startScreen.y;
    let newScreenX: number, newScreenY: number;

    if (Math.abs(dx) >= Math.abs(dy)) {
      newScreenX = endScreen.x;
      newScreenY = startScreen.y;
    } else {
      newScreenX = startScreen.x;
      newScreenY = endScreen.y;
    }

    const snapped = this.screenToChartPoint({ x: newScreenX, y: newScreenY });
    return snapped ?? end;
  }

  private getExtendedPoints(start: Point, end: Point): any[] {
    const tr = this.chart.timeScale().getVisibleRange();
    if (!tr) return [];
    const dt = end.time - start.time;
    const dp = end.price - start.price;
    if (dt === 0) return [{ time: start.time, value: start.price }];
    const m = dp / dt;
    const b = start.price - m * start.time;
    const from = tr.from as number;
    const to = tr.to as number;
    return [
      { time: from, value: m * from + b },
      { time: to, value: m * to + b },
    ];
  }

  // ==================== SELECT & HIT TEST ====================
  private handleSelectClick(param: any): void {
    // Ignore if we're dragging
    if (this.dragDistance > 3) {
      this.dragDistance = 0;
      return;
    }

    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    const handle = this.getHandleAtPoint(sp);
    if (handle) return;

    const hit = this.getLineAtPoint(sp);
    if (hit) {
      this.selectedLineId = hit.id;
      this.selectedLineOwner = hit.owner;
      this.renderLines();
      this.drawHandles();
      this.showMessage(`✓ Line selected - Click and drag to move it anywhere`, 'success');
    } else {
      this.selectedLineId = null;
      this.selectedLineOwner = null;
      this.renderLines();
      this.clearHandles();
      this.showMessage('Selection cleared', 'info');
    }
  }

  private getLineAtPoint(sp: ScreenPoint): { id: string; owner: 'user' | 'admin' } | null {
    for (const line of this.userLines) {
      const a = this.chartToScreenPoint(line.startTime, line.startPrice);
      const b = this.chartToScreenPoint(line.endTime, line.endPrice);
      if (a && b && this.distanceToSegment(sp, a, b) < 10) {
        return { id: line.id, owner: 'user' };
      }
    }
    if (this.userRole === 'admin') {
      for (const line of this.adminLines) {
        const a = this.chartToScreenPoint(line.startTime, line.startPrice);
        const b = this.chartToScreenPoint(line.endTime, line.endPrice);
        if (a && b && this.distanceToSegment(sp, a, b) < 10) {
          return { id: line.id, owner: 'admin' };
        }
      }
    }
    return null;
  }

  private distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) return Math.hypot(apx, apy);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
    return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
  }

  // ==================== DRAG & EXTEND HANDLERS ====================
  @HostListener('document:mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    this.dragDistance = 0;
    if (this.activeTool !== 'select') return;

    const container = this.chartContainer?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom) return;

    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    
    const handle = this.getHandleAtPoint(sp);
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      this.extendingLineIdHandle = handle.lineId;
      if (handle.type === 'left') {
        this.isExtendingLeftHandle = true;
        this.isExtendingRightHandle = false;
      } else {
        this.isExtendingRightHandle = true;
        this.isExtendingLeftHandle = false;
      }
      const line = this.userLines.find(l => l.id === handle.lineId) ??
                   this.adminLines.find(l => l.id === handle.lineId);
      if (line) this.originalLineState = { ...line };
      this.showMessage(`Drag handle to extend line`, 'info');
      return;
    }
    
    const hit = this.getLineAtPoint(sp);
    if (hit) {
      event.preventDefault();
      this.selectedLineId = hit.id;
      this.selectedLineOwner = hit.owner;
      this.isDraggingLine = true;
      this.draggedLineId = hit.id;

      const line = hit.owner === 'user'
        ? this.userLines.find(l => l.id === hit.id)
        : this.adminLines.find(l => l.id === hit.id);

      if (line) {
        this.dragLineSnapshot = { ...line };
        const cp = this.screenToChartPoint(sp);
        if (cp) this.dragStartPoint = { time: cp.time, price: cp.price };
      }

      this.renderLines();
      this.drawHandles();
      this.showMessage(`↗ Dragging line - Release mouse to place it`, 'info');
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    this.shiftHeld = event.shiftKey;

    if (this.isDraggingLine || this.isExtendingLeftHandle || this.isExtendingRightHandle) {
      this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
    }

    if (this.isDraggingLine && this.draggedLineId) {
      this.handleLineDrag(event);
      return;
    }
    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineIdHandle) {
      this.handleLineExtension(event);
      return;
    }

    if (this.activeTool === 'select') {
      const container = this.chartContainer?.nativeElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const sp: ScreenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };

      const onHandle = !!this.getHandleAtPoint(sp);
      const hitLine = this.getLineAtPoint(sp);
      const onLine = !!hitLine;
      this.cursorIsOverInteractable = onHandle || onLine;

      if (!this.selectedLineId) {
        const newHoveredId = hitLine?.id ?? null;
        if (newHoveredId !== this.hoveredLineId) {
          this.hoveredLineId = newHoveredId;
          this.drawHandles();
        }
      }
    }
  }

  private handleLineDrag(event: MouseEvent): void {
    const container = this.chartContainer?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const curr = this.screenToChartPoint(sp);
    if (!curr || !this.dragStartPoint || !this.dragLineSnapshot) return;

    const dt = curr.time - this.dragStartPoint.time;
    const dp = curr.price - this.dragStartPoint.price;
    const snap = this.dragLineSnapshot;

    const line = this.selectedLineOwner === 'user'
      ? this.userLines.find(l => l.id === this.draggedLineId)
      : this.adminLines.find(l => l.id === this.draggedLineId);
    if (!line) return;

    switch (line.tool) {
      case 'hline':
        line.startPrice = snap.startPrice + dp;
        line.endPrice = snap.endPrice + dp;
        break;
      case 'vline':
        line.startTime = snap.startTime + dt;
        line.endTime = snap.endTime + dt;
        break;
      default:
        line.startTime = snap.startTime + dt;
        line.endTime = snap.endTime + dt;
        line.startPrice = snap.startPrice + dp;
        line.endPrice = snap.endPrice + dp;
        break;
    }

    this.renderLines();
    this.drawHandles();
  }

  private handleLineExtension(event: MouseEvent): void {
    const container = this.chartContainer?.nativeElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const currentPoint = this.screenToChartPoint(sp);
    if (!currentPoint) return;

    const userIndex = this.userLines.findIndex(l => l.id === this.extendingLineIdHandle);
    const adminIndex = this.adminLines.findIndex(l => l.id === this.extendingLineIdHandle);
    const isUser = userIndex !== -1;
    const isAdmin = adminIndex !== -1;
    if (!isUser && !isAdmin) return;

    const line = { ...(isUser ? this.userLines[userIndex] : this.adminLines[adminIndex]) };
    const dt = line.endTime - line.startTime;
    const dp = line.endPrice - line.startPrice;
    const slope = Math.abs(dt) > 0.0001 ? dp / dt : 0;
    const intercept = line.startPrice - slope * line.startTime;

    if (this.isExtendingLeftHandle) {
      line.startTime = currentPoint.time;
      line.startPrice = slope * currentPoint.time + intercept;
      if (!event.shiftKey) line.startPrice = currentPoint.price;
    } else if (this.isExtendingRightHandle) {
      line.endTime = currentPoint.time;
      if (!event.shiftKey) {
        line.endPrice = currentPoint.price;
      } else {
        line.endPrice = slope * currentPoint.time + intercept;
      }
    }

    if (isUser) this.userLines[userIndex] = line;
    if (isAdmin) this.adminLines[adminIndex] = line;
    this.renderLines();
    this.drawHandles();
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (this.isDraggingLine && this.draggedLineId && this.dragDistance > 3) {
      this.saveDraggedLine();
    }
    
    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineIdHandle) {
      const line = this.userLines.find(l => l.id === this.extendingLineIdHandle);
      if (line && this.originalLineState) {
        if (line.startTime !== this.originalLineState.startTime ||
            line.endTime !== this.originalLineState.endTime) {
          this.drawingService.updateUserLine(this.testId, line.id, line).subscribe({
            next: () => this.showMessage('✓ Line extended successfully!', 'success'),
            error: (err) => {
              console.error('Save failed:', err);
              const index = this.userLines.findIndex(l => l.id === line.id);
              if (index !== -1 && this.originalLineState) {
                this.userLines[index] = this.originalLineState;
                this.renderLines();
                this.drawHandles();
              }
              this.showMessage('Failed to save extension.', 'error');
            }
          });
        }
      }
    }
    
    this.isExtendingLeftHandle = false;
    this.isExtendingRightHandle = false;
    this.extendingLineIdHandle = null;
    this.isDraggingLine = false;
    this.draggedLineId = null;
    this.dragLineSnapshot = null;
    this.dragStartPoint = null;
    this.originalLineState = null;
    this.dragDistance = 0;
    this.drawHandles();
  }

  private saveDraggedLine(): void {
    if (this.selectedLineOwner === 'user') {
      const line = this.userLines.find(l => l.id === this.draggedLineId);
      if (line) {
        this.drawingService.updateUserLine(this.testId, line.id, line).subscribe({
          next: (updated) => {
            if (Array.isArray(updated)) {
              this.userLines = updated;
            } else if (updated) {
              const index = this.userLines.findIndex(l => l.id === line.id);
              if (index !== -1) this.userLines[index] = updated;
            }
            this.renderLines();
            this.drawHandles();
            this.showMessage('✓ Line moved to new position!', 'success');
          },
          error: (err) => console.error('[Drag] Save failed', err),
        });
      }
    } else if (this.selectedLineOwner === 'admin') {
      const line = this.adminLines.find(l => l.id === this.draggedLineId);
      if (line) {
        this.drawingService.updateAdminLine(this.testId, line.id, line).subscribe({
          next: (updated) => {
            if (Array.isArray(updated)) {
              this.adminLines = updated;
            } else if (updated) {
              const index = this.adminLines.findIndex(l => l.id === line.id);
              if (index !== -1) this.adminLines[index] = updated;
            }
            this.renderLines();
            this.drawHandles();
            this.showMessage('✓ Line moved to new position!', 'success');
          },
        });
      }
    }
  }

  // ==================== DUPLICATE ====================
  duplicateSelectedLine(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first. Press Ctrl+D to duplicate', 'info');
      return;
    }

    const original = this.selectedLineOwner === 'user'
      ? this.userLines.find(l => l.id === this.selectedLineId)
      : this.adminLines.find(l => l.id === this.selectedLineId);

    if (!original) return;

    const duplicatedLine: DrawingLine = {
      ...original,
      id: uuidv4(),
      type: 'user',
      color: '#4ECDC4',
      createdAt: new Date(),
    };

    this.drawingService.saveUserLine(this.testId, duplicatedLine).subscribe({
      next: (savedLine) => {
        this.userLines.push(savedLine);
        this.selectedLineId = savedLine.id;
        this.selectedLineOwner = 'user';
        this.activeTool = 'select';
        this.renderLines();
        this.drawHandles();
        this.showMessage('✓ Line duplicated! Click and drag to move it anywhere', 'success');
      },
      error: (err) => {
        console.error('Duplicate failed:', err);
        this.showMessage('Failed to duplicate line.', 'error');
      }
    });
  }

  // ==================== LINE RENDERING ====================
  private removeSeries(id: string): void {
    if (this.lineSeriesMap.has(id)) {
      try { this.chart.removeSeries(this.lineSeriesMap.get(id)); } catch { }
      this.lineSeriesMap.delete(id);
    }
  }

  private renderLine(line: DrawingLine): void {
    if (!this.chart) return;
    try {
      const tr = this.chart.timeScale().getVisibleRange();
      if (!tr) return;
      const from = tr.from as number;
      const to = tr.to as number;

      this.removeSeries(line.id);

      const isSelected = this.selectedLineId === line.id;
      const color = isSelected ? '#FFA500' : (line.color ?? '#4ECDC4');
      const width = isSelected ? 3 : 2;

      if (line.tool === 'vline') {
        this.renderVLine(line, color, width);
        return;
      }

      let data: any[];
      switch (line.tool) {
        case 'hline':
          data = [{ time: from, value: line.startPrice }, { time: to, value: line.startPrice }];
          break;
        case 'ray': {
          const dt = line.endTime - line.startTime;
          const dp = line.endPrice - line.startPrice;
          const m = dt !== 0 ? dp / dt : 0;
          const b = line.startPrice - m * line.startTime;
          data = [{ time: line.startTime, value: line.startPrice }, { time: to, value: m * to + b }];
          break;
        }
        default:
          data = [
            { time: line.startTime, value: line.startPrice },
            { time: line.endTime, value: line.endPrice },
          ];
          break;
      }

      const series = this.chart.addLineSeries({
        color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
      });
      series.setData(data);
      this.lineSeriesMap.set(line.id, series);
    } catch (e) {
      console.error('renderLine error:', e);
    }
  }

  private renderVLine(line: DrawingLine, color: string, width: number): void {
    if (!this.chartData.length) return;
    const allPrices = this.chartData.flatMap((d: any) => [d.low, d.high]);
    const minP = Math.min(...allPrices);
    const maxP = Math.max(...allPrices);
    const pad = (maxP - minP) * 0.05;
    const target = line.startTime;
    const sorted = [...this.chartData].sort((a, b) => Math.abs(a.time - target) - Math.abs(b.time - target));
    if (sorted.length < 2) return;
    const t1 = Math.min(sorted[0].time, sorted[1].time);
    const t2 = Math.max(sorted[0].time, sorted[1].time);
    const series = this.chart.addLineSeries({
      color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
    });
    series.setData([{ time: t1, value: minP - pad }, { time: t2, value: maxP + pad }]);
    this.lineSeriesMap.set(line.id, series);
  }

  private renderLines(): void {
    this.lineSeriesMap.forEach((_, id) => this.removeSeries(id));
    this.lineSeriesMap.clear();
    this.toleranceZoneSeries.forEach(s => {
      try { this.chart?.removeSeries(s); } catch { }
    });
    this.toleranceZoneSeries = [];

    if (this.showTolerance && this.currentCorrectLine) {
      this.renderToleranceZone(this.currentCorrectLine);
    }

    this.userLines.forEach(l => this.renderLine(l));
    if (this.userRole === 'admin') {
      this.adminLines.forEach(l => this.renderLine(l));
    }
  }

  private renderToleranceZone(line: DrawingLine): void {
    const tr = this.chart.timeScale().getVisibleRange();
    if (!tr) return;
    const from = tr.from as number, to = tr.to as number;
    const allP = this.chartData.flatMap((d: any) => [d.low, d.high]);
    const tol = (Math.max(...allP) - Math.min(...allP)) * 0.05;
    const dt = line.endTime - line.startTime;
    const dp = line.endPrice - line.startPrice;
    const m = dt !== 0 ? dp / dt : 0;
    const b = line.startPrice - m * line.startTime;
    const make = (offset: number) => {
      const s = this.chart.addLineSeries({
        color: 'rgba(0,255,0,0.4)', lineWidth: 1, lineStyle: 2,
        priceLineVisible: false, lastValueVisible: false,
      });
      s.setData([{ time: from, value: m * from + b + offset }, { time: to, value: m * to + b + offset }]);
      return s;
    };
    this.toleranceZoneSeries = [make(+tol), make(-tol)];
  }

  // ==================== VALIDATION ====================
  private validateAndSaveUserLine(line: DrawingLine): void {
    const v = this.drawingService.validateUserLine(this.testId, line);

    if (v.isValid) {
      this.userLines.push(line);
      this.drawingService.saveUserLine(this.testId, line).subscribe();
      this.matchedCount = this.drawingService.getMatchedLines(this.testId).size;

      if (v.remainingCount === 0) {
        this.testComplete = true;
        this.showMessage('🎉 All lines matched! Test complete!', 'success');
      } else {
        this.showMessage(`✓ Correct! ${v.remainingCount} line(s) remaining.`, 'success');
      }
      this.renderLines();
    } else {
      this.showMessage('✗ Incorrect — try drawing closer to the correct position.', 'error');
      this.showTolerance = true;
      this.currentCorrectLine = v.correctLine ?? null;
      this.renderLines();

      setTimeout(() => {
        this.showTolerance = false;
        this.currentCorrectLine = null;
        this.toleranceZoneSeries.forEach(s => {
          try { this.chart?.removeSeries(s); } catch { }
        });
        this.toleranceZoneSeries = [];
        this.renderLines();
        this.showMessage('Tolerance zone hidden — try again.', 'info');
      }, 4000);
    }
  }

  // ==================== LINE MANAGEMENT ====================
  deleteSelectedLine(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first.', 'info');
      return;
    }

    const lineId = this.selectedLineId;
    const owner = this.selectedLineOwner;

    this.selectedLineId = null;
    this.selectedLineOwner = null;
    this.clearHandles();

    if (owner === 'user') {
      this.drawingService.deleteUserLine(this.testId, lineId).subscribe({
        next: (updatedLines) => {
          this.userLines = updatedLines;
          this.renderLines();
          this.showMessage('✓ Line deleted!', 'success');
        },
        error: () => this.showMessage('Delete failed.', 'error'),
      });
    } else if (owner === 'admin') {
      this.drawingService.deleteAdminLine(this.testId, lineId).subscribe({
        next: (updatedLines) => {
          this.adminLines = updatedLines;
          this.renderLines();
          this.showMessage('✓ Admin line deleted!', 'success');
        },
      });
    }
  }

  resetAllLines(): void {
    const confirmed = confirm(this.userRole === 'admin' 
      ? '⚠️ Reset all lines? This will clear ALL user and admin lines permanently.'
      : 'Reset ALL your drawn lines? This action cannot be undone.');
    if (!confirmed) return;

    this.showMessage('Clearing all lines...', 'info');
    this.isResetting = true;
    this.destroy$.next();

    this.lineSeriesMap.forEach(series => { 
      try { this.chart.removeSeries(series); } catch { } 
    });
    this.lineSeriesMap.clear();
    
    this.toleranceZoneSeries.forEach(series => { 
      try { this.chart?.removeSeries(series); } catch { } 
    });
    this.toleranceZoneSeries = [];
    
    if (this.previewSeries) { 
      try { this.chart.removeSeries(this.previewSeries); } catch { } 
      this.previewSeries = null; 
    }

    this.userLines = [];
    this.adminLines = [];
    this.selectedLineId = null;
    this.selectedLineOwner = null;
    this.isDrawing = false;
    this.hasFirstPoint = false;
    this.drawingStartPoint = null;
    this.isDraggingLine = false;
    this.draggedLineId = null;
    this.dragStartPoint = null;
    this.showTolerance = false;
    this.currentCorrectLine = null;
    this.isExtendingLeftHandle = false;
    this.isExtendingRightHandle = false;
    this.extendingLineIdHandle = null;
    
    this.clearHandles();
    this.renderLines();

    if (this.userRole === 'admin') {
      this.drawingService.clearAllUserLines(this.testId).subscribe({
        next: () => {
          this.drawingService.clearAdminLines(this.testId).subscribe({
            next: () => {
              this.showMessage('✓ All lines cleared! Chart is now fresh.', 'success');
              this.isResetting = false;
              this.destroy$ = new Subject<void>();
              setTimeout(() => this.refreshLinesFromServer(), 500);
            },
            error: (err) => {
              console.error('Error clearing admin lines:', err);
              this.showMessage('Server error - lines cleared locally.', 'error');
              this.isResetting = false;
              this.destroy$ = new Subject<void>();
            }
          });
        },
        error: (err) => {
          console.error('Error clearing user lines:', err);
          this.showMessage('Server error - lines cleared locally.', 'error');
          this.isResetting = false;
          this.destroy$ = new Subject<void>();
        }
      });
    } else {
      this.drawingService.clearAllUserLines(this.testId).subscribe({
        next: () => {
          this.showMessage('✓ All your lines cleared! Chart is fresh.', 'success');
          this.isResetting = false;
          this.destroy$ = new Subject<void>();
          setTimeout(() => this.refreshLinesFromServer(), 500);
        },
        error: (err) => {
          console.error(err);
          this.showMessage('Server error - lines cleared locally.', 'error');
          this.isResetting = false;
          this.destroy$ = new Subject<void>();
        }
      });
    }
  }

  private refreshLinesFromServer(): void {
    this.drawingService.getUserLines(this.testId).pipe(takeUntil(this.destroy$)).subscribe(lines => {
      if (!this.isResetting) { 
        this.userLines = lines || []; 
        this.renderLines(); 
        this.drawHandles(); 
      }
    });
    if (this.userRole === 'admin') {
      this.drawingService.getAdminLines(this.testId).pipe(takeUntil(this.destroy$)).subscribe(lines => {
        if (!this.isResetting) { 
          this.adminLines = lines || []; 
          this.renderLines(); 
          this.drawHandles(); 
        }
      });
    }
  }

  saveAllLines(): void {
    if (this.userRole !== 'admin') {
      this.showMessage('Only admin can save lines.', 'error');
      return;
    }
    if (this.adminLines.length === 0) {
      this.showMessage('No admin lines to save.', 'info');
      return;
    }
    this.showMessage('Saving answer lines...', 'info');
    this.drawingService.saveAdminLines(this.testId, this.adminLines).subscribe({
      next: (saved) =>
        this.showMessage(`✓ ${saved.length} answer line(s) saved as correct answers!`, 'success'),
      error: () => this.showMessage('Save failed.', 'error'),
    });
  }

  saveAllLinesAsAdmin(): void {
    if (this.userRole !== 'admin') return;
    this.drawingService.saveAdminLines(this.testId, this.adminLines).subscribe(() => {
      this.showMessage('✓ Admin lines saved as correct answers!', 'success');
    });
  }

  // ==================== EXTENSION CONTROLS ====================
  showExtensionControls(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first to extend.', 'info');
      return;
    }
    this.extendingLineId = this.selectedLineId;
    this.showExtendControls = true;
    this.extendLeftValue = 0;
    this.extendRightValue = 0;
  }

  closeExtendControls(): void {
    this.showExtendControls = false;
    this.extendingLineId = null;
    this.extendLeftValue = 0;
    this.extendRightValue = 0;
  }

  extendLineManually(): void {
    if (!this.extendingLineId) return;
    const line = this.userLines.find(l => l.id === this.extendingLineId);
    if (!line) return;

    const dt = line.endTime - line.startTime;
    const dp = line.endPrice - line.startPrice;
    const slope = dt !== 0 ? dp / dt : 0;
    const intercept = line.startPrice - slope * line.startTime;

    const leftExtension = this.extendLeftValue * 86400;
    const rightExtension = this.extendRightValue * 86400;

    const extendedStartTime = line.startTime - leftExtension;
    const extendedEndTime = line.endTime + rightExtension;
    const extendedStartPrice = slope * extendedStartTime + intercept;
    const extendedEndPrice = slope * extendedEndTime + intercept;

    const updatedLine: DrawingLine = { 
      ...line, 
      startTime: extendedStartTime, 
      startPrice: extendedStartPrice, 
      endTime: extendedEndTime, 
      endPrice: extendedEndPrice 
    };

    const index = this.userLines.findIndex(l => l.id === line.id);
    if (index !== -1) { 
      this.userLines[index] = updatedLine; 
      this.renderLines(); 
      this.drawHandles(); 
    }

    this.drawingService.updateUserLine(this.testId, line.id, updatedLine).subscribe({
      next: () => { 
        this.showMessage(`✓ Line extended left by ${this.extendLeftValue} and right by ${this.extendRightValue} days`, 'success'); 
        this.closeExtendControls(); 
      },
      error: (err) => { 
        console.error('Extension failed:', err); 
        this.refreshLinesFromServer(); 
        this.showMessage('Failed to extend line.', 'error'); 
      }
    });
  }

  duplicateAndExtendManually(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first.', 'info');
      return;
    }
    const original = this.selectedLineOwner === 'user' 
      ? this.userLines.find(l => l.id === this.selectedLineId) 
      : this.adminLines.find(l => l.id === this.selectedLineId);
    if (!original) return;

    const duplicatedLine: DrawingLine = { 
      ...original, 
      id: uuidv4(), 
      type: 'user', 
      color: '#4ECDC4', 
      createdAt: new Date() 
    };
    
    this.drawingService.saveUserLine(this.testId, duplicatedLine).subscribe({
      next: (savedLine: any) => {
        const newLine = Array.isArray(savedLine) ? savedLine[0] : savedLine;
        if (newLine) {
          this.userLines.push(newLine);
          this.selectedLineId = newLine.id;
          this.selectedLineOwner = 'user';
          this.renderLines();
          this.drawHandles();
          this.extendingLineId = newLine.id;
          this.showExtendControls = true;
          this.extendLeftValue = 0;
          this.extendRightValue = 0;
          this.showMessage('✓ Line duplicated! Now extend it manually.', 'success');
        }
      },
      error: (err) => { 
        console.error('Duplicate failed:', err); 
        this.showMessage('Failed to duplicate line.', 'error'); 
      }
    });
  }

  // ==================== COORDINATE CONVERSION ====================
  private screenToChartPoint(sp: ScreenPoint): Point | null {
    try {
      const time = this.chart.timeScale().coordinateToTime(sp.x) as number | null;
      const price = this.candlestickSeries.coordinateToPrice(sp.y) as number | null;
      if (time == null || price == null) return null;
      return { x: sp.x, y: sp.y, time, price };
    } catch {
      return null;
    }
  }

  private chartToScreenPoint(time: number, price: number): ScreenPoint | null {
    try {
      const x = this.chart.timeScale().timeToCoordinate(time) as number | null;
      const y = this.candlestickSeries.priceToCoordinate(price) as number | null;
      if (x == null || y == null) return null;
      return { x, y };
    } catch {
      return null;
    }
  }

  // ==================== DATA ====================
  private async loadData(): Promise<void> {
    this.drawingService.getUserLines(this.testId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(lines => {
        if (this.isResetting) return;
        this.userLines = lines || [];
        this.renderLines();
        this.drawHandles();
      });

    if (this.userRole === 'admin') {
      this.drawingService.getAdminLines(this.testId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(lines => {
          if (this.isResetting) return;
          this.adminLines = lines || [];
          this.renderLines();
          this.drawHandles();
        });
    } else {
      this.drawingService.getAdminLines(this.testId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(lines => {
          this.totalAdminLines = (lines || []).length;
          this.matchedCount = this.drawingService.getMatchedLines(this.testId).size;
        });
    }
  }

  private async loadChartData(): Promise<void> {
    this.chartData = this.generateMockData();
    this.filterChartData();
  }

  private generateMockData(): any[] {
    const data: any[] = [];
    let base = 24000;
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    for (let i = 0; i < 90; i++) {
      base = Math.max(22000, Math.min(25000, base + (Math.random() - 0.5) * 100));
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      data.push({ 
        time: Math.floor(d.getTime() / 1000), 
        open: base, 
        high: base + Math.random() * 80, 
        low: base - Math.random() * 80, 
        close: base + (Math.random() - 0.5) * 60 
      });
    }
    return data;
  }

  filterChartData(): void {
    if (!this.candlestickSeries || !this.chartData.length) return;

    this.candlestickSeries.setData(this.chartData);
    this.chart.timeScale().fitContent();

    const from = this.chartData[0].time;
    const to = this.chartData[this.chartData.length - 1].time;
    const pad = Math.round((to - from) * 0.08);
    this.chart.timeScale().setVisibleRange({ from: from - pad, to: to + pad });

    this.renderLines();
    this.drawHandles();
  }

  onDurationChange(): void { 
    this.filterChartData(); 
  }

  backToDashboard(): void {
    this.router.navigate([this.userRole === 'admin' ? '/admin/dashboard' : '/user/dashboard']);
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
    this.validationMessage = msg;
    this.messageType = type;
    setTimeout(() => { this.validationMessage = ''; }, 3000);
  }

  // ==================== KEYBOARD SHORTCUTS ====================
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Delete' && this.activeTool === 'select' && this.selectedLineId) {
      event.preventDefault();
      this.deleteSelectedLine();
    }
    if (event.key === 'Escape') {
      if (this.isDrawing) {
        this.cancelDrawing();
        this.showMessage('Drawing cancelled', 'info');
      }
      if (this.activeTool !== 'select') {
        this.setActiveTool('select');
        this.showMessage('Select tool active', 'info');
      } else if (this.selectedLineId) {
        this.selectedLineId = null;
        this.selectedLineOwner = null;
        this.renderLines();
        this.clearHandles();
        this.showMessage('Selection cleared', 'info');
      }
    }
    if (event.ctrlKey && event.key === 'd' && this.selectedLineId) {
      event.preventDefault();
      this.duplicateSelectedLine();
    }
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      if (this.userRole === 'admin') {
        this.saveAllLines();
      } else {
        this.showMessage('Only admin can save lines', 'info');
      }
    }
    if (event.ctrlKey && event.key === 'r') {
      event.preventDefault();
      this.resetAllLines();
    }
    if (event.ctrlKey && event.key === 'e' && this.activeTool === 'select' && this.selectedLineId) {
      event.preventDefault();
      this.showExtensionControls();
    }
  }
}