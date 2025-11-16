/**
 * Comprehensive Refactoring Utilities
 * Collection of utility functions to reduce code duplication and improve maintainability
 */

import { Request, Response, NextFunction } from 'express';
import { createErrorResponse } from './error-handler';

// Generic async route handler wrapper
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      const errorResponse = createErrorResponse(error);
      res.status(errorResponse.statusCode).json(errorResponse.error);
    });
  };
}

// Validation helper for route parameters
export function validateDateParam(dateStr: string): boolean {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateStr)) return false;
  
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date.getTime());
}

export function validateYearParam(year: string | number): boolean {
  const yearNum = typeof year === 'string' ? parseInt(year) : year;
  return !isNaN(yearNum) && yearNum >= 2008 && yearNum <= new Date().getFullYear();
}

// Cache key generators
export const cacheKeys = {
  analysisDate: (date: string) => `/api/analysis/date/${date}`,
  analysisYear: (year: number) => `/api/analysis/year/${year}`,
  analysisStats: () => '/api/analysis/stats',
  newsDate: (date: string) => `/api/news/fetch/${date}`,
  health: () => '/api/health/status'
};

// Common response formats
export const responseFormats = {
  success: (data: any, message?: string) => ({
    success: true,
    data,
    ...(message && { message })
  }),
  
  error: (message: string, code?: string, details?: any) => ({
    success: false,
    error: {
      message,
      ...(code && { code }),
      ...(details && { details })
    }
  }),
  
  pagination: (data: any[], page: number, limit: number, total: number) => ({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  })
};

// Input sanitization helpers
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    return input.trim().replace(/[<>]/g, '');
  }
  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  return input;
}

// Performance monitoring helpers
export function createPerformanceTimer() {
  const start = Date.now();
  return {
    end: () => Date.now() - start,
    elapsed: () => Date.now() - start
  };
}

// Rate limiting helper
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  
  constructor(
    private maxRequests: number = 100,
    private windowMs: number = 60000 // 1 minute
  ) {}
  
  isAllowed(identifier: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(identifier)) {
      this.requests.set(identifier, []);
    }
    
    const userRequests = this.requests.get(identifier)!;
    
    // Remove old requests outside the window
    const validRequests = userRequests.filter(time => time > windowStart);
    this.requests.set(identifier, validRequests);
    
    // Check if under limit
    if (validRequests.length < this.maxRequests) {
      validRequests.push(now);
      return true;
    }
    
    return false;
  }
  
  reset(identifier?: string) {
    if (identifier) {
      this.requests.delete(identifier);
    } else {
      this.requests.clear();
    }
  }
}

// Memory usage tracker
export function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100,
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100,
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100,
    external: Math.round(usage.external / 1024 / 1024 * 100) / 100
  };
}