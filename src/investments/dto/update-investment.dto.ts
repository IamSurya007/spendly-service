import { IsEnum, IsNumber, IsOptional, IsString, Min, IsDateString, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';
import { InvestmentType } from '../../database/enums';

export class UpdateInvestmentDto {
  @IsOptional()
  @IsEnum(InvestmentType)
  type?: InvestmentType;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  principal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maturityAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMonths?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  maturityDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  institution?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;
}
