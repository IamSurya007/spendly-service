import { Controller, Get, Post, Patch, Delete, Body } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpsertUserDto } from './dto/upsert-user.dto';
import { UpdateFcmDto } from './dto/update-fcm.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('me')
  async upsertUser(
    @CurrentUser('uid') userId: string,
    @Body() dto: UpsertUserDto,
  ) {
    return this.usersService.upsert(userId, dto);
  }

  @Post('me/migrate-firestore')
  async migrateFirestore(@CurrentUser('uid') userId: string) {
    return this.usersService.migrateFirestore(userId);
  }

  @Get('me')
  async getProfile(@CurrentUser('uid') userId: string) {
    return this.usersService.findOne(userId);
  }

  @Patch('me/fcm')
  async updateFcm(
    @CurrentUser('uid') userId: string,
    @Body() dto: UpdateFcmDto,
  ) {
    return this.usersService.updateFcm(userId, dto.fcmToken);
  }

  @Delete('me')
  async deleteAccount(@CurrentUser('uid') userId: string) {
    await this.usersService.delete(userId);
    return { message: 'Account deleted successfully' };
  }
}
