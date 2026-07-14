import type { GoldenLapTestApi } from './test-api';

declare global {
  interface Window {
    __GL?: GoldenLapTestApi;
  }
}

export {};
