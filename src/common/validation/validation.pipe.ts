import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';

export interface FieldError {
  /** e.g. "email" or "rows.2.title" */
  field: string;
  messages: string[];
}

/** Turns class-validator's nested errors into a flat list: one entry per field, nested paths joined with dots. */
export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...flattenValidationErrors(error.children ?? [], field)];
  });
}

/**
 * Checks every @Body() against its DTO's class-validator decorators.
 * - whitelist: fields not declared in the DTO are dropped (never reach the service).
 * - transform: the body becomes a real DTO instance, and @Transform helpers (trim, lower-case) run.
 * - stopAtFirstError: per field, only the first failing rule is reported (decorators run bottom to top).
 * - On failure: 400 with one readable `message` (like every other error in this API) plus `errors` per field.
 * Bodies typed as an interface (e.g. the Trello webhook payload) are not checked.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    stopAtFirstError: true, // one clear message per field, not every rule that also failed

    exceptionFactory: (errors) => {
      const fieldErrors = flattenValidationErrors(errors);
      return new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: fieldErrors.flatMap((e) => e.messages).join('; '),
        errors: fieldErrors,
      });
    },
  });
}
