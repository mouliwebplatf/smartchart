// chart.component.ts (full, with closeExtendControls)
import {
  Component, ElementRef, ViewChild,
  AfterViewInit, OnDestroy, HostListener,
  NgZone, ChangeDetectorRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { v4 as uuidv4 } from 'uuid';
import { Subject, takeUntil } from 'rxjs';

// Lightweight Charts v5
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  LineSeries,
  LineStyle,
  Time,
  UTCTimestamp
} from 'lightweight-charts';

import { DrawingService } from '../services/drawing.service';
import { AuthService } from '../services/auth.service';
import { TestService } from '../services/test.service';
import { FileUploadService, ChartDataPoint } from '../services/file-upload.service';
import {
  ThemeMode,
  LineTool,
  Point,
  ScreenPoint,
  DrawingLine,
  ValidationResult,
  DragState
} from '../models/drawing.model';

@Component({
  selector: 'app-chart',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss']
})
export class ChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartContainer') chartContainerRef!: ElementRef<HTMLDivElement>;
  @ViewChild('handleCanvas') handleCanvasRef!: ElementRef<HTMLCanvasElement>;

  // Chart instances
  private chart: IChartApi | null = null;
  private candlestickSeries: ISeriesApi<'Candlestick'> | null = null;
  private lineSeriesMap: Map<string, ISeriesApi<'Line'>> = new Map();

  // Data
  private chartData: ChartDataPoint[] = [];
  testId = 0;
  testName = '';
  userRole: 'admin' | 'user' | null = null;
  currentTheme: ThemeMode = 'dark';

  // Drawing state
  activeTool: LineTool = 'select';
  isDrawing = false;
  private drawingStartPoint: Point | null = null;
  private previewSeries: ISeriesApi<'Line'> | null = null;

  userLines: DrawingLine[] = [];
  adminLines: DrawingLine[] = [];
  selectedLineId: string | null = null;
  selectedLineOwner: 'user' | 'admin' | null = null;

  // Drag state
  dragState: DragState = {
    active: false,
    lineId: null,
    handleType: null,
    lastPoint: null,
    distance: 0
  };
  private dragLineSnapshot: DrawingLine | null = null;

  // Handle extension flags
  isExtendingLeftHandle = false;
  isExtendingRightHandle = false;
  private extendingLineId: string | null = null;

  shiftHeld = false;
  cursorIsOverInteractable = false;

  // UI
  validationMessage = '';
  messageType: 'success' | 'error' | 'info' = 'info';
  showExtendControls = false;
  extendLeftValue = 0;
  extendRightValue = 0;
  totalAdminLines = 0;
  matchedCount = 0;
  testComplete = false;

  // Straight line updater (unsubscribe function)
  private straightLineUpdater: (() => void) | null = null;

  // Canvas for handles
  private handleCanvasCtx: CanvasRenderingContext2D | null = null;
  private animationFrameId: number | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService,
    private drawingService: DrawingService,
    private testService: TestService,
    private fileUploadService: FileUploadService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  // ==================== LIFECYCLE ====================
  ngAfterViewInit(): void {
    this.testId = Number(this.route.snapshot.paramMap.get('id'));
    this.userRole = this.authService.getRole() as 'admin' | 'user';
    this.testName = this.route.snapshot.queryParams['name'] || 'Chart';

    if (isNaN(this.testId) || this.testId <= 0) {
      this.router.navigate(['/dashboard']);
      return;
    }

    this.initChart().then(() => this.loadData());
  }

  ngOnDestroy(): void {
    if (this.straightLineUpdater) this.straightLineUpdater();
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    this.destroy$.next();
    this.destroy$.complete();
    if (this.chart) this.chart.remove();
    window.removeEventListener('resize', this.handleResize);
  }

  // ==================== CHART INIT ====================
  private async initChart(): Promise<void> {
    const container = this.chartContainerRef.nativeElement;
    const theme = this.getThemeColors();

    this.chart = createChart(container, {
      width: container.clientWidth,
      height: 600,
      layout: { background: { color: theme.background }, textColor: theme.textColor },
      grid: { vertLines: { color: theme.gridColor }, horzLines: { color: theme.gridColor } },
      timeScale: { timeVisible: true, borderColor: theme.borderColor },
      rightPriceScale: { visible: true, borderColor: theme.borderColor },
      crosshair: { mode: 1 }
    });

    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350', borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      priceLineVisible: false, lastValueVisible: true
    });

    this.chart.subscribeClick((param) => this.onChartClick(param));
    this.chart.subscribeCrosshairMove((param) => this.onCrosshairMove(param));

    window.addEventListener('resize', this.handleResize);
    this.setupHandleCanvas();
    await this.loadChartData();
  }

  private handleResize = () => {
    if (this.chart && this.chartContainerRef) {
      this.chart.applyOptions({ width: this.chartContainerRef.nativeElement.clientWidth });
      this.updateCanvasSize();
    }
  };

  private getThemeColors() {
    return this.currentTheme === 'dark'
      ? { background: '#1e222d', textColor: '#d1d4dc', gridColor: '#2a2e39', borderColor: '#2a2e39' }
      : { background: '#ffffff', textColor: '#333333', gridColor: '#e0e0e0', borderColor: '#d1d1d1' };
  }

  // ==================== HANDLE CANVAS ====================
  private setupHandleCanvas(): void {
    const canvas = this.handleCanvasRef.nativeElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    this.updateCanvasSize();
    this.handleCanvasCtx = canvas.getContext('2d');
    this.startHandleRendering();
  }

  private updateCanvasSize(): void {
    const canvas = this.handleCanvasRef.nativeElement;
    const container = this.chartContainerRef.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    canvas.style.width = `${container.clientWidth}px`;
    canvas.style.height = `${container.clientHeight}px`;
    this.handleCanvasCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private startHandleRendering(): void {
    const draw = () => {
      this.drawHandles();
      this.animationFrameId = requestAnimationFrame(draw);
    };
    this.animationFrameId = requestAnimationFrame(draw);
  }

  private drawHandles(): void {
    if (!this.handleCanvasCtx || !this.selectedLineId) {
      this.clearHandles();
      return;
    }
    const line = this.userLines.find(l => l.id === this.selectedLineId)
      ?? this.adminLines.find(l => l.id === this.selectedLineId);
    if (!line || line.tool !== 'trendline') {
      this.clearHandles();
      return;
    }
    const start = this.chartToScreen(line.startTime, line.startPrice);
    const end = this.chartToScreen(line.endTime, line.endPrice);
    if (!start || !end) return;
    this.clearHandles();
    this.drawHandle(start.x, start.y, 'left');
    this.drawHandle(end.x, end.y, 'right');
  }

  private drawHandle(x: number, y: number, type: string): void {
    if (!this.handleCanvasCtx) return;
    const ctx = this.handleCanvasCtx;
    const isActive = (type === 'left' && this.isExtendingLeftHandle) ||
                     (type === 'right' && this.isExtendingRightHandle);
    const radius = isActive ? 8 : 6;
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
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  private clearHandles(): void {
    if (!this.handleCanvasCtx || !this.handleCanvasRef?.nativeElement) return;
    const canvas = this.handleCanvasRef.nativeElement;
    this.handleCanvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ==================== COORDINATE CONVERSION ====================
  private screenToChart(screen: ScreenPoint): Point | null {
    if (!this.chart || !this.candlestickSeries) return null;
    try {
      const time = this.chart.timeScale().coordinateToTime(screen.x) as UTCTimestamp | null;
      const price = this.candlestickSeries.coordinateToPrice(screen.y);
      if (time == null || price == null) return null;
      return { x: screen.x, y: screen.y, time: time as number, price };
    } catch { return null; }
  }

  private chartToScreen(time: number, price: number): ScreenPoint | null {
    if (!this.chart || !this.candlestickSeries) return null;
    try {
      const x = this.chart.timeScale().timeToCoordinate(time as UTCTimestamp);
      const y = this.candlestickSeries.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x, y };
    } catch { return null; }
  }

  // ==================== DRAWING LOGIC ====================
  private onChartClick(param: any): void {
    if (!param?.point) return;
    const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
    const cp = this.screenToChart(sp);
    if (!cp) return;

    if (this.activeTool === 'select') {
      this.handleSelectClick(sp);
      return;
    }

    if (this.activeTool === 'straightline') {
      this.createStraightLine(cp.price);
      return;
    }

    if (!this.isDrawing) {
      this.startDrawing(cp);
    } else {
      this.finishDrawing(cp);
    }
  }

  private startDrawing(point: Point): void {
    this.isDrawing = true;
    this.drawingStartPoint = point;
    this.previewSeries = this.chart!.addSeries(LineSeries, {
      color: '#4ECDC4',
      lineWidth: 2 as any,
      priceLineVisible: false,
      lastValueVisible: false
    });
  }

  private finishDrawing(endPoint: Point): void {
    if (!this.drawingStartPoint) return;
    let end = endPoint;
    if (this.shiftHeld) end = this.snapToAngle(this.drawingStartPoint, end);

    const line: DrawingLine = {
      id: uuidv4(),
      testId: this.testId,
      type: this.userRole === 'admin' ? 'admin' : 'user',
      tool: this.activeTool,
      originalTool: this.activeTool,
      startTime: this.drawingStartPoint.time,
      startPrice: this.drawingStartPoint.price,
      endTime: end.time,
      endPrice: end.price,
      startX: 0, startY: 0, endX: 0, endY: 0,
      color: this.userRole === 'admin' ? '#FF6B6B' : '#4ECDC4',
      createdAt: new Date()
    };

    if (this.userRole === 'admin') {
      this.adminLines.push(line);
      this.renderLine(line);
    } else {
      this.validateAndSaveUserLine(line);
    }
    this.cancelDrawing();
  }

  private createStraightLine(price: number): void {
    const line: DrawingLine = {
      id: uuidv4(),
      testId: this.testId,
      type: 'user',
      tool: 'straightline',
      originalTool: 'straightline',
      startTime: 0, startPrice: price,
      endTime: 0, endPrice: price,
      startX: 0, startY: 0, endX: 0, endY: 0,
      color: '#FFFFFF',
      createdAt: new Date()
    };
    this.userLines.push(line);
    this.renderLine(line);
    this.showMessage('Straight line placed (dynamic on zoom)', 'success');
  }

  private snapToAngle(start: Point, end: Point): Point {
    const sScreen = this.chartToScreen(start.time, start.price);
    const eScreen = this.chartToScreen(end.time, end.price);
    if (!sScreen || !eScreen) return end;
    const dx = Math.abs(eScreen.x - sScreen.x);
    const dy = Math.abs(eScreen.y - sScreen.y);
    if (dx > dy) eScreen.y = sScreen.y;
    else eScreen.x = sScreen.x;
    return this.screenToChart(eScreen) || end;
  }

  private onCrosshairMove(param: any): void {
    if (!this.isDrawing || !this.previewSeries || !param?.point) return;
    const cp = this.screenToChart({ x: param.point.x, y: param.point.y });
    if (!cp) return;
    let end = cp;
    if (this.shiftHeld && this.drawingStartPoint) end = this.snapToAngle(this.drawingStartPoint, end);
    this.previewSeries.setData([
      { time: this.drawingStartPoint!.time as Time, value: this.drawingStartPoint!.price },
      { time: end.time as Time, value: end.price }
    ]);
  }

  private cancelDrawing(): void {
    this.isDrawing = false;
    this.drawingStartPoint = null;
    if (this.previewSeries) {
      this.chart?.removeSeries(this.previewSeries);
      this.previewSeries = null;
    }
  }

  // ==================== LINE RENDERING ====================
  private renderLine(line: DrawingLine): void {
    if (!this.chart) return;
    this.removeSeries(line.id);

    const isSelected = this.selectedLineId === line.id;
    let color = isSelected ? '#FFA500' : (line.color ?? (line.type === 'admin' ? '#FF6B6B' : '#4ECDC4'));
    let width = isSelected ? 3 : 2;
    let lineStyle: LineStyle = 0;

    if (line.tool === 'straightline') {
      const update = () => {
        const range = this.chart!.timeScale().getVisibleRange();
        if (!range) return;
        const from = range.from as number;
        const to = range.to as number;
        const data = [
          { time: from as Time, value: line.startPrice },
          { time: to as Time, value: line.startPrice }
        ];
        const series = this.lineSeriesMap.get(line.id);
        if (series) {
          series.setData(data);
        } else {
          const newSeries = this.chart!.addSeries(LineSeries, {
            color, lineWidth: width as any, lineStyle: 1,
            priceLineVisible: false, lastValueVisible: false
          });
          newSeries.setData(data);
          this.lineSeriesMap.set(line.id, newSeries);
        }
      };
      update();

      if (!this.straightLineUpdater) {
        const callback = () => {
          this.userLines.filter(l => l.tool === 'straightline').forEach(l => this.renderLine(l));
        };
        this.chart!.timeScale().subscribeVisibleTimeRangeChange(callback);
        this.straightLineUpdater = () => {
          this.chart!.timeScale().unsubscribeVisibleTimeRangeChange(callback);
        };
      }
      return;
    }

    let data: any[] = [];
    switch (line.tool) {
      case 'hline':
        data = [{ time: line.startTime as Time, value: line.startPrice }, { time: line.endTime as Time, value: line.endPrice }];
        break;
      case 'vline':
        const allPrices = this.chartData.flatMap(d => [d.low, d.high]);
        const minP = Math.min(...allPrices), maxP = Math.max(...allPrices);
        data = [{ time: line.startTime as Time, value: minP - (maxP - minP) * 0.05 }, { time: line.startTime as Time, value: maxP + (maxP - minP) * 0.05 }];
        break;
      case 'ray': {
        const range = this.chart.timeScale().getVisibleRange();
        if (range) {
          const slope = (line.endPrice - line.startPrice) / (line.endTime - line.startTime);
          const intercept = line.startPrice - slope * line.startTime;
          data = [{ time: line.startTime as Time, value: line.startPrice }, { time: (range.to as number), value: slope * (range.to as number) + intercept }];
        } else data = [{ time: line.startTime as Time, value: line.startPrice }, { time: line.endTime as Time, value: line.endPrice }];
        break;
      }
      default: // trendline
        data = [{ time: line.startTime as Time, value: line.startPrice }, { time: line.endTime as Time, value: line.endPrice }];
    }

    const series = this.chart.addSeries(LineSeries, {
      color, lineWidth: width as any, lineStyle,
      priceLineVisible: false, lastValueVisible: false
    });
    series.setData(data);
    this.lineSeriesMap.set(line.id, series);
  }

  private removeSeries(id: string): void {
    const existing = this.lineSeriesMap.get(id);
    if (existing) {
      this.chart?.removeSeries(existing);
      this.lineSeriesMap.delete(id);
    }
  }

  private renderAllLines(): void {
    this.userLines.forEach(l => this.renderLine(l));
    if (this.userRole === 'admin') this.adminLines.forEach(l => this.renderLine(l));
  }

  // ==================== SELECT & HIT TEST ====================
  private handleSelectClick(sp: ScreenPoint): void {
    const handle = this.getHandleUnderPoint(sp);
    if (handle) return;

    const hit = this.hitTestLine(sp);
    if (hit) {
      this.selectedLineId = hit.id;
      this.selectedLineOwner = hit.owner;
      this.showMessage(`Selected ${hit.id.slice(0,8)}`, 'info');
    } else {
      this.selectedLineId = null;
      this.selectedLineOwner = null;
    }
    this.renderAllLines();
  }

  private hitTestLine(sp: ScreenPoint): { id: string; owner: 'user' | 'admin' } | null {
    const lines = [...this.userLines, ...(this.userRole === 'admin' ? this.adminLines : [])];
    for (const line of lines) {
      const start = this.chartToScreen(line.startTime, line.startPrice);
      const end = this.chartToScreen(line.endTime, line.endPrice);
      if (start && end && this.distanceToSegment(sp, start, end) < 8) {
        return { id: line.id, owner: line.type === 'admin' ? 'admin' : 'user' };
      }
    }
    return null;
  }

  private distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
    const abx = b.x - a.x, aby = b.y - a.y;
    const apx = p.x - a.x, apy = p.y - a.y;
    const dot = apx * abx + apy * aby;
    const len2 = abx * abx + aby * aby;
    if (len2 === 0) return Math.hypot(apx, apy);
    let t = dot / len2;
    t = Math.max(0, Math.min(1, t));
    const projx = a.x + t * abx, projy = a.y + t * aby;
    return Math.hypot(p.x - projx, p.y - projy);
  }

  private getHandleUnderPoint(sp: ScreenPoint): { type: 'left' | 'right', lineId: string } | null {
    if (!this.selectedLineId) return null;
    const line = this.userLines.find(l => l.id === this.selectedLineId)
      ?? this.adminLines.find(l => l.id === this.selectedLineId);
    if (!line || line.tool !== 'trendline') return null;
    const start = this.chartToScreen(line.startTime, line.startPrice);
    const end = this.chartToScreen(line.endTime, line.endPrice);
    if (!start || !end) return null;
    if (Math.hypot(sp.x - start.x, sp.y - start.y) < 10) return { type: 'left', lineId: line.id };
    if (Math.hypot(sp.x - end.x, sp.y - end.y) < 10) return { type: 'right', lineId: line.id };
    return null;
  }

  // ==================== MOUSE DRAG & EXTEND ====================
  @HostListener('document:mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    if (this.activeTool !== 'select') return;
    const rect = this.chartContainerRef.nativeElement.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    const handle = this.getHandleUnderPoint(sp);
    if (handle) {
      event.preventDefault();
      this.extendingLineId = handle.lineId;
      if (handle.type === 'left') this.isExtendingLeftHandle = true;
      else this.isExtendingRightHandle = true;
      const line = this.userLines.find(l => l.id === handle.lineId);
      if (line) this.dragLineSnapshot = JSON.parse(JSON.stringify(line));
      return;
    }

    const hit = this.hitTestLine(sp);
    if (hit) {
      event.preventDefault();
      this.selectedLineId = hit.id;
      this.selectedLineOwner = hit.owner;
      this.dragState = {
        active: true,
        lineId: hit.id,
        handleType: 'body',
        lastPoint: this.screenToChart(sp),
        distance: 0
      };
      const line = (hit.owner === 'user' ? this.userLines : this.adminLines).find(l => l.id === hit.id);
      if (line) this.dragLineSnapshot = JSON.parse(JSON.stringify(line));
      this.renderAllLines();
    }
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    this.shiftHeld = event.shiftKey;
    const rect = this.chartContainerRef.nativeElement.getBoundingClientRect();
    const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    if (this.dragState.active && this.dragState.lineId && this.dragState.lastPoint && this.dragLineSnapshot) {
      const cp = this.screenToChart(sp);
      if (!cp) return;
      const dt = cp.time - this.dragState.lastPoint.time;
      const dp = cp.price - this.dragState.lastPoint.price;
      const line = (this.selectedLineOwner === 'user' ? this.userLines : this.adminLines)
        .find(l => l.id === this.dragState.lineId);
      if (line) {
        line.startTime = this.dragLineSnapshot.startTime + dt;
        line.endTime = this.dragLineSnapshot.endTime + dt;
        line.startPrice = this.dragLineSnapshot.startPrice + dp;
        line.endPrice = this.dragLineSnapshot.endPrice + dp;
        this.renderLine(line);
      }
      this.dragState.distance += Math.abs(event.movementX) + Math.abs(event.movementY);
      return;
    }

    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineId) {
      const cp = this.screenToChart(sp);
      if (!cp) return;
      const line = this.userLines.find(l => l.id === this.extendingLineId);
      if (line && line.tool === 'trendline') {
        if (this.isExtendingLeftHandle) {
          line.startTime = cp.time;
          line.startPrice = cp.price;
        } else {
          line.endTime = cp.time;
          line.endPrice = cp.price;
        }
        this.renderLine(line);
      }
      return;
    }

    const hit = this.hitTestLine(sp);
    this.cursorIsOverInteractable = !!hit;
    this.handleCanvasRef.nativeElement.style.cursor = hit ? 'pointer' : 'default';
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (this.dragState.active && this.dragState.lineId && this.selectedLineOwner === 'user') {
      const line = this.userLines.find(l => l.id === this.dragState.lineId);
      if (line) this.drawingService.updateUserLine(this.testId, line.id, line).subscribe();
    }
    if ((this.isExtendingLeftHandle || this.isExtendingRightHandle) && this.extendingLineId) {
      const line = this.userLines.find(l => l.id === this.extendingLineId);
      if (line) this.drawingService.updateUserLine(this.testId, line.id, line).subscribe();
    }
    this.dragState = { active: false, lineId: null, handleType: null, lastPoint: null, distance: 0 };
    this.isExtendingLeftHandle = false;
    this.isExtendingRightHandle = false;
    this.extendingLineId = null;
    this.dragLineSnapshot = null;
  }

  // ==================== USER ACTIONS ====================
  setActiveTool(tool: LineTool): void {
    this.activeTool = tool;
    this.cancelDrawing();
    this.showMessage(`Tool: ${tool}`, 'info');
  }

  deleteSelectedLine(): void {
    if (!this.selectedLineId) return;
    if (this.selectedLineOwner === 'user') {
      const index = this.userLines.findIndex(l => l.id === this.selectedLineId);
      if (index !== -1) this.userLines.splice(index, 1);
      this.drawingService.deleteUserLine(this.testId, this.selectedLineId).subscribe();
    } else if (this.selectedLineOwner === 'admin') {
      const index = this.adminLines.findIndex(l => l.id === this.selectedLineId);
      if (index !== -1) this.adminLines.splice(index, 1);
      this.drawingService.deleteAdminLine(this.testId, this.selectedLineId).subscribe();
    }
    this.selectedLineId = null;
    this.selectedLineOwner = null;
    this.renderAllLines();
    this.showMessage('Line deleted', 'info');
  }

  duplicateSelectedLine(): void {
    if (!this.selectedLineId) return;
    const original = (this.selectedLineOwner === 'user' ? this.userLines : this.adminLines)
      .find(l => l.id === this.selectedLineId);
    if (!original) return;

    const offset = 5;
    const duplicate: DrawingLine = {
      ...original,
      id: uuidv4(),
      type: this.userRole === 'admin' ? 'admin' : 'user',
      startPrice: original.startPrice + offset,
      endPrice: original.endPrice + offset,
      createdAt: new Date(),
      parentId: original.id,
      isDuplicate: true,
      duplicateCount: (original.duplicateCount || 0) + 1,
      color: this.userRole === 'admin' ? '#FFA500' : '#00FF00'
    };
    if (this.userRole === 'admin') {
      this.adminLines.push(duplicate);
    } else {
      this.userLines.push(duplicate);
    }
    this.selectedLineId = duplicate.id;
    this.renderLine(duplicate);
    this.showMessage('Line duplicated', 'success');
  }

  duplicateAndExtendManually(): void {
    this.duplicateSelectedLine();
    this.showExtendControls = true;
  }

  extendLineManually(): void {
    if (!this.selectedLineId) return;
    const line = this.userLines.find(l => l.id === this.selectedLineId);
    if (!line) return;
    const slope = (line.endPrice - line.startPrice) / (line.endTime - line.startTime);
    const intercept = line.startPrice - slope * line.startTime;
    const leftExt = this.extendLeftValue * 86400;
    const rightExt = this.extendRightValue * 86400;
    line.startTime = line.startTime - leftExt;
    line.startPrice = slope * line.startTime + intercept;
    line.endTime = line.endTime + rightExt;
    line.endPrice = slope * line.endTime + intercept;
    this.renderLine(line);
    this.drawingService.updateUserLine(this.testId, line.id, line).subscribe();
    this.showExtendControls = false;
    this.showMessage('Line extended', 'success');
  }

  // ✅ Missing method added here
  closeExtendControls(): void {
    this.showExtendControls = false;
    this.extendLeftValue = 0;
    this.extendRightValue = 0;
  }

  saveAllLines(): void {
    if (this.userRole === 'admin') {
      this.drawingService.saveAdminLines(this.testId, this.adminLines).subscribe();
      this.showMessage('Admin lines saved', 'success');
    } else {
      this.showMessage('Only admin can save', 'error');
    }
  }

  resetAllLines(): void {
    this.userLines = [];
    this.adminLines = [];
    this.selectedLineId = null;
    this.selectedLineOwner = null;
    this.renderAllLines();
    this.showMessage('All lines cleared', 'info');
  }

  toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
  }

  backToDashboard(): void {
    this.router.navigate([`/${this.userRole}/dashboard`]);
  }

  // ==================== VALIDATION (stub) ====================
  private validateAndSaveUserLine(line: DrawingLine): void {
    this.userLines.push(line);
    this.renderLine(line);
    this.showMessage('Line saved', 'success');
  }

  // ==================== DATA LOADING ====================
  private async loadChartData(): Promise<void> {
    this.testService.getTestById(this.testId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (test) => {
          const raw = test?.data ?? test?.chartData;
          if (raw && raw.length) {
            if (typeof raw[0]?.time === 'number') this.chartData = raw;
            else this.chartData = (this.fileUploadService as any).normalizeChartData?.(raw) || this.generateMockData();
          } else this.chartData = this.generateMockData();
          this.applyChartData();
        },
        error: () => {
          this.chartData = this.generateMockData();
          this.applyChartData();
        }
      });
  }

  private applyChartData(): void {
    if (!this.candlestickSeries || !this.chartData.length) return;
    this.candlestickSeries.setData(
      this.chartData.map(d => ({
        time: d.time as Time,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume
      }))
    );
    this.chart!.timeScale().fitContent();
    this.renderAllLines();
  }

  private generateMockData(): ChartDataPoint[] {
    const data: ChartDataPoint[] = [];
    let base = 24000;
    const start = new Date();
    start.setMonth(start.getMonth() - 3);
    for (let i = 0; i < 90; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const change = (Math.random() - 0.5) * 200;
      base = Math.max(22000, Math.min(26000, base + change));
      const open = base;
      const close = base + (Math.random() - 0.5) * 150;
      const high = Math.max(open, close) + Math.random() * 80;
      const low = Math.min(open, close) - Math.random() * 80;
      data.push({ time: Math.floor(d.getTime() / 1000), open, high, low, close, volume: 0 });
    }
    return data;
  }

  private loadData(): void {
    if (this.userRole === 'admin') {
      this.drawingService.getAdminLines(this.testId).subscribe(lines => this.adminLines = lines || []);
    } else {
      this.drawingService.getUserLines(this.testId).subscribe(lines => this.userLines = lines || []);
      this.drawingService.getAdminLines(this.testId).subscribe(lines => this.totalAdminLines = lines?.length || 0);
    }
  }

  private applyTheme(): void {
    const theme = this.getThemeColors();
    this.chart?.applyOptions({
      layout: { background: { color: theme.background }, textColor: theme.textColor },
      grid: { vertLines: { color: theme.gridColor }, horzLines: { color: theme.gridColor } },
      timeScale: { borderColor: theme.borderColor },
      rightPriceScale: { borderColor: theme.borderColor }
    });
    this.renderAllLines();
  }

  private showMessage(msg: string, type: 'success'|'error'|'info'): void {
    this.validationMessage = msg;
    this.messageType = type;
    setTimeout(() => this.validationMessage = '', 3000);
  }
}