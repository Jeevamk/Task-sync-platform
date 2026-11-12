import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

/** Sent by the Trello callback page's script to POST /connect/trello/complete. */
export class TrelloCompleteDto {
  @ApiProperty({ description: 'The one-time value from the connect link' })
  @IsString()
  @IsNotEmpty({ message: 'Missing state' })
  state!: string;

  @ApiProperty({ description: 'The token Trello put in the page address (#token=…)' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{32,128}$/, { message: 'Invalid Trello token' })
  token!: string;
}
