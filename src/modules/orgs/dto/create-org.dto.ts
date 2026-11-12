import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from '../../../common/validation/transforms';

/** Body of POST /orgs. */
export class CreateOrgDto {
  @ApiProperty({ example: 'Acme Dev Team', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100, { message: 'name must be 2 to 100 characters' })
  name!: string;
}
