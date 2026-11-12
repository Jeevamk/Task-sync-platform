import {
  Controller,
  Get,
  Head,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TrelloWebhookBody } from './dto/trello-webhook-body';
import { TrelloWebhookService } from './trello-webhook.service';

@Controller('webhooks/trello')
export class TrelloWebhookController {
  private readonly logger = new Logger(TrelloWebhookController.name);

  constructor(private readonly service: TrelloWebhookService) {}

  /** Trello sends HEAD when the webhook is registered and expects 200. */
  @Head()
  @HttpCode(200)
  head(): void {
    this.logger.debug('Trello webhook check (HEAD)');
  }

  /** Some Trello checks use GET instead of HEAD; answer 200 to both. */
  @Get()
  @HttpCode(200)
  check(): { ok: true } {
    return { ok: true };
  }

  /**
   * Every change on a registered board arrives here.
   * Bad signature -> 401. Processing error -> 500, so Trello retries (duplicates are skipped safely).
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-trello-webhook') signature: string | undefined,
  ): Promise<{ ok: true; outcome: string }> {
    if (!this.service.isSignatureValid(req.rawBody, signature)) {
      // Usually PUBLIC_BASE_URL differs from the address the webhook was registered with, or TRELLO_APP_SECRET is wrong.
      this.logger.warn(`Rejected Trello webhook: ${signature ? 'signature does not match' : 'no signature'} (from ${req.ip})`);
      throw new UnauthorizedException('Invalid Trello signature');
    }
    const body = req.body as TrelloWebhookBody;
    const result = await this.service.handle(body).catch((err: unknown) => {
      this.logger.error(
        `Trello ${body?.action?.type ?? 'event'} ${body?.action?.id ?? ''} failed, Trello will retry: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw err;
    });
    return { ok: true, outcome: result.outcome };
  }
}
