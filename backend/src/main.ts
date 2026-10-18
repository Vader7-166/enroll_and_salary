import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';
import { ApiErrorFilter } from './common/api-error.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiErrorFilter());
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('PORT'), config.getOrThrow<string>('HOST'));
  Logger.log(`API ready at ${await app.getUrl()}/api/health`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : 'API startup failed', 'Bootstrap');
  process.exitCode = 1;
});
