import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { trim } from '../../../common/validation/transforms';
import { API_TOKEN_SCOPES, type ApiTokenScope } from '../../../database/types';
import { DEFAULT_TOKEN_DAYS, MAX_TOKEN_DAYS } from '../api-tokens.service';

/** Body of POST /auth/tokens. */
export class CreateApiTokenDto {
  @ApiProperty({ example: 'Claude Desktop', description: 'A name to recognise the token by, e.g. where you use it', minLength: 1, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(1, 100, { message: 'name must be 1 to 100 characters' })
  name!: string;

  @ApiPropertyOptional({
    enum: API_TOKEN_SCOPES,
    default: 'read',
    description: '`read`: GET requests only. `read+write`: everything you may do yourself.',
  })
  @IsOptional()
  @IsIn(API_TOKEN_SCOPES, { message: `scope must be one of: ${API_TOKEN_SCOPES.join(', ')}` })
  scope?: ApiTokenScope;

  @ApiPropertyOptional({
    example: DEFAULT_TOKEN_DAYS,
    nullable: true,
    minimum: 1,
    maximum: MAX_TOKEN_DAYS,
    description: `Days until the token stops working. Leave out for ${DEFAULT_TOKEN_DAYS}; send null for a token that never expires.`,
  })
  @IsOptional() // also lets null through: null = never expires
  @IsInt({ message: 'expiresInDays must be a whole number of days, or null' })
  @Min(1, { message: `expiresInDays must be 1 to ${MAX_TOKEN_DAYS}, or null` })
  @Max(MAX_TOKEN_DAYS, { message: `expiresInDays must be 1 to ${MAX_TOKEN_DAYS}, or null` })
  expiresInDays?: number | null;
}
