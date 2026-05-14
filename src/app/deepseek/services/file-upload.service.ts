// services/file-upload.service.ts

import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ChartDataPoint {
  time: number;      // Unix timestamp (seconds, UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

@Injectable({ providedIn: 'root' })
export class FileUploadService {

  /**
   * Parse any date/time value into a Unix timestamp (seconds).
   * Works in all browsers, including Safari and Linux.
   */
  private parseDateToTimestamp(dateValue: any): number {
    if (dateValue == null || dateValue === '') return NaN;

    // Already a number
    if (typeof dateValue === 'number') {
      // Excel serial date (days since 1900) is usually < 100000
      if (dateValue < 100000 && dateValue > 0 && !String(dateValue).includes('.')) {
        const excelEpoch = 25569; // days from 1900-01-01 to 1970-01-01
        const seconds = (dateValue - excelEpoch) * 86400;
        return Math.floor(seconds);
      }
      // Assume it's already a Unix timestamp (seconds or milliseconds)
      if (dateValue > 1e11) return Math.floor(dateValue / 1000);
      if (dateValue > 1e9) return dateValue;
      return NaN;
    }

    const str = String(dateValue).trim();
    if (str === '') return NaN;

    // Try as integer (maybe Excel serial)
    const asNumber = Number(str);
    if (!isNaN(asNumber) && asNumber > 0 && asNumber < 100000 && str.indexOf('.') === -1) {
      const excelEpoch = 25569;
      const seconds = (asNumber - excelEpoch) * 86400;
      return Math.floor(seconds);
    }

    // Try to parse common date formats
    let parts: string[] = [];
    let separator = '';
    if (str.includes('-')) separator = '-';
    else if (str.includes('/')) separator = '/';
    else if (str.includes('.')) separator = '.';

    if (separator) {
      parts = str.split(separator);
      let year = 0, month = 0, day = 0;

      if (parts.length === 3) {
        const first = parseInt(parts[0], 10);
        const second = parseInt(parts[1], 10);
        const third = parseInt(parts[2], 10);

        // YYYY-MM-DD
        if (first > 31) {
          year = first;
          month = second - 1;
          day = third;
        }
        // DD/MM/YYYY
        else if (second > 12) {
          year = third;
          month = second - 1;
          day = first;
        }
        // MM/DD/YYYY
        else {
          // Try both: assume MM/DD/YYYY first
          const date1 = new Date(Date.UTC(third, first - 1, second));
          if (!isNaN(date1.getTime())) {
            return Math.floor(date1.getTime() / 1000);
          }
          // Fallback to DD/MM/YYYY
          const date2 = new Date(Date.UTC(third, second - 1, first));
          if (!isNaN(date2.getTime())) {
            return Math.floor(date2.getTime() / 1000);
          }
          return NaN;
        }
      }

      if (year && month !== undefined && day) {
        const utcDate = new Date(Date.UTC(year, month, day));
        if (!isNaN(utcDate.getTime())) {
          return Math.floor(utcDate.getTime() / 1000);
        }
      }
    }

    // Last resort: native Date (may still fail in Safari, but we tried)
    const nativeDate = new Date(str);
    if (!isNaN(nativeDate.getTime())) {
      return Math.floor(nativeDate.getTime() / 1000);
    }

    console.warn(`[FileUpload] Cannot parse date: "${str}"`);
    return NaN;
  }

  /**
   * Convert raw rows (from CSV/Excel/JSON) into ChartDataPoint[]
   */
  private normalizeChartData(rawData: any[]): ChartDataPoint[] {
    if (!rawData || rawData.length === 0) return [];

    const result: ChartDataPoint[] = [];
    let startIndex = 0;

    // Detect header row
    const firstRow = rawData[0];
    let headers: string[] = [];
    if (firstRow && Array.isArray(firstRow)) {
      const hasDateHeader = firstRow.some(cell =>
        typeof cell === 'string' && /date|time|datetime/i.test(cell)
      );
      if (hasDateHeader) {
        startIndex = 1;
        headers = firstRow.map((h: any) => String(h).toLowerCase());
      }
    }

    for (let i = startIndex; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length < 5) continue;

      // Map column indexes using headers if available
      let dateIdx = 0, openIdx = 1, highIdx = 2, lowIdx = 3, closeIdx = 4, volumeIdx = -1;
      if (headers.length) {
        dateIdx = headers.findIndex(h => /date|time|datetime/.test(h));
        openIdx = headers.findIndex(h => /open|o\b/.test(h));
        highIdx = headers.findIndex(h => /high|h\b/.test(h));
        lowIdx = headers.findIndex(h => /low|l\b/.test(h));
        closeIdx = headers.findIndex(h => /close|c\b|price|value/.test(h));
        volumeIdx = headers.findIndex(h => /volume|vol/.test(h));
        if (dateIdx === -1) dateIdx = 0;
        if (openIdx === -1) openIdx = 1;
        if (highIdx === -1) highIdx = 2;
        if (lowIdx === -1) lowIdx = 3;
        if (closeIdx === -1) closeIdx = 4;
      }

      const timestamp = this.parseDateToTimestamp(row[dateIdx]);
      if (isNaN(timestamp)) continue;

      const open = parseFloat(row[openIdx]);
      const high = parseFloat(row[highIdx]);
      const low = parseFloat(row[lowIdx]);
      const close = parseFloat(row[closeIdx]);
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) continue;

      const volume = volumeIdx >= 0 ? parseFloat(row[volumeIdx]) : 0;

      result.push({
        time: timestamp,
        open, high, low, close,
        volume: isNaN(volume) ? 0 : volume
      });
    }

    // Sort by time ascending
    result.sort((a, b) => a.time - b.time);
    console.log(`[FileUpload] Normalized ${result.length} candles. First: ${result[0]?.time}`);
    return result;
  }

  // ========== PUBLIC METHODS ==========

  async parseFile(file: File): Promise<ChartDataPoint[]> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'csv') return this.parseCSV(file);
    if (ext === 'xlsx' || ext === 'xls') return this.parseExcel(file);
    if (ext === 'json') return this.parseJSON(file);
    throw new Error('Unsupported file format');
  }

  private parseCSV(file: File): Promise<ChartDataPoint[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (result) => {
          try {
            const parsed = this.normalizeChartData(result.data as any[]);
            resolve(parsed);
          } catch (err) { reject(err); }
        },
        error: (err) => reject(err)
      });
    });
  }

  private parseExcel(file: File): Promise<ChartDataPoint[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
          const parsed = this.normalizeChartData(rows as any[]);
          resolve(parsed);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Excel read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  private parseJSON(file: File): Promise<ChartDataPoint[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const json = JSON.parse(e.target.result);
          let dataArray: any[] = [];
          if (Array.isArray(json)) {
            dataArray = json;
          } else {
            // Assume Alpha Vantage format
            for (const key in json) {
              const item = json[key];
              dataArray.push({
                time: key,
                open: item['1. open'],
                high: item['2. high'],
                low: item['3. low'],
                close: item['4. close'],
                volume: item['5. volume'] || 0
              });
            }
          }
          const parsed = this.normalizeChartData(dataArray);
          resolve(parsed);
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('JSON read failed'));
      reader.readAsText(file);
    });
  }
}