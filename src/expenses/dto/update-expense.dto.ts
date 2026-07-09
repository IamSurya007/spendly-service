import { IsEnum, IsNumber, IsOptional, IsString, MaxLength, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethod, ExpenseSource } from '../../database/enums';

export class UpdateExpenseDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsOptional()
  @IsEnum(ExpenseSource)
  @IsOptional()
  source?: ExpenseSource;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  merchant?: string;
}
