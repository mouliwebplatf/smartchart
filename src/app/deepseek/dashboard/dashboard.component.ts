import { Component, OnInit, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';
import { TestService } from '../services/test.service';
import {
  FileUploadService,
  ChartDataPoint
} from '../services/file-upload.service';
import { DrawingService } from '../services/drawing.service';   // ← ADD THIS

import { Test } from '../models/test.model';
import { exportStorageToFile, runStorageDebug } from '../debug/storage-debug.util';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  tests: Test[] = [];
  userRole: string | null = null;
  showAddModal = false;
  showEditModal = false;
  selectedTest: Test | null = null;
  isLoadingTests = false;

  // Add Test Form
  newTest = {
    name: '',
    description: '',
    data: '',
    selectedFile: null as File | null,
    fileError: '',
    fileProgress: 0,
    isUploading: false,
    isProcessing: false,
    statusMessage: ''
  };

  // Edit Form
  editTest = {
    name: '',
    description: ''
  };

  constructor(
    private router: Router,
    private authService: AuthService,
    private testService: TestService,
    private fileUploadService: FileUploadService,
    private drawingService: DrawingService,   // ← ADD THIS
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.userRole = this.authService.getRole();
    this.loadTests();
  }

  loadTests(): void {
    this.isLoadingTests = true;
    this.testService.getTests().subscribe({
      next: (tests) => {
        this.tests = tests;
        this.isLoadingTests = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Failed to load tests', err);
        this.isLoadingTests = false;
        this.showMessage('Failed to load tests', 'error');
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: any): void {
    const file = event.target.files?.[0];
    if (!file) return;

    this.newTest.fileError = '';
    this.validateFile(file);

    if (!this.newTest.fileError) {
      this.newTest.selectedFile = file;
    }
    this.cdr.detectChanges();
  }

  validateFile(file: File): void {
    const validExtensions = ['csv', 'xlsx', 'xls', 'json'];
    const extension = file.name.split('.').pop()?.toLowerCase() || '';

    if (!validExtensions.includes(extension)) {
      this.newTest.fileError = 'Only CSV, Excel, or JSON files are allowed';
      return;
    }

    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      this.newTest.fileError = 'File size must be less than 50MB';
    }
  }

  async addTest(): Promise<void> {
    this.newTest.fileError = '';
    this.newTest.statusMessage = '';

    if (!this.newTest.name.trim()) {
      this.newTest.fileError = 'Test name is required';
      this.cdr.detectChanges();
      return;
    }

    if (!this.newTest.description.trim()) {
      this.newTest.fileError = 'Description is required';
      this.cdr.detectChanges();
      return;
    }

    if (!this.newTest.selectedFile) {
      this.newTest.fileError = 'Please select a file';
      this.cdr.detectChanges();
      return;
    }

    try {
      this.newTest.isProcessing = true;
      this.newTest.isUploading = true;
      this.newTest.statusMessage = 'Starting file processing...';
      this.newTest.fileProgress = 5;
      this.cdr.detectChanges();

      console.log('Starting file processing...');

      this.newTest.statusMessage = 'Parsing file...';
      this.newTest.fileProgress = 10;
      this.cdr.detectChanges();
      
      const parsedData = await this.fileUploadService.parseFile(this.newTest.selectedFile);

      console.log('Parsed data sample:', parsedData.slice(0, 3));
      console.log('Total parsed items:', parsedData.length);

      this.newTest.fileProgress = 40;
      this.newTest.statusMessage = 'Validating data format...';
      this.cdr.detectChanges();

      if (!parsedData || parsedData.length === 0) {
        throw new Error('No valid chart data found');
      }

      let chartData = parsedData;
      
      if (chartData[0]) {
        const hasRequiredFields = 'time' in chartData[0] && 
                                  'open' in chartData[0] && 
                                  'high' in chartData[0] && 
                                  'low' in chartData[0] && 
                                  'close' in chartData[0];
        
        if (!hasRequiredFields) {
          throw new Error('File missing required fields: time, open, high, low, close');
        }
        
        console.log('Data format validation passed');
      }

      this.newTest.fileProgress = 60;
      this.newTest.statusMessage = 'Optimizing dataset...';
      this.cdr.detectChanges();

      if (parsedData.length > 3000) {
        chartData = this.sampleLargeDataset(parsedData, 3000);
        console.warn(`Dataset reduced from ${parsedData.length} to ${chartData.length}`);
        this.newTest.statusMessage = `Dataset optimized: ${chartData.length} candles ready`;
      } else {
        this.newTest.statusMessage = `${chartData.length} candles ready for upload`;
      }

      this.newTest.fileProgress = 75;
      this.newTest.statusMessage = 'Preparing data for upload...';
      this.cdr.detectChanges();

      const testData = {
        name: this.newTest.name,
        description: this.newTest.description,
        data: chartData
      };

      console.log('Sending to service:', {
        name: testData.name,
        description: testData.description,
        dataLength: testData.data.length
      });

      this.newTest.fileProgress = 85;
      this.newTest.statusMessage = 'Uploading to server...';
      this.cdr.detectChanges();

      this.testService.addTest(testData).subscribe({
        next: () => {
          console.log('Test saved successfully');
          
          this.newTest.fileProgress = 100;
          this.newTest.statusMessage = 'Complete!';
          this.cdr.detectChanges();
          
          this.showMessage(
            `✓ Test created successfully with ${chartData.length} candles`,
            'success'
          );
          
          setTimeout(() => {
            this.newTest.isUploading = false;
            this.newTest.isProcessing = false;
            this.newTest.fileProgress = 0;
            this.newTest.statusMessage = '';
            this.showAddModal = false;
            this.loadTests();
            setTimeout(() => {
              this.resetForm();
              this.resetFileInput();
              this.cdr.detectChanges();
            }, 100);
            this.cdr.detectChanges();
          }, 500);
        },
        error: (err) => {
          console.error('Save error:', err);
          this.newTest.isUploading = false;
          this.newTest.isProcessing = false;
          this.newTest.fileProgress = 0;
          this.newTest.fileError = 'Failed to save chart data: ' + err.message;
          this.newTest.statusMessage = '';
          this.cdr.detectChanges();
        }
      });

    } catch (error: any) {
      console.error('Processing error:', error);
      this.newTest.isUploading = false;
      this.newTest.isProcessing = false;
      this.newTest.fileProgress = 0;
      this.newTest.fileError = error?.message || 'File processing failed';
      this.newTest.statusMessage = '';
      this.cdr.detectChanges();
    }
  }

  private sampleLargeDataset(data: ChartDataPoint[], targetSize: number): ChartDataPoint[] {
    if (data.length <= targetSize) return data;
    const sampled: ChartDataPoint[] = [];
    const bucketSize = data.length / targetSize;
    for (let i = 0; i < targetSize; i++) {
      const index = Math.floor(i * bucketSize);
      sampled.push(data[index]);
    }
    return sampled;
  }

  openChart(testId: number): void {
    this.router.navigate([`/${this.userRole}/chart`, testId]);
  }

  editTests(test: Test): void {
    this.selectedTest = test;
    this.editTest = {
      name: test.name,
      description: test.description
    };
    this.showEditModal = true;
    this.cdr.detectChanges();
  }

  updateTest(): void {
    if (!this.selectedTest || !this.editTest.name.trim() || !this.editTest.description.trim()) {
      this.showMessage('Please fill in all fields', 'error');
      return;
    }

    this.testService.updateTest(this.selectedTest.id, this.editTest).subscribe({
      next: () => {
        this.showEditModal = false;
        this.selectedTest = null;
        this.loadTests();
        this.showMessage('Test updated successfully', 'success');
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error(err);
        this.showMessage('Failed to update test', 'error');
        this.cdr.detectChanges();
      }
    });
  }

  // =====================================================
  // DELETE TEST – ALSO REMOVE ALL DRAWING DATA
  // =====================================================
 deleteTest(testId: number): void {
  const confirmed = confirm('Are you sure you want to delete this test? All associated drawing data (admin & user lines) will be permanently removed.');
  if (!confirmed) return;

  // Clear all drawing data for this testId using the DrawingService
  this.drawingService.clearAdminLines(testId).subscribe({
    next: () => {
      console.log(`Admin lines cleared for test ${testId}`);
    },
    error: (err) => console.error('Error clearing admin lines', err)
  });

  this.drawingService.clearAllUserLines(testId).subscribe({
    next: () => {
      console.log(`User lines cleared for test ${testId}`);
    },
    error: (err) => console.error('Error clearing user lines', err)
  });

  // Now delete the test from the test service
  this.testService.deleteTest(testId).subscribe({
    next: () => {
      this.loadTests();
      this.showMessage('Test and all its drawing data deleted successfully', 'success');
      this.cdr.detectChanges();
    },
    error: (err) => {
      console.error(err);
      this.showMessage('Failed to delete test', 'error');
      this.cdr.detectChanges();
    }
  });
}

  closeAddModal(): void {
    if (this.newTest.isProcessing || this.newTest.isUploading) {
      const confirmClose = confirm('Upload in progress. Are you sure you want to cancel?');
      if (!confirmClose) return;
    }
    this.showAddModal = false;
    this.resetForm();
    this.resetFileInput();
    this.cdr.detectChanges();
  }

  closeEditModal(): void {
    this.showEditModal = false;
    this.selectedTest = null;
    this.editTest = { name: '', description: '' };
    this.cdr.detectChanges();
  }

  onModalBackgroundClick(event: MouseEvent, modalType: string): void {
    const target = event.target as HTMLElement;
    if (target.classList.contains('modal')) {
      if (modalType === 'add') this.closeAddModal();
      else if (modalType === 'edit') this.closeEditModal();
    }
  }

  removeSelectedFile(): void {
    this.newTest.selectedFile = null;
    this.newTest.fileError = '';
    this.resetFileInput();
    this.cdr.detectChanges();
  }

  private resetForm(): void {
    this.newTest = {
      name: '',
      description: '',
      data: '',
      selectedFile: null,
      fileError: '',
      fileProgress: 0,
      isUploading: false,
      isProcessing: false,
      statusMessage: ''
    };
    this.cdr.detectChanges();
  }

  private resetFileInput(): void {
    if (this.fileInput) this.fileInput.nativeElement.value = '';
    this.newTest.selectedFile = null;
    this.newTest.fileError = '';
    this.cdr.detectChanges();
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info'): void {
    console.log(`${type.toUpperCase()}: ${msg}`);
    alert(msg);
  }

  debugStoredData(): void {
    const stored = localStorage.getItem('tests');
    if (stored) {
      const tests = JSON.parse(stored);
      console.log('Stored tests:', tests);
      tests.forEach((test: Test, index: number) => {
        console.log(`Test ${index + 1}: ${test.name}`, {
          dataLength: test.data?.length,
          sampleData: test.data?.slice(0, 2),
          hasValidData: test.data && test.data.length > 0
        });
      });
    } else {
      console.log('No stored tests found');
    }
  }
}