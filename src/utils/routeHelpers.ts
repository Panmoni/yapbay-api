import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/auth';

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  network?: string;
  success?: boolean;
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

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
): void => {
  res.status(statusCode).json({
    success: true,
    data,
    ...(message && { message }),
  });
};

export const sendError = (
  res: Response,
  error: string,
  statusCode = 500,
  details?: unknown,
): void => {
  const response: { success: boolean; error: string; details?: unknown } = {
    success: false,
    error,
  };
  if (details) {
    response.details = details;
  }
  res.status(statusCode).json(response);
};

export const sendNetworkResponse = <T>(
  res: Response,
  data: T,
  networkName: string,
  key = 'data',
): void => {
  res.json({
    network: networkName,
    [key]: data,
  });
};

export const sendPaginatedResponse = <T>(
  res: Response,
  data: T[],
  pagination: PaginatedResponse<T[]>['pagination'],
): void => {
  res.json({
    success: true,
    data,
    pagination,
  });
};

export const handleConditionalRequest = (
  req: Pick<Request, 'headers'>,
  res: Response,
  lastModified: Date,
  data: unknown,
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

export const validatePagination = (
  req: AuthenticatedRequest,
): { page: number; limit: number; offset: number } => {
  const page = Math.max(1, Number.parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit as string, 10) || 10));
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
    hasPrev: page > 1,
  };
};
