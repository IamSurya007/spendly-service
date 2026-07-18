import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum SyncOperationType {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export class SyncOperationDto {
  @ApiProperty({
    description: 'Client-generated identifier (UUID or custom string)',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({
    description: 'The mutation operation type',
    enum: SyncOperationType,
    example: 'CREATE',
  })
  @IsEnum(SyncOperationType)
  @IsNotEmpty()
  operationType: SyncOperationType;

  @ApiProperty({
    description: 'The client-side version of the entity',
    example: 1,
  })
  @IsInt()
  @IsNotEmpty()
  clientVersion: number;

  @ApiProperty({
    description: 'Entity-specific JSON payload (optional or empty for DELETE)',
    example: { amount: 250.5, category: 'Food & Dining', note: 'Dinner', date: '2026-07-18T20:30:00.000Z', method: 'UPI', source: 'MANUAL', merchant: 'Absolute Barbecues' },
  })
  @IsObject()
  @IsOptional()
  payload?: Record<string, any>;
}

export class SyncBatchRequestDto {
  @ApiProperty({
    type: [SyncOperationDto],
    description: 'Batch of mutation operations to synchronize',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncOperationDto)
  operations: SyncOperationDto[];
}
