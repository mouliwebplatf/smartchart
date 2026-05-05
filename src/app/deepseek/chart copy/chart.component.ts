// import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, HostListener } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import { ActivatedRoute, Router } from '@angular/router';
// import { v4 as uuidv4 } from 'uuid';
// import * as LightweightCharts from 'lightweight-charts';

// import { DrawingService } from '../services/drawing.service';
// import { AuthService } from '../services/auth.service';
// import { DrawingLine, Point, ScreenPoint, ThemeMode } from '../models/drawing.model';

// type ToolMode = 'trendline' | 'hline' | 'vline' | 'ray' | 'select';

// @Component({
//   selector: 'app-chart',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   templateUrl: './chart.component.html',
//   styleUrls: ['./chart.component.scss']
// })
// export class ChartComponent implements AfterViewInit, OnDestroy {
//   @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;

//   testId: number = 0;
//   testName: string = '';
//   userRole: string | null = null;
//   currentTheme: ThemeMode = 'dark';

//   durationValue: number = 1;
//   durationType: string = 'month';

//   activeTool: ToolMode = 'trendline';
//   isDrawing: boolean = false;
//   private drawingStartPoint: Point | null = null;
//   private previewSeries: any = null;

//   userLines: DrawingLine[] = [];
//   adminLines: DrawingLine[] = [];
//   selectedLineId: string | null = null;

//   private isDraggingLine: boolean = false;
//   private draggedLineId: string | null = null;
//   private lastDragPoint: Point | null = null;

//   validationMessage: string = '';
//   messageType: 'success' | 'error' | 'info' = 'info';
//   showTolerance: boolean = false;
//   currentCorrectLine: DrawingLine | null = null;
//   private toleranceZoneSeries: any[] = [];

//   private chart: any = null;
//   private candlestickSeries: any = null;
//   private lineSeriesMap: Map<string, any> = new Map();
//   private chartData: any[] = [];

//   private themes = {
//     light: {
//       background: '#ffffff', textColor: '#333333',
//       gridColor: '#e0e0e0', borderColor: '#d1d1d1',
//     },
//     dark: {
//       background: '#1e222d', textColor: '#d1d4dc',
//       gridColor: '#2a2e39', borderColor: '#2a2e39',
//     }
//   };

//   constructor(
//     private route: ActivatedRoute,
//     private router: Router,
//     private authService: AuthService,
//     private drawingService: DrawingService
//   ) {}
// ngAfterViewInit(): void {
//   this.testId = Number(this.route.snapshot.paramMap.get('id'));
//   this.userRole = this.authService.getRole();
//   this.testName = this.route.snapshot.queryParams['name'] || 'NIFTY 50';

//   // Double rAF ensures the DOM has painted and the container has real dimensions
//   requestAnimationFrame(() => {
//     requestAnimationFrame(() => {
//       this.initChart().then(() => this.loadData());
//     });
//   });
// }

//   ngOnDestroy(): void {
//     if (this.chart) this.chart.remove();
//     window.removeEventListener('resize', this.handleResize);
//   }

//   // ==================== THEME ====================

//   toggleTheme(): void {
//     this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
//     this.applyTheme();
//   }

//   private applyTheme(): void {
//     const t = this.themes[this.currentTheme];
//     if (!this.chart) return;
//     this.chart.applyOptions({
//       layout: { background: { color: t.background }, textColor: t.textColor },
//       grid: { vertLines: { color: t.gridColor }, horzLines: { color: t.gridColor } },
//       timeScale: { borderColor: t.borderColor },
//       rightPriceScale: { borderColor: t.borderColor },
//     });
//     this.renderLines();
//   }

//   // ==================== INIT ====================

//   private handleResize = (): void => {
//     if (this.chart && this.chartContainer) {
//       this.chart.applyOptions({ width: this.chartContainer.nativeElement.clientWidth });
//     }
//   };

//   private async initChart(): Promise<void> {
//     const container = this.chartContainer.nativeElement;
//     const t = this.themes[this.currentTheme];

