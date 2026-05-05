import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface ChartPoint {
  x: number;
  y: number;
}

@Injectable({
  providedIn: 'root'
})
export class ChartService {
  private chartInstance: any;
  private drawingModeSubject = new BehaviorSubject<string>('none');
  drawingMode$ = this.drawingModeSubject.asObservable();

  setChartInstance(instance: any): void {
    this.chartInstance = instance;
  }

  setDrawingMode(mode: string): void {
    this.drawingModeSubject.next(mode);
  }

  getChartInstance(): any {
    return this.chartInstance;
  }

  convertEventToChartCoordinates(event: MouseEvent, chartContainer: HTMLElement): ChartPoint | null {
    const rect = chartContainer.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert pixel coordinates to chart coordinates
    // This is simplified - actual implementation would need chart-specific conversion
    return { x, y };
  }
}