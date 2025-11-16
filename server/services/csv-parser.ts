import { z } from "zod";

// CSV Event validation schema
export const csvEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  summary: z.string().min(1, "Summary is required").max(300, "Summary must be 300 characters or less"),
  group: z.string().min(1, "Group is required").max(50, "Group must be 50 characters or less")
});

export type CsvEvent = z.infer<typeof csvEventSchema>;

export interface ParseResult {
  success: boolean;
  data?: CsvEvent[];
  errors?: string[];
  warnings?: string[];
}

export class CsvParserService {
  /**
   * Parse CSV content and validate events
   */
  public parseCsvContent(csvContent: string): ParseResult {
    try {
      const lines = csvContent.trim().split('\n');
      
      if (lines.length === 0) {
        return {
          success: false,
          errors: ['CSV file is empty']
        };
      }

      // Extract headers
      const headers = this.parseCSVLine(lines[0]);
      
      // Validate required headers
      const requiredHeaders = ['date', 'summary', 'group'];
      const missingHeaders = requiredHeaders.filter(header => 
        !headers.some(h => h.toLowerCase() === header.toLowerCase())
      );

      if (missingHeaders.length > 0) {
        return {
          success: false,
          errors: [`Missing required headers: ${missingHeaders.join(', ')}`]
        };
      }

      // Find header indices (case insensitive)
      const dateIndex = headers.findIndex(h => h.toLowerCase() === 'date');
      const summaryIndex = headers.findIndex(h => h.toLowerCase() === 'summary');
      const groupIndex = headers.findIndex(h => h.toLowerCase() === 'group');

      const events: CsvEvent[] = [];
      const errors: string[] = [];
      const warnings: string[] = [];

      // Process data rows (skip header)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (!line) {
          warnings.push(`Line ${i + 1}: Empty line skipped`);
          continue;
        }

        try {
          const values = this.parseCSVLine(line);
          
          if (values.length < Math.max(dateIndex, summaryIndex, groupIndex) + 1) {
            errors.push(`Line ${i + 1}: Insufficient columns`);
            continue;
          }

          const rawEvent = {
            date: values[dateIndex]?.trim() || '',
            summary: values[summaryIndex]?.trim() || '',
            group: values[groupIndex]?.trim() || ''
          };

          // Validate event
          const validationResult = csvEventSchema.safeParse(rawEvent);
          
          if (validationResult.success) {
            events.push(validationResult.data);
          } else {
            const fieldErrors = validationResult.error.errors
              .map(err => `${err.path.join('.')}: ${err.message}`)
              .join(', ');
            errors.push(`Line ${i + 1}: ${fieldErrors}`);
          }
        } catch (error) {
          errors.push(`Line ${i + 1}: Failed to parse line - ${(error as Error).message}`);
        }
      }

      // Check for duplicate dates
      const dateCountMap = new Map<string, number>();
      events.forEach(event => {
        const count = dateCountMap.get(event.date) || 0;
        dateCountMap.set(event.date, count + 1);
      });

      const duplicateDates = Array.from(dateCountMap.entries())
        .filter(([_, count]) => count > 1)
        .map(([date, count]) => `${date} (${count} times)`);

      if (duplicateDates.length > 0) {
        warnings.push(`Duplicate dates found: ${duplicateDates.join(', ')}`);
      }

      return {
        success: errors.length === 0,
        data: events,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      return {
        success: false,
        errors: [`Failed to parse CSV: ${(error as Error).message}`]
      };
    }
  }

  /**
   * Parse a single CSV line handling quoted fields and commas
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"';
          i += 2;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
          i++;
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
    
    // Add the last field
    result.push(current);
    
    return result;
  }

  /**
   * Validate date range for Bitcoin context
   */
  public validateDateRange(events: CsvEvent[]): string[] {
    const warnings: string[] = [];
    const bitcoinLaunchDate = new Date('2009-01-03');
    const currentDate = new Date();
    
    events.forEach(event => {
      const eventDate = new Date(event.date);
      
      if (eventDate < bitcoinLaunchDate) {
        warnings.push(`Date ${event.date} is before Bitcoin's launch (2009-01-03)`);
      }
      
      if (eventDate > currentDate) {
        warnings.push(`Date ${event.date} is in the future`);
      }
    });

    return warnings;
  }

  /**
   * Generate CSV template for users
   */
  public generateTemplate(): string {
    const headers = ['date', 'summary', 'group'];
    const sampleData = [
      ['2009-01-03', 'Bitcoin network launched by Satoshi Nakamoto', 'Launch'],
      ['2010-05-22', 'First commercial Bitcoin transaction - pizza purchase', 'Commerce'],
      ['2011-02-09', 'Bitcoin reaches parity with US dollar', 'Price']
    ];

    const csvLines = [
      headers.join(','),
      ...sampleData.map(row => row.map(cell => `"${cell}"`).join(','))
    ];

    return csvLines.join('\n');
  }

  /**
   * Estimate processing time and cost
   */
  public estimateProcessing(eventCount: number): {
    estimatedTime: string;
    batchCount: number;
    estimatedCost: string;
  } {
    const batchCount = Math.ceil(eventCount / 10);
    const timePerBatch = 30; // seconds
    const totalTimeSeconds = batchCount * timePerBatch;
    
    // Cost estimation (rough)
    const costPerEvent = 0.01; // $0.01 per event enhancement
    const estimatedCostValue = eventCount * costPerEvent;

    return {
      estimatedTime: this.formatDuration(totalTimeSeconds),
      batchCount,
      estimatedCost: `$${estimatedCostValue.toFixed(2)}`
    };
  }

  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
    return `${Math.ceil(seconds / 3600)} hours`;
  }
}

export const csvParser = new CsvParserService();