//     this.chart = LightweightCharts.createChart(container, {
//       width: container.clientWidth,
//       height: 600,
//       layout: { background: { color: t.background }, textColor: t.textColor },
//       grid: { vertLines: { color: t.gridColor }, horzLines: { color: t.gridColor } },
//       timeScale: { timeVisible: true, secondsVisible: false, borderColor: t.borderColor },
//       rightPriceScale: { borderColor: t.borderColor },
//       crosshair: { mode: 0 },
//     });

//     this.candlestickSeries = this.chart.addCandlestickSeries({
//       upColor: '#00B746', downColor: '#EF403C',
//       borderVisible: false,
//       wickUpColor: '#00B746', wickDownColor: '#EF403C',
//     });

//     // ── Click: draw or select ──
//     this.chart.subscribeClick((param: any) => {
//       if (!param?.point) return;
//       if (this.isDraggingLine) return;           // ignore click at end of drag
//       if (this.activeTool === 'select') {
//         this.handleSelectClick(param);
//       } else {
//         this.handleChartClick(param);
//       }
//     });

//     // ── Crosshair move: live preview + drag ──
//     this.chart.subscribeCrosshairMove((param: any) => {
//       if (!param?.point) return;
//       if (this.isDrawing && this.previewSeries) {
//         this.updatePreviewLine(param);
//       } else if (this.isDraggingLine && this.draggedLineId) {
//         this.updateDragLine(param);
//       }
//     });

//     window.addEventListener('resize', this.handleResize);
//     await this.loadChartData();
//   }

//   // ==================== TOOL SELECTION ====================

//   setActiveTool(tool: ToolMode): void {
//     if (this.isDrawing && this.previewSeries) {
//       this.chart.removeSeries(this.previewSeries);
//       this.previewSeries = null;
//     }
//     this.isDrawing = false;
//     this.drawingStartPoint = null;
//     this.activeTool = tool;
//     this.showMessage(`Tool: ${tool}`, 'info');
//   }

//   // ==================== DRAWING ====================

//   private handleChartClick(param: any): void {
//     const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
//     const cp = this.screenToChartPoint(sp);
//     if (!cp) return;

//     if (!this.isDrawing) {
//       // ── First click: anchor start ──
//       this.isDrawing = true;
//       this.drawingStartPoint = cp;

//       this.previewSeries = this.chart.addLineSeries({
//         color: '#FFD700', lineWidth: 2, lineStyle: 2,
//         priceLineVisible: false, lastValueVisible: false,
//       });
//       // seed with two identical points so setData doesn't throw
//       this.previewSeries.setData([
//         { time: cp.time, value: cp.price },
//         { time: cp.time + 1, value: cp.price },
//       ]);
//     } else {
//       // ── Second click: finish ──
//       this.finishDrawing(cp);
//       this.isDrawing = false;
//       this.drawingStartPoint = null;
//       if (this.previewSeries) {
//         this.chart.removeSeries(this.previewSeries);
//         this.previewSeries = null;
//       }
//     }
//   }

//   private finishDrawing(endPoint: Point): void {
//     if (!this.drawingStartPoint) return;

//     let start = { ...this.drawingStartPoint };
//     let end   = { ...endPoint };

//     // enforce per-tool constraints
//     switch (this.activeTool) {
//       case 'hline':
//         end.price = start.price;
//         if (end.time === start.time) end.time = start.time + 86400;
//         break;
//       case 'vline':
//         // end.time stays whatever the user clicked — we'll use it for click-point lookup
//         break;
//     }

//     // for all tools except ray/vline, ensure start < end in time
//     if (this.activeTool !== 'ray' && this.activeTool !== 'vline' && start.time > end.time) {
//       [start, end] = [end, start];
//     }

//     const newLine: DrawingLine = {
//       id: uuidv4(),
//       testId: this.testId,
//       type: this.userRole === 'admin' ? 'admin' : 'user',
//       tool: this.activeTool as 'trendline' | 'hline' | 'vline' | 'ray',
//       // store raw pixel coords (used only for hit-testing)
//       startX: start.x, startY: start.y,
//       endX:   end.x,   endY:   end.y,
//       // store chart-space coords (used for rendering)
//       startTime: start.time, startPrice: start.price,
//       endTime:   end.time,   endPrice:   end.price,
//       color: this.userRole === 'admin' ? '#FF6B6B' : '#4ECDC4',
//       createdAt: new Date(),
//     };

