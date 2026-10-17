export type OliState = 'idle' | 'listening' | 'thinking' | 'understanding' | 'happy' | 'focused' | 'celebrating';
export interface OliOptions {
  state?: OliState;
  speed?: number;
  dark?: boolean;
  paused?: boolean;
  particles?: number;
}
export class OliCanvas {
  constructor(canvas: HTMLCanvasElement, options?: OliOptions);
  setState(state: OliState): void;
  setOptions(options: OliOptions): void;
  lookAt(x: number, y: number): void;
  ripple(x?: number, y?: number): void;
  destroy(): void;
}
