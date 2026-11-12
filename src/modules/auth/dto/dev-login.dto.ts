import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body of POST /auth/dev-login (local testing only). */
export class DevLoginDto {
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail({}, { message: 'A valid email is required' })
  email!: string;

  @ApiPropertyOptional({ example: 'Your Name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
