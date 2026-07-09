import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { LoanType } from '../../database/enums';

export class CreateLoanDto {
  @IsEnum(LoanType)
  type: LoanType;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name: string;

  @IsNumber()
  @Min(0.01)
  principal: number;

  @IsNumber()
  @Min(0.01)
  total: number;

  @IsOptional()
  @IsDateString()
  repaymentDate?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  notes?: string;
}
