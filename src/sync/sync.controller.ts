import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { SyncBatchRequestDto } from './dto/sync-batch.dto';

@ApiTags('sync')
@ApiBearerAuth('bearer')
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post(':entityType/batch')
  @ApiOperation({ summary: 'Batch push mutations (creates, updates, deletes) for offline-first sync' })
  @ApiParam({
    name: 'entityType',
    enum: ['expense', 'loan', 'investment', 'budget', 'category_rule'],
    description: 'The model type being synchronized',
  })
  async batchPush(
    @CurrentUser('uid') userId: string,
    @Param('entityType') entityType: string,
    @Body() body: SyncBatchRequestDto,
  ) {
    const operations = body.operations || [];
    return this.syncService.processBatch(userId, entityType, operations);
  }

  @Get(':entityType')
  @ApiOperation({ summary: 'Pull entity changes since the last sync cursor' })
  @ApiParam({
    name: 'entityType',
    enum: ['expense', 'loan', 'investment', 'budget', 'category_rule'],
    description: 'The model type being synchronized',
  })
  async pull(
    @CurrentUser('uid') userId: string,
    @Param('entityType') entityType: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 200;
    return this.syncService.pull(userId, entityType, since, limitNum);
  }
}
