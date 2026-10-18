import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const DEFAULT_WEB_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
];
const UNSAFE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!UNSAFE_METHODS.includes(request.method)) return true;

    const origin = this.header(request, 'origin');
    if (origin) {
      if (!this.allowedOrigins().has(origin)) {
        throw new ForbiddenException({ code: 'ORIGIN_FORBIDDEN', message: 'Request origin is not allowed.' });
      }
      return true;
    }

    if (this.header(request, 'sec-fetch-site') === 'cross-site') {
      throw new ForbiddenException({ code: 'ORIGIN_FORBIDDEN', message: 'Cross-site requests require an allowed origin.' });
    }
    return true;
  }

  private allowedOrigins(): Set<string> {
    const configured = this.config.get<string>('WEB_ORIGINS');
    const origins = configured?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? DEFAULT_WEB_ORIGINS;
    const normalized = new Set<string>();
    for (const origin of origins) {
      try {
        normalized.add(new URL(origin).origin);
      } catch {
        // Invalid configured origins never become trusted.
      }
    }
    return normalized;
  }

  private header(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}
