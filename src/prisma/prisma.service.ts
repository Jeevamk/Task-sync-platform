import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    const started = Date.now();
    try {
      await this.$connect();
    } catch (err) {
      this.logger.error(`Could not connect to PostgreSQL (check DATABASE_URL and that the database is running): ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
    this.logger.log(`Connected to PostgreSQL in ${Date.now() - started}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Disconnected from PostgreSQL');
  }
}