//     if (this.userRole === 'admin') {
//       this.adminLines.push(newLine);
//       this.drawingService.addAdminLine(this.testId, newLine).subscribe();
//       this.renderLine(newLine);
//       this.showMessage('✓ Line saved!', 'success');
//     } else {
//       this.validateAndSaveUserLine(newLine);
//     }
//   }

//   private updatePreviewLine(param: any): void {
//     if (!this.drawingStartPoint || !this.previewSeries) return;
//     const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
//     const cp = this.screenToChartPoint(sp);
//     if (!cp) return;

//     let end = { ...cp };
//     if (this.activeTool === 'hline') end.price = this.drawingStartPoint.price;
//     if (this.activeTool === 'vline') end.time  = this.drawingStartPoint.time;

//     const pts = this.getExtendedPoints(this.drawingStartPoint, end);
//     if (pts.length >= 2) this.previewSeries.setData(pts);
//   }

//   // Returns two points that span the visible range for infinite-line tools
//   private getExtendedPoints(start: Point, end: Point): any[] {
//     const tr = this.chart.timeScale().getVisibleRange();
//     if (!tr) return [];

//     const dt = end.time - start.time;
//     const dp = end.price - start.price;

//     if (dt === 0) {
//       // vertical — can't do a true vline in LightweightCharts; show a dot
//       return [{ time: start.time, value: start.price }];
//     }

//     const m = dp / dt;
//     const b = start.price - m * start.time;
//     const from = tr.from as number;
//     const to   = tr.to   as number;

//     return [
//       { time: from, value: m * from + b },
//       { time: to,   value: m * to   + b },
//     ];
//   }

//   // ==================== SELECT & DRAG ====================

//   private handleSelectClick(param: any): void {
//     if (this.isDraggingLine) return;      // was a drag, not a tap
//     const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
//     const hit = this.getLineAtPoint(sp);

//     if (hit) {
//       this.selectedLineId = hit;
//       this.renderLines();
//       this.showMessage('Line selected — drag to move or Delete to remove.', 'info');
//     } else {
//       this.selectedLineId = null;
//       this.renderLines();
//     }
//   }

//   @HostListener('document:mousedown', ['$event'])
//   onMouseDown(event: MouseEvent): void {
//     if (this.activeTool !== 'select' || !this.selectedLineId) return;
//     const container = this.chartContainer?.nativeElement;
//     if (!container) return;

//     const rect = container.getBoundingClientRect();
//     const sp: ScreenPoint = { x: event.clientX - rect.left, y: event.clientY - rect.top };

//     if (this.getLineAtPoint(sp) === this.selectedLineId) {
//       this.isDraggingLine = true;
//       this.draggedLineId  = this.selectedLineId;
//       this.lastDragPoint  = this.screenToChartPoint(sp);
//     }
//   }

//   @HostListener('document:mouseup')
//   onMouseUp(): void {
//     if (this.isDraggingLine && this.draggedLineId) {
//       const line = this.userLines.find(l => l.id === this.draggedLineId);
//       if (line) this.drawingService.updateUserLine(this.testId, line.id, line).subscribe();
//     }
//     this.isDraggingLine = false;
//     this.draggedLineId  = null;
//     this.lastDragPoint  = null;
//   }

//   private updateDragLine(param: any): void {
//     if (!this.draggedLineId || !this.lastDragPoint) return;
//     const sp: ScreenPoint = { x: param.point.x, y: param.point.y };
//     const curr = this.screenToChartPoint(sp);
//     if (!curr) return;

//     // ── delta in chart-space units ──
//     const dt = curr.time  - this.lastDragPoint.time;
//     const dp = curr.price - this.lastDragPoint.price;
//     this.lastDragPoint = curr;

//     const line = this.userLines.find(l => l.id === this.draggedLineId);
//     if (!line) return;

