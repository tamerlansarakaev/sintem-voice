import { Module } from '@nestjs/common';
import { TranscriptionModule } from '../transcription/transcription.module.js';
import { TranslationModule } from '../translation/translation.module.js';
import { TranslateVoiceGateway } from './translate-voice.gateway.js';
import { TtsService } from './tts.service.js';

@Module({
  imports: [TranscriptionModule, TranslationModule],
  providers: [TtsService, TranslateVoiceGateway],
})
export class VoiceModule {}
