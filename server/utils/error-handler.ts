/**
 * Centralized Error Handling Utilities
 * Provides consistent error handling across the application
 */

export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: any;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 500, code?: string, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'AppError';
  }
}

export function handleError(error: unknown): ApiError {
  if (error instanceof AppError) {
    return {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      statusCode: 500
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      statusCode: 500
    };
  }

  return {
    message: 'An unexpected error occurred',
    statusCode: 500,
    details: error
  };
}

export function createErrorResponse(error: unknown) {
  const { message, statusCode, code, details } = handleError(error);
  return {
    error: {
      message,
      code,
      ...(details && { details })
    },
    statusCode: statusCode || 500
  };
}