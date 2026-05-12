export interface Test {
  id: number;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  symbol?: string;  
   data: ChartDataPoint[]; 
  chartData?: ChartDataPoint[];
  dataFile?: {
    name: string;
    type: 'csv' | 'excel' | 'json';
    data: any[];
  };
  timeframe?: string;        // Optional: Daily, Weekly, Monthly
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';  // Difficulty level
  status?: 'active' | 'archived' | 'draft';               // Test status
  passingScore?: number;      // Minimum passing score (0-100)
  timeLimit?: number;         // Time limit in minutes
  totalPoints?: number;       // Total points available
  
}

export type CreateTestDTO = Omit<Test, 'id' | 'createdAt' | 'updatedAt'>;

// Optional: Create a type for updating tests
export type UpdateTestDTO = Partial<Omit<Test, 'id' | 'createdAt' | 'updatedAt'>>;


export interface ChartDataPoint {
  time: number;  // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}