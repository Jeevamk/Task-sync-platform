import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { maskEmail, shortId } from '../logging/redact';
import type { AuthedRequest } from './auth-user';

/**
 * For routes under /orgs/:orgId/... — the logged-in user must be a member of that organization.
 * Use after JwtAuthGuard:  @UseGuards(JwtAuthGuard, OrgAccessGuard)
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  private readonly logger = new Logger(OrgAccessGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const orgId = String(req.params.orgId ?? '');
    if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) throw new NotFoundException('Organization not found');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user!.id, organizationId: orgId } },
    });
    if (!membership) {
      this.logger.warn(`${maskEmail(req.user!.email)} tried to access org ${shortId(orgId)} without being a member`);
      throw new ForbiddenException('You are not a member of this organization');
    }
    req.orgRole = membership.role;
    return true;
  }
}
