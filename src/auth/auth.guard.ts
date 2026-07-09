import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private firebase: FirebaseAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authHeader.split('Bearer ')[1];

    try {
      const decoded = await this.firebase.verifyToken(token);
      request.user = decoded; // { uid, email, name }
      return true;
    } catch (err) {
      console.error('AuthGuard: Firebase token verification failed:', err.message);
      throw new UnauthorizedException(`Invalid token: ${err.message}`);
    }
  }
}
