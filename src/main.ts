import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AuthGuard } from './auth/auth.guard';
import { FirebaseAdminService } from './auth/firebase-admin.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS
  app.enableCors({
    origin: true, // Allows any origin making the request
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: '*',
  });

  // Enable global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
  }));

  // Retrieve FirebaseAdminService and apply global AuthGuard
  const firebaseAdminService = app.get(FirebaseAdminService);
  app.useGlobalGuards(new AuthGuard(firebaseAdminService));

  // Configure Swagger
  const config = new DocumentBuilder()
    .setTitle('Spendly API')
    .setDescription('Personal Finance OS API for Indian Users')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter Firebase ID Token',
        in: 'header',
      },
      'bearer', // This matches the name of security scheme
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation is available at: http://localhost:${port}/api`);
}
bootstrap();
