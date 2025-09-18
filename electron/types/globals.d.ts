// Global type overrides for gradual migration

declare const THREE: any;

declare global {
  interface Window {
    WS_CONFIG?: any;
    players?: any;
  }

  interface HTMLElement {
    disabled?: boolean;
    value?: any;
    checked?: boolean;
  }

  // Allow referencing existing module-like globals
  const chunks: any;
}

export {};
