import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthRequest } from './auth.types';

const SESSION_FAILURE = { code: 'AUTH_REQUIRED', message: 'Authentication is required.' };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.sessionToken(request);
    if (!token) throw new UnauthorizedException(SESSION_FAILURE);

    const { sessionId, user } = await this.auth.authenticate(token);
    const authRequest = request as AuthRequest;
    authRequest.user = user;
    authRequest.sessionId = sessionId;
    return true;
  }

  private sessionToken(request: Request): string | undefined {
    const cookies = (request as Request & { cookies?: Record<string, unknown> }).cookies;
    const parsed = cookies?.hrtp_session;
    if (typeof parsed === 'string' && parsed.length >= 43) return parsed;

    const header = request.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const separator = part.indexOf('=');
      if (separator < 1 || part.slice(0, separator).trim() !== 'hrtp_session') continue;
      try {
        const token = decodeURIComponent(part.slice(separator + 1).trim());
        return token.length >= 43 ? token : undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
