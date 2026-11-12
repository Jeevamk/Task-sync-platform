import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Body of POST /auth/google. */
export class GoogleLoginDto {
  @ApiProperty({ description: 'ID token from Google Sign-In in the web app' })
  @IsString()
  @IsNotEmpty({ message: 'idToken is required' })
  idToken!: string;
}
