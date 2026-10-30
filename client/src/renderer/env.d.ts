import type { ExposedApi } from '../shared/api';

declare global {
  interface Window extends ExposedApi {}

  // Chromium plays an AudioContext into a chosen output device; the DOM
  // typings do not have it yet.
  interface AudioContext {
    setSinkId(sinkId: string): Promise<void>;
  }
}
