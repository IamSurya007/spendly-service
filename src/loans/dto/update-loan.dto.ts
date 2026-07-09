import { IsEnum, IsNumber, IsOptional, IsString, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { LoanType, LoanStatus } from '../../database/enums';

export class UpdateLoanDto {
  @IsOptional()
  @IsEnum(LoanType)
  type?: LoanType;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  principal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  total?: number;

  @IsOptional()
  @IsDateString()
  repaymentDate?: string;

  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  notes?: string;
}
