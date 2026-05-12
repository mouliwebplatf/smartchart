// chart.component.ts (UPDATED for lightweight-charts v5)
import {
  Component, ElementRef, ViewChild,
  AfterViewInit, OnDestroy, HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { v4 as uuidv4 } from 'uuid';

// ✅ v5: named imports instead of import * as LightweightCharts
import {
  createChart,
  CandlestickSeries,
  LineSeries,
} from 'lightweight-charts';

import { DrawingService } from '../services/drawing.service';
import { AuthService } from '../services/auth.service';
import { DrawingLine, Point, ScreenPoint, ThemeMode } from '../models/drawing.model';
import { Observable, Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { TestService } from '../services/test.service';

type ToolMode = 'trendline' | 'hline' | 'vline' | 'ray' | 'straightline' | 'select';

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss'],
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  // ── Unsubscribe from chart events ──
  private chartClickSubscription: (() => void) | null = null;
  private chartCrosshairSubscription: (() => void) | null = null;

  private isMoveMode: boolean = false;
  private movingLineId: string | null = null;
  private movingLineOwner: 'user' | 'admin' | null = null;
  private movingLineSnapshot: DrawingLine | null = null;
  private movePreviewSeries: any = null;
  private dragLineSnapshot: DrawingLine | null = null;
  private updatingPreview: boolean = false;

  shiftHeld: boolean = false;

  totalAdminLines: number = 0;
  matchedCount: number = 0;
  testComplete: boolean = false;

  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('handleCanvas') handleCanvas!: ElementRef<HTMLCanvasElement>;

  extendLeftValue: number = 0;
  extendRightValue: number = 0;
  showExtendControls: boolean = false;
  extendingLineId: string | null = null;

  public isExtendingLeftHandle: boolean = false;
  public isExtendingRightHandle: boolean = false;
  private extendingLineIdHandle: string | null = null;
  private handleCanvasContext: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;
  private originalLineState: DrawingLine | null = null;
  lastSavedTime: Date | null = null;

  private destroy$ = new Subject<void>();

  testId: number = 0;
  testName: string = '';
  userRole: string | null = null;
  currentTheme: ThemeMode = 'dark';

  durationValue: number = 1;
  durationType: string = 'month';

  activeTool: ToolMode = 'select';
  isDrawing: boolean = false;
  private drawingStartPoint: Point | null = null;

  private previewSeries: any = null;
  private hasFirstPoint: boolean = false;

  userLines: DrawingLine[] = [];
  adminLines: DrawingLine[] = [];
  selectedLineId: string | null = null;
  selectedLineOwner: 'user' | 'admin' | null = null;

  private isDraggingLine: boolean = false;
  private draggedLineId: string | null = null;
  private dragStartPoint: { time: number; price: number } | null = null;
  private dragDistance: number = 0;
  private hoveredLineId: string | null = null;
  cursorIsOverInteractable: boolean = false;

  validationMessage: string = '';
  messageType: 'success' | 'error' | 'info' = 'info';

  private chart: any = null;
  private candlestickSeries: any = null;
  private lineSeriesMap: Map<string, any> = new Map();
  private chartData: any[] = [];

  private themes = {
    light: { background: '#ffffff', textColor: '#333333', gridColor: '#e0e0e0', borderColor: '#d1d1d1' },
    dark:  { background: '#1e222d', textColor: '#d1d4dc', gridColor: '#2a2e39', borderColor: '#2a2e39' },
  };

  private clickTimeout: any = null;
  private isDoubleClick: boolean = false;

  // ── HINT BLINK STATE ──
  private hintBlinkSeries: Map<string, any> = new Map();
  private hintBlinkActive: Set<string> = new Set();
  private hintPrevInRange: Set<string> = new Set();
  private hintBlinkFired: Set<string> = new Set();

  // ── VALIDATION FLASH STATE ──
  private activeFlashInterval: any = null;
  private activeFlashSeries: any   = null;

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private drawingService: DrawingService,
    private testService: TestService,
  ) {}

  // ==================== LIFECYCLE ====================

  ngAfterViewInit(): void {
    this.testId   = Number(this.route.snapshot.paramMap.get('id'));
    this.userRole = this.authService.getRole();
    this.testName = this.route.snapshot.queryParams['name'] || 'NIFTY 50';

    if (isNaN(this.testId) || this.testId <= 0) {
      console.error('[Chart] Invalid testId:', this.testId);
      this.router.navigate(['/user/dashboard']);
      return;
    }

    if (this.userRole !== 'admin') {
      this.drawingService.clearMatchedLines(this.testId);
      this.testComplete = false;
      this.matchedCount = 0;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.initChart().then(() => this.loadData());
      });
    });
  }

  ngOnDestroy(): void {
    this.stopAllHintBlinks();

    this.chartClickSubscription?.();
    this.chartCrosshairSubscription?.();

    if (this.chart) {
      try { this.chart.remove(); } catch (e) {
        console.error('[Chart] Error removing chart:', e);
      }
    }

    this.destroy$.next();
    this.destroy$.complete();
    window.removeEventListener('resize', this.handleResize);

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
    }
    if (this.activeFlashInterval) {
      clearInterval(this.activeFlashInterval);
      this.activeFlashInterval = null;
    }
    if (this.activeFlashSeries) {
      try { this.chart?.removeSeries(this.activeFlashSeries); } catch { }
      this.activeFlashSeries = null;
    }
  }

  // ==================== THEME ====================

  toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
  }

  private applyTheme(): void {
    if (!this.ensureChart()) return;
    const t = this.themes[this.currentTheme];
    this.chart.applyOptions({
      layout:         { background: { color: t.background }, textColor: t.textColor },
      grid:           { vertLines: { color: t.gridColor }, horzLines: { color: t.gridColor } },
      timeScale:      { borderColor: t.borderColor },
      rightPriceScale: { borderColor: t.borderColor },
    });
    this.renderLines();
    this.drawHandles();
  }

  // ==================== GUARDS & HELPERS ====================

  private ensureChart(): boolean {
    if (!this.chart || !this.candlestickSeries) {
      console.warn('[Chart] Chart not initialized');
      return false;
    }
    return true;
  }

  // ==================== INIT CHART ====================

  private handleResize = (): void => {
    if (!this.ensureChart() || !this.chartContainer) return;
    this.chart.applyOptions({ width: this.chartContainer.nativeElement.clientWidth });
    this.updateCanvasSize();
  };

  private async initChart(): Promise<void> {
    const container = this.chartContainer.nativeElement;
    if (container.clientWidth === 0) {
      console.error('[Chart] Chart container zero width');
      return;
    }

    const t = this.themes[this.currentTheme];

    // ✅ v5: use named createChart import
    this.chart = createChart(container, {
      width:  container.clientWidth,
      height: 600,
      layout: {
        background:  { color: t.background },
        textColor:   t.textColor,
        fontFamily:  'Arial',
        fontSize:    12,
      },
      grid: {
        vertLines: { color: t.gridColor, style: 1 },
        horzLines: { color: t.gridColor, style: 1 },
      },
      timeScale: {
        timeVisible:    true,
        secondsVisible: false,
        borderVisible:  true,
        borderColor:    t.borderColor,
        fixLeftEdge:    false,
        fixRightEdge:   false,
        rightOffset:    5,
        tickMarkFormatter: (time: any) => {
          const d     = new Date(time * 1000);
          const month = d.toLocaleString('en-US', { month: 'short' });
          const day   = d.getDate();
          return `${month} ${day}`;
        },
      },
      rightPriceScale: {
        visible:       true,
        autoScale:     true,
        borderVisible: true,
        borderColor:   t.borderColor,
        scaleMargins:  { top: 0.1, bottom: 0.1 },
      },
      leftPriceScale: { visible: false },
      crosshair: {
        mode:     1,
        vertLine: { color: '#758696', width: 1, style: 2, visible: true, labelVisible: true },
        horzLine: { color: '#758696', width: 1, style: 2, visible: true, labelVisible: true },
      },
      handleScroll: { vertTouchDrag: true, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    // ✅ v5: chart.addSeries(CandlestickSeries, { ...options })
    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
      upColor:          '#26a69a',
      downColor:        '#ef5350',
      borderVisible:    false,
      wickUpColor:      '#26a69a',
      wickDownColor:    '#ef5350',
      priceLineVisible:   false,
      lastValueVisible:   true,
    });

    this.chart.priceScale('right').applyOptions({ visible: true, autoScale: true, mode: 0 });
    this.chart.timeScale().applyOptions({ visible: true, timeVisible: true, secondsVisible: false });
    this.chart.timeScale().fitContent();

    this.chartClickSubscription?.();
    this.chartCrosshairSubscription?.();

    this.chartClickSubscription = this.chart.subscribeClick((param: any) => {
      if (!param?.point) return;
      if (this.clickTimeout) {
        clearTimeout(this.clickTimeout);
        this.clickTimeout    = null;
        this.isDoubleClick   = true;
        return;
      }
      this.isDoubleClick = false;
      this.clickTimeout  = setTimeout(() => {
        this.clickTimeout = null;
        if (this.isDoubleClick) {
          this.isDoubleClick = false;
          return;
        }
        if (this.activeTool === 'select') {
          if (this.dragDistance <= 5) this.handleSelectClick(param);
          this.dragDistance = 0;
        } else {
          this.handleChartClick(param);
        }
      }, 200);
    });

    this.chartCrosshairSubscription = this.chart.subscribeCrosshairMove((param: any) => {
      if (!param?.point) return;
      if (this.isDrawing && this.hasFirstPoint && this.previewSeries) {
        this.updatePreviewLine(param);
      }
    });

    this.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      if (!this.ensureChart()) return;
      this.chart.priceScale('right').applyOptions({ visible: true });
      this.chart.timeScale().applyOptions({ visible: true });
    });

    window.addEventListener('resize', this.handleResize);
    await this.loadChartData();
    setTimeout(() => this.setupHandleCanvas(), 100);
  }

  // ==================== HANDLE CANVAS ====================

  private setupHandleCanvas(): void {
    const canvas    = this.handleCanvas?.nativeElement;
    const container = this.chartContainer?.nativeElement;
    if (!canvas || !container) return;
    const dpr        = window.devicePixelRatio || 1;
    canvas.width     = container.clientWidth  * dpr;
    canvas.height    = container.clientHeight * dpr;
    canvas.style.width    = container.clientWidth  + 'px';
    canvas.style.height   = container.clientHeight + 'px';
    canvas.style.position = 'absolute';
    canvas.style.top      = '0';
    canvas.style.left     = '0';
    canvas.style.pointerEvents = 'none';
    this.handleCanvasContext = canvas.getContext('2d');
    this.handleCanvasContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.startHandleRendering();
  }

  private startHandleRendering(): void {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
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
    const line = this.userLines.find(l => l.id === this.selectedLineId)
      ?? this.adminLines.find(l => l.id === this.selectedLineId);
    if (!line) { this.clearHandles(); return; }
    const sp = this.chartToScreenPoint(line.startTime, line.startPrice);
    const ep = this.chartToScreenPoint(line.endTime,   line.endPrice);
    if (!sp || !ep) { this.clearHandles(); return; }
    this.clearHandles();
    this.drawHandle(sp.x, sp.y, 'left');
    this.drawHandle(ep.x, ep.y, 'right');
  }

  private drawHandle(x: number, y: number, type: string): void {
    if (!this.handleCanvasContext) return;
    const ctx      = this.handleCanvasContext;
    const isActive = (this.isExtendingLeftHandle && type === 'left') ||
                     (this.isExtendingRightHandle && type === 'right');
    const radius   = isActive ? 8 : 6;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? 'rgba(255,165,0,0.3)' : 'rgba(255,165,0,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = isActive ? '#FFA500' : '#FF8C00';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private clearHandles(): void {
    if (!this.handleCanvasContext || !this.handleCanvas?.nativeElement) return;
    const c = this.handleCanvas.nativeElement;
    this.handleCanvasContext.clearRect(0, 0, c.width, c.height);
  }

  private updateCanvasSize(): void {
    const canvas    = this.handleCanvas?.nativeElement;
    const container = this.chartContainer?.nativeElement;
    if (!canvas || !container) return;
    const dpr     = window.devicePixelRatio || 1;
    canvas.width  = container.clientWidth  * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width  = container.clientWidth  + 'px';
    canvas.style.height = container.clientHeight + 'px';
    this.handleCanvasContext?.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawHandles();
  }

  private getHandleAtPoint(sp: ScreenPoint): { type: 'left' | 'right'; lineId: string } | null {
    if (!this.selectedLineId) return null;
    const line = this.userLines.find(l => l.id === this.selectedLineId)
      ?? this.adminLines.find(l => l.id === this.selectedLineId);
    if (!line) return null;
    const s = this.chartToScreenPoint(line.startTime, line.startPrice);
    const e = this.chartToScreenPoint(line.endTime,   line.endPrice);
    if (!s || !e) return null;
    if (Math.hypot(sp.x - s.x, sp.y - s.y) < 15) return { type: 'left',  lineId: line.id };
    if (Math.hypot(sp.x - e.x, sp.y - e.y) < 15) return { type: 'right', lineId: line.id };
    return null;
  }

  // ==================== TOOL SELECTION ====================

  setActiveTool(tool: ToolMode): void {
    this.cancelDrawing();
    this.activeTool = tool;
    if (tool !== 'select') {
      this.selectedLineId    = null;
      this.selectedLineOwner = null;
      this.clearHandles();
    }
    this.showMessage(`Tool: ${tool}`, 'info');
    this.renderLines();
  }

  // ==================== DRAWING ====================

  private cancelDrawing(): void {
    this.isDrawing        = false;
    this.hasFirstPoint    = false;
    this.drawingStartPoint = null;
    this.stopAllHintBlinks();
    if (this.previewSeries) {
      try { this.chart.removeSeries(this.previewSeries); } catch { }
      this.previewSeries = null;
    }
  }

  private handleChartClick(param: any): void {
    if (this.testComplete && this.userRole !== 'admin') {
      this.showMessage('✅ Test already complete — no more drawing allowed.', 'info');
      return;
    }

    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    const cp = this.screenToChartPoint(sp);
    if (!cp) return;

    if (this.activeTool === 'straightline') {
      this.finishDrawing(cp);
      return;
    }

    if (!this.isDrawing) {
      this.isDrawing         = true;
      this.drawingStartPoint = cp;

      let previewColor     = '#4ECDC4';
      let previewLineStyle = 0;

      if (this.activeTool === 'hline') {
        previewColor     = '#FFFFFF';
        previewLineStyle = 1;
      }

      // ✅ v5: chart.addSeries(LineSeries, { ...options })
      this.previewSeries = this.chart.addSeries(LineSeries, {
        color:             previewColor,
        lineWidth:         2,
        lineStyle:         previewLineStyle,
        priceLineVisible:  false,
        lastValueVisible:  false,
      });
      this.hasFirstPoint = true;
    } else {
      let endPoint = cp;
      if (this.shiftHeld) endPoint = this.snapToAngle(this.drawingStartPoint!, cp);
      this.finishDrawing(endPoint);
      this.cancelDrawing();
    }
  }

  private finishDrawing(endPoint: Point): void {
    if (this.testComplete && this.userRole !== 'admin') return;

    this.stopAllHintBlinks();

    let start: Point, end: Point;

    if (this.activeTool === 'straightline') {
      const tr = this.chart.timeScale().getVisibleRange();
      if (!tr) return;
      start = { x: 0, y: 0, time: tr.from as number, price: endPoint.price };
      end   = { x: 0, y: 0, time: tr.to   as number, price: endPoint.price };
    } else {
      if (!this.drawingStartPoint) return;
      start = { ...this.drawingStartPoint };
      end   = { ...endPoint };
      if (this.activeTool === 'hline') end.price = start.price;
      if (this.activeTool !== 'ray' && this.activeTool !== 'vline' && start.time > end.time) {
        [start, end] = [end, start];
      }
    }

    const newLine: DrawingLine = {
      id:           uuidv4(),
      testId:       this.testId,
      type:         this.userRole === 'admin' ? 'admin' : 'user',
      tool:         this.activeTool === 'straightline' ? 'straightline' : this.activeTool as any,
      originalTool: this.activeTool,
      startX:       start.x,   startY: start.y,
      endX:         end.x,     endY:   end.y,
      startTime:    start.time, startPrice: start.price,
      endTime:      end.time,   endPrice:   end.price,
      color:        this.userRole === 'admin' ? '#FF6B6B' : '#FFFFFF',
      createdAt:    new Date(),
    };

    if (this.activeTool === 'straightline') {
      this.userLines.push(newLine);
      this.renderLines();
      this.showMessage('✓ Straight line drawn (temporary - not saved)', 'info');
      return;
    }

    if (this.userRole === 'admin') {
      this.adminLines.push(newLine);
      this.drawingService.addAdminLine(this.testId, newLine)
        .pipe(takeUntil(this.destroy$))
        .subscribe();
      this.renderLines();
      this.showMessage('✓ Admin line drawn. Click Save to persist.', 'success');
    } else {
      this.validateAndSaveUserLine(newLine);
    }
  }

  private updatePreviewLine(param: any): void {
    if (this.updatingPreview || !this.isDrawing || !this.previewSeries) return;
    this.updatingPreview = true;
    try {
      const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
      let cp = this.screenToChartPoint(sp);
      if (!cp) return;

      if (this.activeTool === 'straightline') {
        const tr = this.chart.timeScale().getVisibleRange();
        if (tr) {
          const from = tr.from as number;
          const to   = tr.to   as number;
          this.previewSeries.applyOptions({ color: '#FFFFFF', lineWidth: 2, lineStyle: 1 });
          this.previewSeries.setData([
            { time: from, value: cp.price },
            { time: to,   value: cp.price },
          ]);
        }
        return;
      }

      let end = { ...cp };
      if (this.shiftHeld) end = this.snapToAngle(this.drawingStartPoint!, end);
      if (this.activeTool === 'hline') end.price = this.drawingStartPoint!.price;
      if (this.activeTool === 'vline') end.time  = this.drawingStartPoint!.time;

      if (this.activeTool === 'trendline') {
        this.previewSeries.applyOptions({ color: '#4ECDC4', lineWidth: 2, lineStyle: 0 });
      } else if (this.activeTool === 'hline') {
        this.previewSeries.applyOptions({ color: '#FFFFFF', lineWidth: 2, lineStyle: 1 });
      }

      if (this.activeTool === 'hline' || this.activeTool === 'ray') {
        const pts = this.getExtendedPoints(this.drawingStartPoint!, end);
        if (pts.length >= 2 && pts[0].time !== pts[1].time) {
          this.previewSeries.setData(pts);
        }
      } else {
        const t1 = this.drawingStartPoint!.time, t2 = end.time;
        if (t1 === t2) return;
        const ordered = t1 < t2
          ? [{ time: t1, value: this.drawingStartPoint!.price }, { time: t2, value: end.price }]
          : [{ time: t2, value: end.price }, { time: t1, value: this.drawingStartPoint!.price }];
        this.previewSeries.setData(ordered);
      }

      if (this.userRole !== 'admin' && this.drawingStartPoint) {
        this.updateHintBlinks(this.drawingStartPoint.time, cp.time);
      }

    } catch (err) {
      console.warn('[Chart] Preview update error', err);
    } finally {
      this.updatingPreview = false;
    }
  }

  private snapToAngle(start: Point, end: Point): Point {
    const ss = this.chartToScreenPoint(start.time, start.price);
    const es = this.chartToScreenPoint(end.time,   end.price);
    if (!ss || !es) return end;
    const dx = es.x - ss.x, dy = es.y - ss.y;
    const nx = Math.abs(dx) >= Math.abs(dy) ? es.x : ss.x;
    const ny = Math.abs(dx) >= Math.abs(dy) ? ss.y : es.y;
    return this.screenToChartPoint({ x: nx, y: ny }) ?? end;
  }

  private getExtendedPoints(start: Point, end: Point): any[] {
    const tr = this.chart.timeScale().getVisibleRange();
    if (!tr) return [];
    const dt = end.time  - start.time;
    const dp = end.price - start.price;
    if (dt === 0) return [{ time: start.time, value: start.price }];
    const m = dp / dt;
    const b = start.price - m * start.time;
    return [
      { time: tr.from as number, value: m * (tr.from as number) + b },
      { time: tr.to   as number, value: m * (tr.to   as number) + b },
    ];
  }

  // ==================== SELECT & HIT TEST ====================

  private handleSelectClick(param: any): void {
    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    const handle = this.getHandleAtPoint(sp);
    if (handle) return;
    if (this.isDraggingLine) return;
    const hit = this.getLineAtPoint(sp);
    if (hit) {
      this.selectedLineId    = hit.id;
      this.selectedLineOwner = hit.owner;
      this.renderLines();
      this.showMessage(`Line selected: ${hit.id.substring(0, 8)}…`, 'success');
    } else {
      this.selectedLineId    = null;
      this.selectedLineOwner = null;
      this.renderLines();
      this.clearHandles();
      this.showMessage('Selection cleared', 'info');
    }
  }

  private getLineAtPoint(sp: ScreenPoint): { id: string; owner: 'user' | 'admin' } | null {
    for (const line of this.userLines) {
      const a = this.chartToScreenPoint(line.startTime, line.startPrice);
      const b = this.chartToScreenPoint(line.endTime,   line.endPrice);
      if (a && b && this.distanceToSegment(sp, a, b) < 10) return { id: line.id, owner: 'user' };
    }
    if (this.userRole === 'admin') {
      for (const line of this.adminLines) {
        const a = this.chartToScreenPoint(line.startTime, line.startPrice);
        const b = this.chartToScreenPoint(line.endTime,   line.endPrice);
        if (a && b && this.distanceToSegment(sp, a, b) < 10) return { id: line.id, owner: 'admin' };
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

  // ==================== DUPLICATE ====================

  duplicateSelectedLine(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first', 'info');
      return;
    }

    const original = this.selectedLineOwner === 'user'
      ? this.userLines.find(l => l.id === this.selectedLineId)
      : this.adminLines.find(l => l.id === this.selectedLineId);
    if (!original) return;

    if (original.tool === 'straightline') {
      this.showMessage('Cannot duplicate temporary straight lines', 'info');
      return;
    }

    let smallPriceOffset = 5;
    if (this.chartData.length) {
      const prices     = this.chartData.flatMap((d: any) => [d.high, d.low]);
      smallPriceOffset = (Math.max(...prices) - Math.min(...prices)) * 0.01;
    }

    const duplicatedLine: DrawingLine = {
      ...original,
      id:           uuidv4(),
      type:         'user',
      color:        '#00FF00',
      startTime:    original.startTime,
      endTime:      original.endTime,
      startPrice:   original.startPrice - smallPriceOffset,
      endPrice:     original.endPrice   - smallPriceOffset,
      createdAt:    new Date(),
      tool:         original.tool,
      originalTool: original.originalTool || original.tool,
    };

    if (this.userRole !== 'admin') {
      const v = this.drawingService.validateUserLine(this.testId, duplicatedLine);

      if (!v.isValid) {
        this.showMessage('✗ Duplicated line does not match any admin trend line.', 'error');
        const hintLine = v.correctLine
          ?? this.drawingService.findAdminLineContainingTimeRange(this.testId, duplicatedLine);
        if (hintLine) this.flashAdminLine(hintLine, 'hint');
        return;
      }

      const matchedAdminLine = v.correctLine!;
      duplicatedLine.startTime  = matchedAdminLine.startTime;
      duplicatedLine.startPrice = matchedAdminLine.startPrice;
      duplicatedLine.endTime    = matchedAdminLine.endTime;
      duplicatedLine.endPrice   = matchedAdminLine.endPrice;

      this.userLines.push(duplicatedLine);
      this.selectedLineId    = duplicatedLine.id;
      this.selectedLineOwner = 'user';
      this.renderLines();

      this.drawingService.saveUserLine(this.testId, duplicatedLine)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            this.matchedCount = this.drawingService.getMatchedLines(this.testId).size;
            if (v.remainingCount === 0) {
              this.testComplete = true;
              this.showMessage('🎉 All lines matched! Test complete!', 'success');
            } else {
              this.showMessage(
                `✓ Trend line duplicated and matched! ${v.remainingCount} line(s) remaining.`,
                'success'
              );
            }
            this.flashAdminLine(matchedAdminLine, 'success');
          },
          error: (err) => {
            console.error('[Chart] Save failed:', err);
            const index = this.userLines.findIndex(l => l.id === duplicatedLine.id);
            if (index !== -1) this.userLines.splice(index, 1);
            this.renderLines();
            this.showMessage('Failed to save duplicated line.', 'error');
          },
        });

    } else {
      this.adminLines.push(duplicatedLine);
      this.selectedLineId    = duplicatedLine.id;
      this.selectedLineOwner = 'admin';
      this.renderLines();
      this.showMessage('Admin line duplicated. Click Save to persist.', 'success');
    }
  }

  duplicateAndExtendManually(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first', 'info');
      return;
    }

    const original = this.selectedLineOwner === 'user'
      ? this.userLines.find(l => l.id === this.selectedLineId)
      : this.adminLines.find(l => l.id === this.selectedLineId);

    if (original?.tool === 'straightline') {
      this.showMessage('Cannot duplicate temporary straight lines', 'info');
      return;
    }

    this.duplicateSelectedLine();
    setTimeout(() => {
      if (this.selectedLineId) this.showExtensionControls();
    }, 300);
  }

  // ==================== DRAG & EXTEND HANDLERS ====================

  @HostListener('document:mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    this.dragDistance = 0;
    if (this.activeTool !== 'select') return;

    const container = this.chartContainer?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (
      event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top  || event.clientY > rect.bottom
    ) return;

    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const handle = this.getHandleAtPoint(sp);
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      this.chart.applyOptions({
        handleScroll: { vertTouchDrag: false, horzTouchDrag: false, mouseWheel: false, pressedMouseMove: false },
        handleScale:  { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
      });
      this.extendingLineIdHandle = handle.lineId;
      const selected = this.userLines.find(l => l.id === handle.lineId)
        ?? this.adminLines.find(l => l.id === handle.lineId);
      if (selected) this.originalLineState = structuredClone(selected);
      if (handle.type === 'left') { this.isExtendingLeftHandle  = true; }
      else                        { this.isExtendingRightHandle = true; }
      return;
    }

    const hit = this.getLineAtPoint(sp);
    if (!hit) return;

    event.preventDefault();
    event.stopPropagation();

    this.selectedLineId    = hit.id;
    this.selectedLineOwner = hit.owner;
    this.draggedLineId     = hit.id;

    this.chart.applyOptions({
      handleScroll: { vertTouchDrag: false, horzTouchDrag: false, mouseWheel: false, pressedMouseMove: false },
      handleScale:  { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
    });

    this.isDraggingLine = true;

    const selectedLine = hit.owner === 'user'
      ? this.userLines.find(l => l.id === hit.id)
      : this.adminLines.find(l => l.id === hit.id);
    if (!selectedLine) return;

    this.dragLineSnapshot = structuredClone(selectedLine);
    const chartPoint = this.screenToChartPoint(sp);
    if (chartPoint) this.dragStartPoint = { time: chartPoint.time, price: chartPoint.price };

    this.renderLines();
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    this.shiftHeld = event.shiftKey;

    if (this.isDraggingLine && this.draggedLineId) {
      this.dragDistance += Math.abs(event.movementX) + Math.abs(event.movementY);
      this.handleLineDrag(event);
      return;
    }

    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineIdHandle) {
      this.handleLineExtension(event);
      return;
    }
  }

  private handleLineDrag(event: MouseEvent): void {
    const container = this.chartContainer?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const curr = this.screenToChartPoint(sp);
    if (!curr || !this.dragStartPoint || !this.dragLineSnapshot) return;

    const dt   = curr.time  - this.dragStartPoint.time;
    const dp   = curr.price - this.dragStartPoint.price;
    const snap = this.dragLineSnapshot;

    const line = this.selectedLineOwner === 'user'
      ? this.userLines.find(l => l.id === this.draggedLineId)
      : this.adminLines.find(l => l.id === this.draggedLineId);
    if (!line) return;

    line.startTime  = Math.round(snap.startTime  + dt);
    line.endTime    = Math.round(snap.endTime    + dt);
    line.startPrice = snap.startPrice + dp;
    line.endPrice   = snap.endPrice   + dp;

    this.renderSingleLine(line);
  }

  private handleLineExtension(event: MouseEvent): void {
    const container = this.chartContainer?.nativeElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const cp = this.screenToChartPoint(sp);
    if (!cp) return;

    const line = this.userLines.find(l => l.id === this.extendingLineIdHandle)
      ?? this.adminLines.find(l => l.id === this.extendingLineIdHandle);
    if (!line) return;

    if (this.isExtendingLeftHandle) {
      line.startTime  = cp.time;
      line.startPrice = cp.price;
    } else if (this.isExtendingRightHandle) {
      line.endTime  = cp.time;
      line.endPrice = cp.price;
    }

    this.renderSingleLine(line);
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (!this.ensureChart()) return;

    this.chart.applyOptions({
      handleScroll: { vertTouchDrag: true, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale:  { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    if (this.isDraggingLine && this.draggedLineId) this.saveDraggedLine();

    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineIdHandle) {
      this.saveExtendedLine();
    }

    this.isExtendingLeftHandle  = false;
    this.isExtendingRightHandle = false;
    this.extendingLineIdHandle  = null;
    this.isDraggingLine   = false;
    this.draggedLineId    = null;
    this.dragLineSnapshot = null;
    this.dragStartPoint   = null;
    this.dragDistance     = 0;
    this.renderLines();
  }

  private saveDraggedLine(): void {
    if (this.selectedLineOwner === 'user') {
      const line = this.userLines.find(l => l.id === this.draggedLineId);
      if (line) {
        this.drawingService.updateUserLine(this.testId, line.id, line)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => this.showMessage('Line position saved', 'success'),
            error: (e) => console.error('[Chart] Save failed', e),
          });
      }
    } else if (this.selectedLineOwner === 'admin') {
      const line = this.adminLines.find(l => l.id === this.draggedLineId);
      if (line) {
        this.drawingService.updateAdminLine(this.testId, line.id, line)
          .pipe(takeUntil(this.destroy$))
          .subscribe();
      }
    }
  }

  private saveExtendedLine(): void {
    if (this.selectedLineOwner === 'user') {
      const line = this.userLines.find(l => l.id === this.extendingLineIdHandle);
      if (line) {
        this.drawingService.updateUserLine(this.testId, line.id, line)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: () => this.showMessage('Line extended successfully', 'success'),
            error: (e) => console.error('[Chart] Save failed', e),
          });
      }
    }
  }

  // ==================== LINE RENDERING ====================

  private removeSeries(id: string): void {
    if (this.lineSeriesMap.has(id)) {
      try { this.chart.removeSeries(this.lineSeriesMap.get(id)); } catch { }
      this.lineSeriesMap.delete(id);
    }
  }

  private renderLine(line: DrawingLine): void {
    if (!this.ensureChart()) return;
    try {
      const tr = this.chart.timeScale().getVisibleRange();
      if (!tr) return;
      const from = tr.from as number;
      const to   = tr.to   as number;

      this.removeSeries(line.id);

      const isSelected = this.selectedLineId === line.id;
      let color:     string;
      let width     = isSelected ? 3 : 2;
      let lineStyle = 0;

      if (line.tool === 'straightline') {
        color     = isSelected ? '#FFA500' : '#FFFFFF';
        lineStyle = 1;
        const data = [
          { time: from, value: line.startPrice },
          { time: to,   value: line.startPrice },
        ];
        // ✅ v5: addSeries(LineSeries, { ...options })
        const series = this.chart.addSeries(LineSeries, {
          color, lineWidth: width,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false, lineStyle,
        });
        series.setData(data);
        this.lineSeriesMap.set(line.id, series);
        return;
      }

      if (line.tool === 'trendline') {
        color     = isSelected ? '#FFA500' : (line.color ?? (line.type === 'admin' ? '#FF6B6B' : '#4ECDC4'));
        lineStyle = 0;
      } else {
        color = isSelected ? '#FFA500' : (line.color ?? (line.type === 'admin' ? '#FF6B6B' : '#4ECDC4'));
      }

      if (line.tool === 'vline') {
        this.renderVLine(line, color, width);
        return;
      }

      let data: any[];
      switch (line.tool) {
        case 'hline':
          data = [
            { time: line.startTime, value: line.startPrice },
            { time: line.endTime,   value: line.endPrice   },
          ];
          break;
        case 'ray': {
          const dt = line.endTime  - line.startTime;
          const dp = line.endPrice - line.startPrice;
          const m  = dt !== 0 ? dp / dt : 0;
          const b  = line.startPrice - m * line.startTime;
          data = [
            { time: line.startTime, value: line.startPrice },
            { time: to,             value: m * to + b      },
          ];
          break;
        }
        default:
          data = [
            { time: line.startTime, value: line.startPrice },
            { time: line.endTime,   value: line.endPrice   },
          ];
          break;
      }

      // ✅ v5: addSeries(LineSeries, { ...options })
      const series = this.chart.addSeries(LineSeries, {
        color, lineWidth: width,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, lineStyle,
      });
      series.setData(data);
      this.lineSeriesMap.set(line.id, series);
    } catch (e) {
      console.error('[Chart] renderLine error:', e, line);
    }
  }

  private renderVLine(line: DrawingLine, color: string, width: number): void {
    if (!this.chartData.length) return;
    const allPrices = this.chartData.flatMap((d: any) => [d.low, d.high]);
    const minP = Math.min(...allPrices);
    const maxP = Math.max(...allPrices);
    const pad  = (maxP - minP) * 0.05;
    const target = line.startTime;
    const sorted = [...this.chartData].sort(
      (a, b) => Math.abs(a.time - target) - Math.abs(b.time - target)
    );
    if (sorted.length < 2) return;
    const t1 = Math.min(sorted[0].time, sorted[1].time);
    const t2 = Math.max(sorted[0].time, sorted[1].time);
    // ✅ v5: addSeries(LineSeries, { ...options })
    const series = this.chart.addSeries(LineSeries, {
      color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
    });
    series.setData([{ time: t1, value: minP - pad }, { time: t2, value: maxP + pad }]);
    this.lineSeriesMap.set(line.id, series);
  }

  private renderSingleLine(line: DrawingLine): void {
    if (!this.ensureChart()) return;
    try {
      const isSelected = this.selectedLineId === line.id;
      let color:     string;
      let width     = isSelected ? 3 : 2;
      let lineStyle = 0;

      if (line.tool === 'straightline') {
        color     = isSelected ? '#FFA500' : '#FFFFFF';
        lineStyle = 1;
      } else if (line.tool === 'trendline') {
        color     = isSelected ? '#FFA500' : (line.color ?? (line.type === 'admin' ? '#FF6B6B' : '#4ECDC4'));
        lineStyle = 0;
      } else {
        color = isSelected ? '#FFA500' : (line.color ?? '#FFD700');
      }

      const data = [
        { time: line.startTime, value: line.startPrice },
        { time: line.endTime,   value: line.endPrice   },
      ];
      const existing = this.lineSeriesMap.get(line.id);
      if (existing) {
        existing.applyOptions({ color, lineWidth: width, lineStyle });
        existing.setData(data);
        return;
      }
      // ✅ v5: addSeries(LineSeries, { ...options })
      const series = this.chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle,
        priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, priceScaleId: 'right',
      });
      series.setData(data);
      this.lineSeriesMap.set(line.id, series);
    } catch (err) {
      console.error('[Chart] renderSingleLine error', err);
    }
  }

  private renderLines(): void {
    if (!this.ensureChart()) return;
    this.lineSeriesMap.forEach((series) => {
      try { this.chart.removeSeries(series); } catch { }
    });
    this.lineSeriesMap.clear();
    this.userLines.forEach(l => this.renderLine(l));
    if (this.userRole === 'admin') {
      this.adminLines.forEach(l => this.renderLine(l));
    }
    this.chart.priceScale('right').applyOptions({ visible: true, autoScale: true });
    this.chart.timeScale().applyOptions({ visible: true });
  }

  // ==================== HINT BLINK SYSTEM ====================

  private updateHintBlinks(previewStartTime: number, previewEndTime: number): void {
    if (!this.ensureChart()) return;

    const inRangeLines = this.drawingService.getUnmatchedAdminLinesInTimeRange(
      this.testId, previewStartTime, previewEndTime
    );
    const nowInRangeIds = new Set(inRangeLines.map(l => l.id));

    for (const id of this.hintPrevInRange) {
      if (!nowInRangeIds.has(id)) {
        this.hintBlinkFired.delete(id);
      }
    }

    for (const al of inRangeLines) {
      if (this.hintBlinkFired.has(al.id))  continue;
      if (this.hintBlinkActive.has(al.id)) continue;
      this.triggerHintBlink(al);
    }

    this.hintPrevInRange = nowInRangeIds;
  }

  private triggerHintBlink(adminLine: DrawingLine): void {
    if (!this.ensureChart()) return;

    this.hintBlinkActive.add(adminLine.id);
    this.hintBlinkFired.add(adminLine.id);

    const stale = this.hintBlinkSeries.get(adminLine.id);
    if (stale) {
      try { this.chart.removeSeries(stale); } catch { }
      this.hintBlinkSeries.delete(adminLine.id);
    }

    // ✅ v5: addSeries(LineSeries, { ...options })
    const series = this.chart.addSeries(LineSeries, {
      color:                  '#FFD700',
      lineWidth:              3,
      lineStyle:              0,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    });
    series.setData([
      { time: adminLine.startTime, value: adminLine.startPrice },
      { time: adminLine.endTime,   value: adminLine.endPrice   },
    ]);
    this.hintBlinkSeries.set(adminLine.id, series);

    const BLINK_MS   = 300;
    const BLINKS     = 3;
    const totalTicks = BLINKS * 2;
    let tick = 0;

    const interval = setInterval(() => {
      tick++;
      try {
        if (tick >= totalTicks) {
          clearInterval(interval);
          try { this.chart.removeSeries(series); } catch { }
          this.hintBlinkSeries.delete(adminLine.id);
          this.hintBlinkActive.delete(adminLine.id);
        } else {
          series.applyOptions({
            color: tick % 2 === 0 ? '#FFD700' : 'rgba(0,0,0,0)',
          });
        }
      } catch {
        clearInterval(interval);
        this.hintBlinkSeries.delete(adminLine.id);
        this.hintBlinkActive.delete(adminLine.id);
      }
    }, BLINK_MS);
  }

  private stopAllHintBlinks(): void {
    for (const series of this.hintBlinkSeries.values()) {
      try { this.chart.removeSeries(series); } catch { }
    }
    this.hintBlinkSeries.clear();
    this.hintBlinkActive.clear();
    this.hintBlinkFired.clear();
    this.hintPrevInRange.clear();
  }

  // ==================== VALIDATION ====================

  private validateAndSaveUserLine(line: DrawingLine): void {
    if (line.tool === 'straightline') {
      console.warn('[Chart] Straight lines are not saved to database');
      return;
    }

    const existingIdx = this.userLines.findIndex(l => l.id === line.id);
    if (existingIdx !== -1) this.userLines.splice(existingIdx, 1);
    this.renderLines();

    const v = this.drawingService.validateUserLine(this.testId, line);

    if (!v.isValid) {
      this.renderLines();

      const hintLine = v.correctLine
        ?? this.drawingService.findAdminLineContainingTimeRange(this.testId, line);

      if (hintLine) {
        this.flashAdminLineInRange(hintLine, line, 'hint');
        this.showMessage('✗ Close! But slope/price is incorrect. See the orange blinking line.', 'error');
      } else {
        this.showMessage('✗ No trend line in this range. Try a different area.', 'error');
      }
      return;
    }

    this.userLines.push({ ...line });
    this.renderLines();

    const matchedAdminLine = v.correctLine;
    if (matchedAdminLine) {
      this.flashAdminLineInRange(matchedAdminLine, line, 'success');
    }

    this.drawingService.saveUserLine(this.testId, line)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.matchedCount = this.drawingService.getMatchedLines(this.testId).size;
          if (v.remainingCount === 0) {
            this.testComplete = true;
            this.showMessage('🎉 All lines matched! Test complete!', 'success');
          } else {
            this.showMessage(`✓ Correct! ${v.remainingCount} line(s) remaining.`, 'success');
          }
        },
        error: (err) => {
          console.error('[Validation] Save failed:', err);
          const idx = this.userLines.findIndex(l => l.id === line.id);
          if (idx !== -1) this.userLines.splice(idx, 1);
          this.renderLines();
          this.showMessage('Failed to save line.', 'error');
        },
      });
  }

  private flashAdminLineInRange(
    adminLine: DrawingLine,
    userLine: DrawingLine,
    mode: 'hint' | 'success'
  ): void {
    if (!this.ensureChart()) return;

    const clipStart  = userLine.startTime;
    const clipEnd    = userLine.endTime;
    const rangeStart = Math.min(clipStart, clipEnd);
    const rangeEnd   = Math.max(clipStart, clipEnd);

    const adminRangeStart = Math.min(adminLine.startTime, adminLine.endTime);
    const adminRangeEnd   = Math.max(adminLine.startTime, adminLine.endTime);

    if (rangeEnd < adminRangeStart || rangeStart > adminRangeEnd) return;

    const adminDt        = adminLine.endTime - adminLine.startTime;
    const adminSlope     = adminDt !== 0 ? (adminLine.endPrice - adminLine.startPrice) / adminDt : 0;
    const adminIntercept = adminLine.startPrice - adminSlope * adminLine.startTime;

    const clippedLine: DrawingLine = {
      ...adminLine,
      startTime:  rangeStart,
      endTime:    rangeEnd,
      startPrice: adminSlope * rangeStart + adminIntercept,
      endPrice:   adminSlope * rangeEnd   + adminIntercept,
    };

    this.flashAdminLine(clippedLine, mode);
  }

  private showAdminLineHintInRange(userLine: DrawingLine): void {
    if (!this.ensureChart()) return;
    const adminLine = this.drawingService.findAdminLineContainingTimeRange(this.testId, userLine);
    if (adminLine) {
      this.flashAdminLine(adminLine, 'hint');
      console.log('[Chart] Admin line found in range:', adminLine.id.substring(0, 8));
    }
  }

  // ==================== FLASH FEEDBACK ====================

  private flashAdminLine(adminLine: DrawingLine, mode: 'hint' | 'success' = 'success'): void {
    if (!this.ensureChart()) return;

    if (this.activeFlashInterval) {
      clearInterval(this.activeFlashInterval);
      this.activeFlashInterval = null;
    }
    if (this.activeFlashSeries) {
      try { this.chart.removeSeries(this.activeFlashSeries); } catch { }
      this.activeFlashSeries = null;
    }

    const colorOn  = mode === 'success' ? '#00FF00' : '#FF8C00';
    const colorOff = 'rgba(0,0,0,0)';
    const BLINK_MS = 300;
    const BLINKS   = 3;

    // ✅ v5: addSeries(LineSeries, { ...options })
    const flashSeries = this.chart.addSeries(LineSeries, {
      color:                  colorOn,
      lineWidth:              4,
      lineStyle:              0,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    });
    flashSeries.setData([
      { time: adminLine.startTime, value: adminLine.startPrice },
      { time: adminLine.endTime,   value: adminLine.endPrice   },
    ]);
    this.activeFlashSeries = flashSeries;

    let tick = 0;
    const totalTicks = BLINKS * 2;

    this.activeFlashInterval = setInterval(() => {
      tick++;
      try {
        if (tick >= totalTicks) {
          clearInterval(this.activeFlashInterval);
          this.activeFlashInterval = null;
          this.chart.removeSeries(flashSeries);
          this.activeFlashSeries = null;
        } else {
          flashSeries.applyOptions({ color: tick % 2 === 0 ? colorOn : colorOff });
        }
      } catch {
        clearInterval(this.activeFlashInterval);
        this.activeFlashInterval = null;
        this.activeFlashSeries   = null;
      }
    }, BLINK_MS);
  }

  // ==================== LINE MANAGEMENT ====================

  deleteSelectedLine(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first.', 'info');
      return;
    }
    const lineId = this.selectedLineId, owner = this.selectedLineOwner;

    const line = owner === 'user'
      ? this.userLines.find(l => l.id === lineId)
      : this.adminLines.find(l => l.id === lineId);

    this.selectedLineId    = null;
    this.selectedLineOwner = null;
    this.clearHandles();

    if (owner === 'user') {
      const index = this.userLines.findIndex(l => l.id === lineId);
      if (index !== -1) this.userLines.splice(index, 1);

      if (line && line.tool !== 'straightline') {
        this.drawingService.deleteUserLine(this.testId, lineId)
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (updated) => {
              this.userLines = updated || [];
              this.renderLines();
              this.showMessage('✓ Line deleted from database!', 'success');
            },
            error: () => this.showMessage('Delete failed.', 'error'),
          });
      } else {
        this.renderLines();
        this.showMessage('✓ Straight line removed from chart', 'info');
      }
    } else if (owner === 'admin') {
      const index = this.adminLines.findIndex(l => l.id === lineId);
      if (index !== -1) this.adminLines.splice(index, 1);
      this.drawingService.deleteAdminLine(this.testId, lineId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (updated) => {
            this.adminLines = updated || [];
            this.renderLines();
            this.showMessage('✓ Admin line deleted!', 'success');
          },
        });
    }
  }

  resetAllLines(): void {
    if (!confirm('Reset ALL lines? This cannot be undone.')) return;

    this.userLines         = [];
    this.adminLines        = [];
    this.selectedLineId    = null;
    this.selectedLineOwner = null;
    this.matchedCount      = 0;
    this.testComplete      = false;
    this.clearHandles();
    this.renderLines();

    if (this.userRole === 'admin') {
      this.drawingService.clearAllUserLines(this.testId)
        .pipe(takeUntil(this.destroy$)).subscribe();
      this.drawingService.clearAdminLines(this.testId)
        .pipe(takeUntil(this.destroy$)).subscribe();
    } else {
      this.drawingService.clearMatchedLines(this.testId);
      this.drawingService.clearAllUserLines(this.testId)
        .pipe(takeUntil(this.destroy$)).subscribe();
      this.drawingService.getAdminLines(this.testId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(lines => { this.totalAdminLines = (lines || []).length; });
    }
    this.showMessage('All lines cleared from view', 'success');
  }

  saveAllLines(): void {
    if (this.userRole !== 'admin') {
      this.showMessage('Only admin can save lines.', 'error');
      return;
    }
    this.drawingService.saveAdminLines(this.testId, this.adminLines)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (saved) => {
          this.lastSavedTime = new Date();
          this.showMessage(`✓ ${saved.length} answer line(s) saved!`, 'success');
        },
        error: () => this.showMessage('Save failed.', 'error'),
      });
  }

  restartTest(): void {
    if (this.userRole === 'admin') {
      this.showMessage('Admin cannot restart a test. Use Reset instead.', 'info');
      return;
    }
    if (!confirm('Restart the test? This will clear ALL your drawn lines and reset progress.')) return;

    this.drawingService.clearAllUserLines(this.testId)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.drawingService.clearMatchedLines(this.testId);
        this.userLines         = [];
        this.matchedCount      = 0;
        this.testComplete      = false;
        this.selectedLineId    = null;
        this.selectedLineOwner = null;
        this.clearHandles();
        this.renderLines();
        this.showMessage('Test restarted! Draw lines to match the hidden answers.', 'success');
      });
  }

  // ==================== EXTENSION CONTROLS ====================

  showExtensionControls(): void {
    if (!this.selectedLineId) {
      this.showMessage('Select a line first to extend.', 'info');
      return;
    }
    this.extendingLineId    = this.selectedLineId;
    this.showExtendControls = true;
    this.extendLeftValue    = 0;
    this.extendRightValue   = 0;
  }

  closeExtendControls(): void {
    this.showExtendControls = false;
    this.extendingLineId    = null;
  }

  extendLineManually(): void {
    if (!this.extendingLineId) return;
    const line = this.userLines.find(l => l.id === this.extendingLineId);
    if (!line) return;

    const dt        = line.endTime  - line.startTime;
    const dp        = line.endPrice - line.startPrice;
    const slope     = dt !== 0 ? dp / dt : 0;
    const intercept = line.startPrice - slope * line.startTime;
    const leftExt   = this.extendLeftValue  * 86400;
    const rightExt  = this.extendRightValue * 86400;

    const updated: DrawingLine = {
      ...line,
      startTime:  line.startTime - leftExt,
      startPrice: slope * (line.startTime - leftExt) + intercept,
      endTime:    line.endTime   + rightExt,
      endPrice:   slope * (line.endTime   + rightExt) + intercept,
    };

    const idx = this.userLines.findIndex(l => l.id === line.id);
    if (idx !== -1) {
      this.userLines[idx] = updated;
      this.renderLines();
    }

    this.drawingService.updateUserLine(this.testId, line.id, updated)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.showMessage('✓ Line extended!', 'success');
          this.closeExtendControls();
        },
        error: (e) => console.error('[Chart] Extension failed:', e),
      });
  }

  // ==================== COORDINATE CONVERSION ====================

  private screenToChartPoint(sp: ScreenPoint): Point | null {
    try {
      if (sp.x < 0 || sp.y < 0) return null;
      const time  = this.chart.timeScale().coordinateToTime(sp.x) as number | null;
      const price = this.candlestickSeries.coordinateToPrice(sp.y)  as number | null;
      if (time == null || price == null || isNaN(time) || isNaN(price)) return null;
      return { x: sp.x, y: sp.y, time, price };
    } catch (err) {
      console.debug('[Chart] Coordinate conversion error:', err);
      return null;
    }
  }

  private chartToScreenPoint(time: number, price: number): ScreenPoint | null {
    try {
      const x = this.chart.timeScale().timeToCoordinate(time)          as number | null;
      const y = this.candlestickSeries.priceToCoordinate(price)         as number | null;
      if (x == null || y == null || isNaN(x) || isNaN(y)) return null;
      return { x, y };
    } catch (err) {
      console.debug('[Chart] chartToScreenPoint error:', err);
      return null;
    }
  }

  // ==================== DATA ====================

  private async loadData(): Promise<void> {
    if (this.userRole === 'admin') {
      this.userLines  = [];
      this.adminLines = [];
      this.drawingService.clearAdminLinesInMemoryOnly(this.testId);
      setTimeout(() => {
        this.renderLines();
        this.drawHandles();
      }, 0);
    } else {
      this.drawingService.clearMatchedLines(this.testId);

      this.drawingService.getUserLines(this.testId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(lines => {
          this.userLines = (lines || []).filter(line => line.tool !== 'straightline');
          this.renderLines();
          this.drawHandles();
        });

      this.matchedCount = 0;
      this.testComplete = false;

      this.drawingService.getAdminLines(this.testId)
        .pipe(takeUntil(this.destroy$))
        .subscribe(lines => { this.totalAdminLines = (lines || []).length; });
    }
  }

  private async loadChartData(): Promise<void> {
    if (isNaN(this.testId) || this.testId <= 0) {
      console.warn('[Chart] Invalid testId:', this.testId);
      this.chartData = this.generateMockData();
      this.applyChartData();
      return;
    }

    this.testService.getTestById(this.testId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (test) => {
          if (!test) {
            console.warn('[Chart] Test not found:', this.testId);
            this.chartData = this.generateMockData();
          } else {
            const raw      = test?.data ?? test?.chartData;
            this.chartData = this.normalizeChartData(raw);
          }
          this.applyChartData();
        },
        error: (err) => {
          console.error('[Chart] Failed to load test:', err);
          this.chartData = this.generateMockData();
          this.applyChartData();
        },
      });
  }

  private normalizeChartData(data: any[]): any[] {
    if (!data?.length) return [];
    const sample  = data[0];
    const dateKey = Object.keys(sample).find(k =>
      ['date', 'time', 'datetime', 'timestamp', 'day'].includes(k.toLowerCase().trim())
    ) ?? Object.keys(sample)[0];
    const findKey = (...cands: string[]) =>
      Object.keys(sample).find(k => cands.includes(k.toLowerCase().trim()));
    const openKey  = findKey('open',  'o');
    const highKey  = findKey('high',  'h');
    const lowKey   = findKey('low',   'l');
    const closeKey = findKey('close', 'c', 'price', 'value', 'last');
    const toUnix   = (raw: any): number => {
      if (typeof raw === 'number') return raw > 100000 ? raw : Math.floor(raw * 86400);
      if (typeof raw === 'string') {
        const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dmy) {
          const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`);
          if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
        }
        const iso = new Date(raw);
        if (!isNaN(iso.getTime())) return Math.floor(iso.getTime() / 1000);
      }
      return NaN;
    };
    return data
      .map(item => {
        const close = closeKey ? Number(item[closeKey]) : 0;
        return {
          time:  toUnix(item[dateKey]),
          open:  openKey  ? Number(item[openKey])  : close,
          high:  highKey  ? Number(item[highKey])  : close,
          low:   lowKey   ? Number(item[lowKey])   : close,
          close,
        };
      })
      .filter(d => !isNaN(d.time) && d.time > 0 && !isNaN(d.close) && d.close > 0)
      .sort((a, b) => a.time - b.time)
      .filter((d, i, arr) => i === 0 || d.time !== arr[i - 1].time);
  }

  private generateMockData(): any[] {
    const data: any[] = [];
    let base = 24000;
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    for (let i = 0; i < 90; i++) {
      const change = (Math.random() - 0.5) * 200;
      base = Math.max(22000, Math.min(26000, base + change));
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const open  = base;
      const close = base + (Math.random() - 0.5) * 150;
      const high  = Math.max(open, close) + Math.random() * 80;
      const low   = Math.min(open, close) - Math.random() * 80;
      data.push({ time: Math.floor(d.getTime() / 1000), open, high, low, close });
    }
    return data;
  }

  private applyChartData(): void {
    if (!this.candlestickSeries || !this.chartData.length) return;
    try {
      this.candlestickSeries.setData(this.chartData);
      this.chart.timeScale().fitContent();
      this.renderLines();
    } catch (e) {
      console.error('[Chart] applyChartData error:', e);
    }
  }

  filterChartData(): void  { this.applyChartData(); }
  onDurationChange(): void { this.applyChartData(); }

  backToDashboard(): void {
    this.router.navigate([this.userRole === 'admin' ? '/admin/dashboard' : '/user/dashboard']);
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
    this.validationMessage = msg;
    this.messageType       = type;
    setTimeout(() => { this.validationMessage = ''; }, 3000);
  }

  // ==================== KEYBOARD SHORTCUTS ====================

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (event.key === 'Delete' && this.activeTool === 'select' && this.selectedLineId) {
      event.preventDefault();
      this.deleteSelectedLine();
      return;
    }
    if (event.key === 'Escape') {
      if (this.isDrawing) this.cancelDrawing();
      this.setActiveTool('select');
      this.selectedLineId = null;
      this.clearHandles();
      this.renderLines();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicateSelectedLine();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (this.userRole === 'admin') this.saveAllLines();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.resetAllLines();
      return;
    }
    if (event.key === '1') this.setActiveTool('select');
    if (event.key === '2') this.setActiveTool('trendline');
    if (event.key === '3')  this.setActiveTool('straightline');
  }
}