//     line.startTime  += dt;
//     line.endTime    += dt;
//     line.startPrice += dp;
//     line.endPrice   += dp;

//     this.renderLines();
//   }

//   private getLineAtPoint(sp: ScreenPoint): string | null {
//     for (const line of this.userLines) {
//       const a = this.chartToScreenPoint(line.startTime, line.startPrice);
//       const b = this.chartToScreenPoint(line.endTime,   line.endPrice);
//       if (a && b && this.distanceToSegment(sp, a, b) < 10) return line.id;
//     }
//     return null;
//   }

//   private distanceToSegment(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
//     const abx = b.x - a.x, aby = b.y - a.y;
//     const apx = p.x - a.x, apy = p.y - a.y;
//     const lenSq = abx * abx + aby * aby;
//     if (lenSq === 0) return Math.hypot(apx, apy);
//     const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
//     return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
//   }

//   // ==================== COORDINATE CONVERSION ====================

//   /** Screen pixel → chart time+price.  FIX: use candlestickSeries, not chart.priceScale() */
//   private screenToChartPoint(sp: ScreenPoint): Point | null {
//     try {
//       const time  = this.chart.timeScale().coordinateToTime(sp.x) as number | null;
//       const price = this.candlestickSeries.coordinateToPrice(sp.y) as number | null;
//       if (time == null || price == null) return null;
//       return { x: sp.x, y: sp.y, time, price };
//     } catch { return null; }
//   }

//   /** Chart time+price → screen pixel.  FIX: use candlestickSeries */
//   private chartToScreenPoint(time: number, price: number): ScreenPoint | null {
//     try {
//       const x = this.chart.timeScale().timeToCoordinate(time)       as number | null;
//       const y = this.candlestickSeries.priceToCoordinate(price)      as number | null;
//       if (x == null || y == null) return null;
//       return { x, y };
//     } catch { return null; }
//   }

//   // ==================== LINE RENDERING ====================

//   private removeSeries(id: string): void {
//     if (this.lineSeriesMap.has(id)) {
//       try { this.chart.removeSeries(this.lineSeriesMap.get(id)); } catch {}
//       this.lineSeriesMap.delete(id);
//     }
//   }

//   private renderLine(line: DrawingLine): void {
//     if (!this.chart) return;
//     try {
//       const tr = this.chart.timeScale().getVisibleRange();
//       if (!tr) return;

//       const from = tr.from as number;
//       const to   = tr.to   as number;

//       // ── FIX: always use stored time/price, never denormalizeX/Y ──
//       const st = line.startTime;
//       const sp = line.startPrice;
//       const et = line.endTime;
//       const ep = line.endPrice;

//       this.removeSeries(line.id);

//       const color = this.selectedLineId === line.id ? '#FFA500' : (line.color ?? '#4ECDC4');
//       const width = this.selectedLineId === line.id ? 3 : 2;

//       if (line.tool === 'vline') {
//         this.renderVLine(line, color, width);
//         return;
//       }

//       let data: any[];

//       switch (line.tool) {
//         case 'hline':
//           data = [{ time: from, value: sp }, { time: to, value: sp }];
//           break;

//         case 'ray': {
//           const dt = et - st, dp = ep - sp;
//           const m  = dt !== 0 ? dp / dt : 0;
//           const b  = sp - m * st;
//           data = [{ time: st, value: sp }, { time: to, value: m * to + b }];
//           break;
//         }

//         default: { // trendline — extend to both edges
//           const dt = et - st, dp = ep - sp;
//           const m  = dt !== 0 ? dp / dt : 0;
//           const b  = sp - m * st;
//           data = [{ time: from, value: m * from + b }, { time: to, value: m * to + b }];
//           break;
//         }
//       }

//       const series = this.chart.addLineSeries({
//         color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
//       });
//       series.setData(data);
//       this.lineSeriesMap.set(line.id, series);

//     } catch (e) { console.error('renderLine:', e); }
//   }

