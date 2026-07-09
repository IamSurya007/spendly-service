import { IsNotEmpty, IsString } from 'class-validator';

export class ConnectSheetsDto {
  @IsString()
  @IsNotEmpty()
  sheetsId: string;

  @IsString()
  @IsNotEmpty()
  sheetsToken: string; // Google OAuth refresh token
}
