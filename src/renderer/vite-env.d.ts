/// <reference types="vite/client" />

import type { SbcApi } from '../main/preload';

declare global {
  interface Window {
    sbc: SbcApi;
  }
}
