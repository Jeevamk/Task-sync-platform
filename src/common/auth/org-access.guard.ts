import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthedRequest } from './auth-user';

/**
 * For routes under /orgs/:orgId/... — the logged-in user must be a member of that organization.
 * Use after JwtAuthGuard:  @UseGuards(JwtAuthGuard, OrgAccessGuard)
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const orgId = String(req.params.orgId ?? '');
    if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) throw new NotFoundException('Organization not found');
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: req.user!.id, organizationId: orgId } },
    });
    if (!membership) throw new ForbiddenException('You are not a member of this organization');
    req.orgRole = membership.role;
    return true;
  }
}
