import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { TranslationModule } from '../translation/translation.module.js';
import { TranslateSubtitlesGateway } from './translate-subtitles.gateway.js';

@Module({
  imports: [TranscriptionModule, TranslationModule],
  providers: [TranslateSubtitlesGateway],
})
export class SubtitlesModule {}
