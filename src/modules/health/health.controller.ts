import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';
import { AppConfig } from '../../config/app-config.js';
import { DatabaseHealth } from '../../shared/infrastructure/database/database-health.js';
import { Public } from '../iam/presentation/http/auth.decorators.js';

/**
 * Orchestration probes.
 *  - GET /api/v1/health       readiness: 503 while PostgreSQL is unreachable, so
 *                             the load balancer stops sending traffic here.
 *  - GET /api/v1/health/live  liveness: the process answers. It never checks
 *                             dependencies, or a database outage would make the
 *                             orchestrator restart every healthy instance.
 */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly config: AppConfig,
  ) {}

  @Get()
  async readiness(@Res() reply: FastifyReply): Promise<void> {
    const databaseUp = await this.database.isUp();
    void reply
      .status(databaseUp ? 200 : 503)
      .header('cache-control', 'no-store')
      .send({
        status: databaseUp ? 'ok' : 'unavailable',
        version: this.config.version,
        uptimeSeconds: Math.floor(process.uptime()),
        checks: { database: databaseUp ? 'up' : 'down' },
      });
  }

  @Get('live')
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