//   /** Vertical line workaround: use two adjacent candle timestamps */
//   private renderVLine(line: DrawingLine, color: string, width: number): void {
//     const allPrices = this.chartData.flatMap((d: any) => [d.low, d.high]);
//     const minP = Math.min(...allPrices);
//     const maxP = Math.max(...allPrices);

//     // find the two candles nearest to the stored click time
//     const target = line.startTime;
//     const sorted = [...this.chartData]
//       .sort((a, b) => Math.abs(a.time - target) - Math.abs(b.time - target));
//     if (sorted.length < 2) return;

//     const t1 = Math.min(sorted[0].time, sorted[1].time);
//     const t2 = Math.max(sorted[0].time, sorted[1].time);
//     const pad = (maxP - minP) * 0.05;

//     const series = this.chart.addLineSeries({
//       color, lineWidth: width, priceLineVisible: false, lastValueVisible: false,
//     });
//     series.setData([
//       { time: t1, value: minP - pad },
//       { time: t2, value: maxP + pad },
//     ]);
//     this.lineSeriesMap.set(line.id, series);
//   }

//   private renderLines(): void {
//     this.lineSeriesMap.forEach((_, id) => this.removeSeries(id));
//     this.lineSeriesMap.clear();

//     this.toleranceZoneSeries.forEach(s => { try { this.chart?.removeSeries(s); } catch {} });
//     this.toleranceZoneSeries = [];

//     if (this.showTolerance && this.currentCorrectLine) {
//       this.renderLine(this.currentCorrectLine);
//       this.renderToleranceZone(this.currentCorrectLine);
//     }

//     this.userLines.forEach(l => this.renderLine(l));
//     if (this.userRole === 'admin') this.adminLines.forEach(l => this.renderLine(l));
//   }

//   private renderToleranceZone(line: DrawingLine): void {
//     const tr = this.chart.timeScale().getVisibleRange();
//     if (!tr) return;

//     const from = tr.from as number, to = tr.to as number;
//     const allP  = this.chartData.flatMap((d: any) => [d.low, d.high]);
//     const tol   = (Math.max(...allP) - Math.min(...allP)) * 0.05;

//     const dt = line.endTime - line.startTime;
//     const dp = line.endPrice - line.startPrice;
//     const m  = dt !== 0 ? dp / dt : 0;
//     const b  = line.startPrice - m * line.startTime;

//     const make = (offset: number) => {
//       const s = this.chart.addLineSeries({
//         color: 'rgba(0,255,0,0.4)', lineWidth: 1, lineStyle: 2,
//         priceLineVisible: false, lastValueVisible: false,
//       });
//       s.setData([
//         { time: from, value: m * from + b + offset },
//         { time: to,   value: m * to   + b + offset },
//       ]);
//       return s;
//     };
//     this.toleranceZoneSeries = [make(+tol), make(-tol)];
//   }

//   // ==================== VALIDATION ====================

//   private validateAndSaveUserLine(line: DrawingLine): void {
//     const v = this.drawingService.validateUserLine(this.testId, line);
//     if (v.isValid) {
//       this.userLines.push(line);
//       this.drawingService.saveUserLine(this.testId, line).subscribe();
//       this.renderLines();
//       this.showMessage('✓ Correct! Line matches.', 'success');
//     } else {
//       this.showMessage('✗ Incorrect — showing correct line.', 'error');
//       this.showTolerance = true;
//       this.currentCorrectLine = v.correctLine ?? null;
//       this.renderLines();
//       setTimeout(() => {
//         this.showTolerance = false;
//         this.currentCorrectLine = null;
//         this.toleranceZoneSeries.forEach(s => { try { this.chart?.removeSeries(s); } catch {} });
//         this.toleranceZoneSeries = [];
//         this.renderLines();
//       }, 5000);
//     }
//   }

//   // ==================== LINE MANAGEMENT ====================

//   deleteSelectedLine(): void {
//     if (!this.selectedLineId) return;
//     if (!confirm('Delete this line?')) return;
//     this.userLines = this.userLines.filter(l => l.id !== this.selectedLineId);
//     this.drawingService.deleteUserLine(this.testId, this.selectedLineId).subscribe();
//     this.selectedLineId  = null;
//     this.isDraggingLine  = false;
//     this.draggedLineId   = null;
//     this.renderLines();
//     this.showMessage('✓ Line deleted!', 'success');
//   }

