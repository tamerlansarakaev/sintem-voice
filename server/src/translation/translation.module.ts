import { Module } from '@nestjs/common';
import { TranslateService } from './translate.service.js';

@Module({
  providers: [TranslateService],
  exports: [TranslateService],
})
export class TranslationModule {}
