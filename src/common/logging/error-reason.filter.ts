import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { errMsg } from './redact';

/**
 * Nest's default handler only logs unexpected (500) errors: a 400/401/403/404/409 is sent to the
 * client but never logged, so the request line said "400" without saying why.
 * This filter puts the reason on res.locals.errorReason (the request logger appends it to its line),
 * then lets Nest send the usual response. Request bodies are still never logged, only the message.
 */
@Catch()
export class ErrorReasonFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() === 'http') {
      host.switchToHttp().getResponse<Response>().locals.errorReason = reasonOf(exception);
    }
    super.catch(exception, host);
  }
}

export function reasonOf(exception: unknown): string {
  if (!(exception instanceof HttpException)) return errMsg(exception);
  const body = exception.getResponse();
  if (typeof body === 'string') return errMsg(body);
  const message = (body as { message?: unknown })?.message;
  if (Array.isArray(message)) return errMsg(message.join('; '));
  return errMsg(typeof message === 'string' ? message : exception.message);
}
