import { Global, Module } from '@nestjs/common';
import { ReferenceCacheService } from '../common/cache/reference-cache.service';
import { PrismaService } from './prisma.service';
@Global()
@Module({ providers: [PrismaService, ReferenceCacheService], exports: [PrismaService, ReferenceCacheService] })
export class DatabaseModule {}
