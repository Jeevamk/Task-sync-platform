import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** GET /health - 200 when PostgreSQL, Redis and n8n all respond, otherwise 503. */
  @Get()
  async get(@Res() res: Response): Promise<void> {
    const report = await this.health.check();
    res.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(report);
  }
}
