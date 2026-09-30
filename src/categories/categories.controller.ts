import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('categories')
@ApiBearerAuth('bearer')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * Effective categories for the user (system + custom + overrides). Writes
   * go through the offline-first sync API (`/sync/category/batch`).
   */
  @Get()
  @ApiOperation({ summary: 'List system and custom categories for the current user' })
  async list(@CurrentUser('uid') userId: string) {
    return this.categoriesService.listForUser(userId);
  }
}
