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
   * Universal date parser – works on Safari, Firefox, Chrome, Edge.
   * Supports:
   * - ISO 8601: "2024-01-15" or "2024-01-15T10:30:00Z"
   * - "YYYY-MM-DD HH:MM:SS" (space replaced with T)
   * - "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "MM-DD-YYYY"
   * - Excel serial numbers (days since 1900)
   * - Unix timestamps (seconds or milliseconds)
   */
  // private parseDateToTimestamp(dateValue: any): number {
  //   if (dateValue == null || dateValue === '') return NaN;

  //   // Already a number
  //   if (typeof dateValue === 'number') {
  //     // Excel serial date (days since 1900) is usually < 100000
  //     if (dateValue < 100000 && dateValue > 0 && !String(dateValue).includes('.')) {
  //       const excelEpoch = 25569; // days from 1900-01-01 to 1970-01-01
  //       const seconds = (dateValue - excelEpoch) * 86400;
  //       return Math.floor(seconds);
  //     }
  //     // Unix timestamp (seconds or milliseconds)
  //     if (dateValue > 1e11) return Math.floor(dateValue / 1000);
  //     if (dateValue > 1e9) return dateValue;
  //     return NaN;
  //   }

  //   let str = String(dateValue).trim();
  //   if (str === '') return NaN;

  //   // Try as integer (Excel serial as string)
  //   const asNumber = Number(str);
  //   if (!isNaN(asNumber) && asNumber > 0 && asNumber < 100000 && !str.includes('.')) {
  //     const excelEpoch = 25569;
  //     const seconds = (asNumber - excelEpoch) * 86400;
  //     return Math.floor(seconds);
  //   }

  //   // Replace space with 'T' for ISO-like strings (fixes Safari)
  //   if (str.includes(' ') && (str.includes('-') || str.includes('/'))) {
  //     str = str.replace(' ', 'T');
  //   }

  //   // Try native Date.parse (works for ISO 8601 after replacing space)
  //   let timestamp = Date.parse(str);
  //   if (!isNaN(timestamp)) {
  //     return Math.floor(timestamp / 1000);
  //   }

  //   // Manually parse common formats: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, etc.
  //   const parts: string[] = [];
  //   let separator = '';
  //   if (str.includes('-')) separator = '-';
  //   else if (str.includes('/')) separator = '/';
  //   else if (str.includes('.')) separator = '.';

  //   if (separator) {
  //     const [p1, p2, p3] = str.split(separator);
  //     let year = 0, month = 0, day = 0;
  //     if (p3 && p3.length === 4) {
  //       year = parseInt(p3, 10);
  //       // Try DD/MM/YYYY first
  //       month = parseInt(p2, 10) - 1;
  //       day = parseInt(p1, 10);
  //       let d = new Date(Date.UTC(year, month, day));
  //       if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  //       // Then try MM/DD/YYYY
  //       month = parseInt(p1, 10) - 1;
  //       day = parseInt(p2, 10);
  //       d = new Date(Date.UTC(year, month, day));
  //       if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  //     } else if (p1 && p1.length === 4) {
  //       // YYYY-MM-DD
  //       year = parseInt(p1, 10);
  //       month = parseInt(p2, 10) - 1;
  //       day = parseInt(p3, 10);
  //       const d = new Date(Date.UTC(year, month, day));
  //       if (!isNaN(d.getTime())) return Math.floor(d.getTime() / 1000);
  //     }
  //   }

  //   // Last resort: try original string
  //   const lastTry = new Date(str);
  //   if (!isNaN(lastTry.getTime())) {
  //     return Math.floor(lastTry.getTime() / 1000);
  //   }

  //   console.warn(`[FileUpload] Cannot parse date: "${dateValue}"`);
  //   return NaN;
  // }
  private parseDateToTimestamp(dateValue: any): number {

    if (dateValue == null || dateValue === '') {
      return NaN;
    }

    // Number handling
    if (typeof dateValue === 'number') {

      // Excel serial date
      if (dateValue > 0 && dateValue < 100000) {

        const excelEpoch = 25569;

        return Math.floor(
          (dateValue - excelEpoch) * 86400
        );
      }

      // Milliseconds
      if (dateValue > 1e11) {
        return Math.floor(dateValue / 1000);
      }

      // Seconds
      if (dateValue > 1e9) {
        return Math.floor(dateValue);
      }

      return NaN;
    }

    let str = String(dateValue).trim();

    if (!str) {
      return NaN;
    }

    /**
     * Convert:
     * 2015.04.01 00:08:00
     * =>
     * 2015-04-01T00:08:00
     */
    str = str
      .replace(/\./g, '-')
      .replace(' ', 'T');

    const date = new Date(str);

    if (isNaN(date.getTime())) {

      console.warn(
        '[FileUpload] Cannot parse date:',
        dateValue
      );

      return NaN;
    }

    return Math.floor(date.getTime() / 1000);
  }

  /**
   * Public method to normalize raw data (called from chart component)
   */
  public normalizeChartData(rawData: any[]): ChartDataPoint[] {
    return this._normalizeChartData(rawData);
  }

  /**
   * Private implementation – converts raw rows (from CSV/Excel/JSON) into ChartDataPoint[]
   */
  private _normalizeChartData(rawData: any[]): ChartDataPoint[] {
    if (!rawData || rawData.length === 0) {
      console.warn('[FileUpload] normalizeChartData: empty rawData');
      return [];
    }

    const result: ChartDataPoint[] = [];
    let startIndex = 0;

    // Detect header row: if first row contains any non-numeric strings resembling date/price headers
    const firstRow = rawData[0];
    let headers: string[] = [];
    let isFirstRowHeader = false;

    if (firstRow && Array.isArray(firstRow)) {
      const hasDateHeader = firstRow.some(cell =>
        typeof cell === 'string' && /date|time|datetime/i.test(cell)
      );
      if (hasDateHeader) {
        startIndex = 1;
        headers = firstRow.map((h: any) => String(h).toLowerCase());
        isFirstRowHeader = true;
      }
    }

    console.log(`[FileUpload] Detected header: ${isFirstRowHeader}, startIndex=${startIndex}, rows total=${rawData.length}`);

    for (let i = startIndex; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !Array.isArray(row) || row.length < 5) {
        console.debug(`[FileUpload] Skipping row ${i}: not enough columns`, row);
        continue;
      }

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

      const rawDate = row[dateIdx];
      const timestamp = this.parseDateToTimestamp(rawDate);
      if (isNaN(timestamp)) {
        console.debug(`[FileUpload] Row ${i}: invalid date`, rawDate);
        continue;
      }

      const open = parseFloat(row[openIdx]);
      const high = parseFloat(row[highIdx]);
      const low = parseFloat(row[lowIdx]);
      const close = parseFloat(row[closeIdx]);
      if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
        console.debug(`[FileUpload] Row ${i}: invalid OHLC`, { open, high, low, close });
        continue;
      }

      const volume = volumeIdx >= 0 ? parseFloat(row[volumeIdx]) : 0;

      result.push({
        time: timestamp,
        open, high, low, close,
        volume: isNaN(volume) ? 0 : volume
      });
    }

    // Sort by time ascending
    result.sort((a, b) => a.time - b.time);
    console.log(`[FileUpload] Normalized ${result.length} candles. First time: ${result[0]?.time}, Last time: ${result[result.length - 1]?.time}`);
    return result;
  }

  // ========== PUBLIC METHODS ==========
  async parseFile(file: File): Promise<ChartDataPoint[]> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    console.log(`[FileUpload] Parsing ${file.name}, extension=${ext}`);
    let parsed: ChartDataPoint[] = [];
    if (ext === 'csv') parsed = await this.parseCSV(file);
    else if (ext === 'xlsx' || ext === 'xls') parsed = await this.parseExcel(file);
    else if (ext === 'json') parsed = await this.parseJSON(file);
    else throw new Error('Unsupported file format');

    if (parsed.length === 0) {
      console.error('[FileUpload] No valid candles extracted. Check file format and date columns.');
    }
    return parsed;
  }

  private parseCSV(file: File): Promise<ChartDataPoint[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (result) => {
          try {
            const parsed = this._normalizeChartData(result.data as any[]);
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
          const parsed = this._normalizeChartData(rows as any[]);
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
          let rowsArray: any[][] = [];

          if (Array.isArray(json)) {
            if (json.length === 0) {
              resolve([]);
              return;
            }
            // If the first element is an array, assume it's already in row format
            if (Array.isArray(json[0])) {
              rowsArray = json;
            } else {
              // Convert array of objects to rows with header
              const keys = Object.keys(json[0]);
              rowsArray.push(keys); // header row
              for (const obj of json) {
                rowsArray.push(keys.map(k => obj[k]));
              }
            }
          } else if (typeof json === 'object' && json !== null) {
            // Alpha Vantage format: object with date keys
            const dataArray: any[] = [];
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
            if (dataArray.length) {
              const keys = ['time', 'open', 'high', 'low', 'close', 'volume'];
              rowsArray.push(keys);
              for (const obj of dataArray) {
                rowsArray.push(keys.map(k => obj[k]));
              }
            }
          }

          if (rowsArray.length === 0) {
            resolve([]);
            return;
          }

          // Now rowsArray is an array of arrays with an optional header row
          const parsed = this._normalizeChartData(rowsArray);
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('JSON read failed'));
      reader.readAsText(file);
    });
  }
}