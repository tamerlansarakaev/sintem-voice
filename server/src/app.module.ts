import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { SubtitlesModule } from './subtitles/subtitles.module.js';
import { TranscriptionModule } from './transcription/transcription.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TranscriptionModule,
    SubtitlesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
