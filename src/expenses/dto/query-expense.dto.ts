import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ExpenseSource } from '../../database/enums';

export class QueryExpenseDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Month must be in YYYY-MM format' })
  month: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(ExpenseSource)
  source?: ExpenseSource;

  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  cursor?: string;
}
