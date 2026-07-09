import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaymentMethod, ExpenseSource } from '../../database/enums';

export class CreateExpenseDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  note?: string;

  @IsDateString()
  date: string;

  @IsEnum(PaymentMethod)
  @IsOptional()
  method?: PaymentMethod;

  @IsEnum(ExpenseSource)
  @IsOptional()
  source?: ExpenseSource;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  merchant?: string;
}
