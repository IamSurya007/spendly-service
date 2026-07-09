import { Module, Global } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [FirebaseAdminService, AuthGuard],
  exports: [FirebaseAdminService, AuthGuard],
})
export class AuthModule {}
