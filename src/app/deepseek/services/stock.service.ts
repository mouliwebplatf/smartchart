import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class StockService {

  private apiKey = ' POIK78J2WO32DBFU'; // 🔑 replace this
  private baseUrl = 'https://www.alphavantage.co/query';

  constructor(private http: HttpClient) {}

  // 📈 Get intraday stock data
  getIntraday(symbol: string = 'IBM'): Observable<any[]> {
    const url = `${this.baseUrl}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=5min&apikey=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        const timeSeries = res['Time Series (5min)'];

        if (!timeSeries) return [];

        const chartData = Object.keys(timeSeries).map(time => ({
          x: new Date(time),
          y: parseFloat(timeSeries[time]['1. open'])
        }));

        // sort ascending
        return chartData.sort((a, b) => a.x.getTime() - b.x.getTime());
      })
    );
  }

  // 📊 (Optional) Daily data
  getDaily(symbol: string = 'IBM'): Observable<any[]> {
    const url = `${this.baseUrl}?function=TIME_SERIES_DAILY&symbol=${symbol}&apikey=${this.apiKey}`;

    return this.http.get<any>(url).pipe(
      map(res => {
        const timeSeries = res['Time Series (Daily)'];

        if (!timeSeries) return [];

        const chartData = Object.keys(timeSeries).map(date => ({
          x: new Date(date),
          y: parseFloat(timeSeries[date]['1. open'])
        }));

        return chartData.sort((a, b) => a.x.getTime() - b.x.getTime());
      })
    );
  }
}