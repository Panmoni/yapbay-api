import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';

export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  network?: string;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T> {
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export const sendSuccess = <T>(res: Response, data: T, message?: string, statusCode: number = 200): void => {
  res.status(statusCode).json({
    success: true,
    data,
    ...(message && { message })
  });
};

export const sendError = (res: Response, error: string, statusCode: number = 500, details?: unknown): void => {
  const response: { success: boolean; error: string; details?: unknown } = {
    success: false,
    error
  };
  if (details) {
    response.details = details;
  }
  res.status(statusCode).json(response);
};

export const sendNetworkResponse = <T>(res: Response, data: T, networkName: string, key: string = 'data'): void => {
  res.json({
    network: networkName,
    [key]: data
  });
};

export const sendPaginatedResponse = <T>(
  res: Response, 
  data: T[], 
  pagination: PaginatedResponse<T[]>['pagination']
): void => {
  res.json({
    success: true,
    data,
    pagination
  });
};

export const handleConditionalRequest = (
  req: AuthenticatedRequest,
  res: Response,
  lastModified: Date,
  data: unknown
): boolean => {
  const lastModifiedStr = lastModified.toUTCString();
  
  // Generate ETag based on result data
  const etag = `W/"${lastModified.getTime()}-${JSON.stringify(data).length}"`;
  
  // Check if client has the latest version using ETag
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end(); // Not Modified
    return true;
  }
  
  // Check if client has the latest version using Last-Modified
  if (req.headers['if-modified-since']) {
    const ifModifiedSince = new Date(req.headers['if-modified-since'] as string);
    if (lastModified <= ifModifiedSince) {
      res.status(304).end(); // Not Modified
      return true;
    }
  }
  
  // Set ETag and Last-Modified headers
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModifiedStr);
  res.setHeader('Cache-Control', 'private, must-revalidate');
  
  return false;
};

export const validatePagination = (req: AuthenticatedRequest): { page: number; limit: number; offset: number } => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
};

export const calculatePagination = (page: number, limit: number, totalCount: number) => {
  const totalPages = Math.ceil(totalCount / limit);
  
  return {
    page,
    limit,
    totalCount,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
};