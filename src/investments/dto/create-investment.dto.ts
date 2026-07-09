import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsDateString, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';
import { InvestmentType } from '../../database/enums';

export class CreateInvestmentDto {
  @IsEnum(InvestmentType)
  @IsOptional()
  type?: InvestmentType;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name: string;

  @IsNumber()
  @Min(0)
  monthlyAmount: number;

  @IsNumber()
  @Min(0)
  principal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maturityAmount?: number;

  @IsInt()
  @Min(1)
  durationMonths: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  maturityDate: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  institution?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  interestRate?: number;
}
