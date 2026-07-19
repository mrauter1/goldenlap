import type { GoldenLapTestApi } from './test-api';
import type { TrackStudioApi } from './ui/track-studio';

declare global {
  interface Window {
    __GL?: GoldenLapTestApi;
    __GL_STUDIO?: TrackStudioApi;
  }
}

export {};
