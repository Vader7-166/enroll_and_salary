import type { RoleCode } from '@prisma/client';
import type { Request } from 'express';

export interface AuthAssignment {
  roleCode: RoleCode;
  scopeOrgUnitId: string;
  scopeName: string;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roles: RoleCode[];
  permissions: string[];
  assignments: AuthAssignment[];
  expiresAt: string;
}

export interface AuthRequest extends Request {
  user: AuthUser;
  sessionId: string;
}
