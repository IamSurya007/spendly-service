import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private firebase: FirebaseAdminService,
    private usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      const decoded = await this.firebase.verifyToken(token);
      const dbUser = await this.usersService.findOrCreateFromFirebase(decoded);
      request.user = {
        ...decoded,
        ...dbUser,
        uid: dbUser.id, // For backward compatibility with @CurrentUser('uid')
      };
      return true;
    } catch (err: any) {
      console.error('AuthGuard: Firebase token verification/upsert failed:', err.message);
      throw new UnauthorizedException(`Invalid token: ${err.message}`);
    }
  }
}
