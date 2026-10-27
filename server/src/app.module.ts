import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TranscriptionModule } from './transcription/transcription.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), TranscriptionModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
