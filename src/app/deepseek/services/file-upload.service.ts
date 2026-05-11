// services/file-upload.service.ts

import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import * as Papa from 'papaparse';

export interface ChartDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

@Injectable({
  providedIn: 'root'
})
export class FileUploadService {

  /**
   * MAIN FILE PARSER
   */
  async parseFile(file: File): Promise<ChartDataPoint[]> {

    const extension =
      file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {

      return this.parseCSV(file);

    } else if (
      extension === 'xlsx' ||
      extension === 'xls'
    ) {

      return this.parseExcel(file);

    } else if (extension === 'json') {

      return this.parseJSON(file);

    } else {

      throw new Error(
        'Unsupported file format'
      );
    }
  }

  /**
   * CSV PARSER
   */
  private parseCSV(
    file: File
  ): Promise<ChartDataPoint[]> {

    return new Promise((resolve, reject) => {

      Papa.parse(file, {

        header: false,

        skipEmptyLines: true,

        complete: (result) => {

          try {

            const rows =
              result.data as any[];

            const parsed =
              this.normalizeChartData(rows);

            resolve(parsed);

          } catch (err) {

            reject(err);
          }
        },

        error: (err) => reject(err)
      });
    });
  }

  /**
   * EXCEL PARSER
   */
  private parseExcel(
    file: File
  ): Promise<ChartDataPoint[]> {

    return new Promise((resolve, reject) => {

      const reader = new FileReader();

      reader.onload = (e: any) => {

        try {

          const data =
            new Uint8Array(e.target.result);

          const workbook = XLSX.read(data, {
            type: 'array'
          });

          const sheet =
            workbook.Sheets[
              workbook.SheetNames[0]
            ];

          const rows =
            XLSX.utils.sheet_to_json(sheet, {

              header: 1,

              raw: true,

              defval: ''
            });

          const parsed =
            this.normalizeChartData(
              rows as any[]
            );

          resolve(parsed);

        } catch (err) {

          reject(err);
        }
      };

      reader.onerror = () => {

        reject(
          new Error('Excel read failed')
        );
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * JSON PARSER
   */
  private parseJSON(
    file: File
  ): Promise<ChartDataPoint[]> {

    return new Promise((resolve, reject) => {

      const reader = new FileReader();

      reader.onload = (e: any) => {

        try {

          const json =
            JSON.parse(e.target.result);

          // ALREADY ARRAY FORMAT
          if (Array.isArray(json)) {

            resolve(json);

            return;
          }

          // ALPHA VANTAGE FORMAT
          const result: ChartDataPoint[] = [];

          Object.keys(json).forEach((key) => {

            const item = json[key];

            result.push({

              time: Math.floor(
                new Date(key).getTime() / 1000
              ),

              open: parseFloat(
                item['1. open']
              ),

              high: parseFloat(
                item['2. high']
              ),

              low: parseFloat(
                item['3. low']
              ),

              close: parseFloat(
                item['4. close']
              ),

              volume: parseFloat(
                item['5. volume'] || 0
              )
            });
          });

          resolve(result);

        } catch (err) {

          reject(err);
        }
      };

      reader.onerror = () => {

        reject(
          new Error('JSON read failed')
        );
      };

      reader.readAsText(file);
    });
  }

  /**
   * FAST NORMALIZER
   *
   * FORMAT:
   * Date | Time | Open | High | Low | Close | Volume
   */
// file-upload.service.ts - Add validation to normalizeChartData
private normalizeChartData(rawData: any[]): ChartDataPoint[] {
  if (!rawData || rawData.length === 0) {
    return [];
  }

  const result: ChartDataPoint[] = [];
  let startIndex = 0;

  // Auto-detect header row
  const firstRow = rawData[0];
  if (firstRow && typeof firstRow[0] === 'string' && 
      firstRow[0].toLowerCase().includes('date')) {
    startIndex = 1;
  }

  for (let i = startIndex; i < rawData.length; i++) {
    const row = rawData[i];
    
    if (!row || row.length < 6) {
      continue;
    }

    // Try different column mappings
    let dateCol = 0, timeCol = 1, openCol = 2, highCol = 3, lowCol = 4, closeCol = 5;
    
    // Auto-detect if first column contains both date and time
    const firstColValue = String(row[0]);
    if (firstColValue.includes(' ') || firstColValue.includes('T')) {
      // Combined date-time in first column
      const dateTime = new Date(firstColValue);
      if (!isNaN(dateTime.getTime())) {
        const timestamp = Math.floor(dateTime.getTime() / 1000);
        result.push({
          time: timestamp,
          open: parseFloat(row[1]),
          high: parseFloat(row[2]),
          low: parseFloat(row[3]),
          close: parseFloat(row[4]),
          volume: row[5] ? parseFloat(row[5]) : 0
        });
        continue;
      }
    }
    
    // Standard format with separate date and time columns
    const date = row[dateCol];
    const time = row[timeCol];
    const open = parseFloat(row[openCol]);
    const high = parseFloat(row[highCol]);
    const low = parseFloat(row[lowCol]);
    const close = parseFloat(row[closeCol]);
    const volume = parseFloat(row[6] || 0);

    let dateTimeStr = `${date} ${time}`;
    let timestamp = Math.floor(new Date(dateTimeStr).getTime() / 1000);
    
    // If that fails, try just the date
    if (isNaN(timestamp)) {
      timestamp = Math.floor(new Date(date).getTime() / 1000);
    }

    if (isNaN(timestamp) || isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      console.warn(`Skipping invalid row ${i}:`, row);
      continue;
    }

    result.push({
      time: timestamp,
      open,
      high,
      low,
      close,
      volume
    });
  }

  console.log(`Normalized ${result.length} valid data points`);
  return result;
}

  /**
   * CONVERT TO TIME SERIES FORMAT
   */
  convertToTimeSeriesFormat(
    candles: ChartDataPoint[]
  ): any {

    const result: any = {};

    candles.forEach((candle) => {

      const date =
        new Date(candle.time * 1000);

      const iso =
        date.toISOString();

      const key =
        `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

      result[key] = {

        '1. open':
          candle.open.toFixed(4),

        '2. high':
          candle.high.toFixed(4),

        '3. low':
          candle.low.toFixed(4),

        '4. close':
          candle.close.toFixed(4),

        '5. volume':
          String(candle.volume || 0)
      };
    });

    return result;
  }

  /**
   * DOWNLOAD JSON
   */
  downloadAsJson(
    data: any,
    filename = 'chart-data.json'
  ): void {

    const blob = new Blob(

      [
        JSON.stringify(
          data,
          null,
          2
        )
      ],

      {
        type: 'application/json'
      }
    );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement('a');

    a.href = url;

    a.download = filename;

    a.click();

    URL.revokeObjectURL(url);
  }
}