import { Module } from '@nestjs/common';
import { MetaTranscribeService } from './meta-transcribe.service.js';

@Module({
  providers: [MetaTranscribeService],
  exports: [MetaTranscribeService],
})
export class TranscriptionModule {}
