// The voice sample: the text read aloud and a base64 16-bit mono WAV.
export interface VoiceSample {
  text: string;
  wav: string;
}

export interface ConfigApi {
  getBackendUrl(): Promise<string>;
  platform: NodeJS.Platform;
}

export interface VoiceApi {
  load(): Promise<VoiceSample | null>;
  save(voice: VoiceSample): Promise<void>;
}

export interface SubtitlesApi {
  open(): void;
  // Returns a function that removes the listener.
  onClosed(callback: () => void): () => void;
}

export interface WindowControlsApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
}

export interface ExposedApi {
  config: ConfigApi;
  voice: VoiceApi;
  subtitles: SubtitlesApi;
  windowControls: WindowControlsApi;
}
