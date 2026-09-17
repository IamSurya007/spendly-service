import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { AccountType } from '../../database/enums';

export class CreateAccountDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @IsEnum(AccountType)
  @IsOptional()
  type?: AccountType | string;

  @IsOptional()
  @IsNumber()
  currentBalance?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  accountNumberLast4?: string;

  @IsOptional()
  @IsNumber()
  colorValue?: number;
}
