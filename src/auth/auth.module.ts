import { Module, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FirebaseAdminService } from './firebase-admin.service';
import { AuthGuard } from './auth.guard';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [UsersModule],
  providers: [
    FirebaseAdminService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [FirebaseAdminService],
})
export class AuthModule {}
