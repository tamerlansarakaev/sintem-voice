import { Module } from '@nestjs/common';
import { MetaTranscribeService } from './meta-transcribe.service.js';
import { TranscriptionGateway } from './transcription.gateway.js';

@Module({
  providers: [MetaTranscribeService, TranscriptionGateway],
})
export class TranscriptionModule {}