//   resetAllLines(): void {
//     if (!confirm('Reset all your lines?')) return;
//     this.drawingService.resetUserLines(this.testId).subscribe(() => {
//       this.userLines = [];
//       this.selectedLineId = null;
//       this.renderLines();
//       this.showMessage('✓ All lines reset!', 'success');
//     });
//   }

//   saveAllLinesAsAdmin(): void {
//     if (this.userRole !== 'admin') return;
//     this.drawingService.saveAdminLines(this.testId, this.adminLines).subscribe(() => {
//       this.showMessage('✓ Admin lines saved as correct answers!', 'success');
//     });
//   }

//   clearAllLines(): void {
//     if (!confirm('Clear all your lines?')) return;
//     this.userLines = [];
//     this.selectedLineId = null;
//     this.renderLines();
//     this.showMessage('✓ All lines cleared!', 'success');
//   }

//   // ==================== DATA ====================

//   private async loadData(): Promise<void> {
//     this.drawingService.getUserLines(this.testId).subscribe(lines => {
//       this.userLines = lines;
//       this.renderLines();
//     });
//     if (this.userRole === 'admin') {
//       this.drawingService.getAdminLines(this.testId).subscribe(lines => {
//         this.adminLines = lines;
//         this.renderLines();
//       });
//     }
//   }

//   private async loadChartData(): Promise<void> {
//     this.chartData = this.generateMockData();
//     this.filterChartData();
//   }

//   private generateMockData(): any[] {
//     const data: any[] = [];
//     let base = 24000;
//     const start = new Date();
//     start.setMonth(start.getMonth() - 3);

//     for (let i = 0; i < 90; i++) {
//       base = Math.max(22000, Math.min(25000, base + (Math.random() - 0.5) * 100));
//       const d = new Date(start);
//       d.setDate(start.getDate() + i);
//       data.push({
//         time:  Math.floor(d.getTime() / 1000),
//         open:  base,
//         high:  base + Math.random() * 80,
//         low:   base - Math.random() * 80,
//         close: base + (Math.random() - 0.5) * 60,
//       });
//     }
//     return data;
//   }

//   private get filteredChartData(): any[] {
//     if (!this.chartData.length) return [];
//     const now = new Date();
//     const start = new Date();
//     switch (this.durationType) {
//       case 'day':   start.setDate(now.getDate() - this.durationValue); break;
//       case 'month': start.setMonth(now.getMonth() - this.durationValue); break;
//       case 'year':  start.setFullYear(now.getFullYear() - this.durationValue); break;
//     }
//     return this.chartData.filter(d => new Date(d.time * 1000) >= start);
//   }

//   filterChartData(): void {
//     const filtered = this.filteredChartData;
//     if (this.candlestickSeries) this.candlestickSeries.setData(filtered);
//     this.renderLines();
//   }

//   onDurationChange(): void { this.filterChartData(); }

//   backToDashboard(): void {
//     this.router.navigate([this.userRole === 'admin' ? '/admin/dashboard' : '/user/dashboard']);
//   }

//   private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
//     this.validationMessage = msg;
//     this.messageType = type;
//     setTimeout(() => { this.validationMessage = ''; }, 3000);
//   }

//   // ==================== KEYBOARD ====================

//   @HostListener('document:keydown', ['$event'])
//   onKeyDown(event: KeyboardEvent): void {
//     if (event.key === 'Delete' && this.selectedLineId) {
//       event.preventDefault();
//       this.deleteSelectedLine();
//     }
//     if (event.key === 'Escape' && this.isDrawing) {
//       if (this.previewSeries) {
//         this.chart.removeSeries(this.previewSeries);
//         this.previewSeries = null;
//       }
//       this.isDrawing = false;
//       this.drawingStartPoint = null;
//       this.showMessage('Drawing cancelled', 'info');
//     }
//   }
// }