/// <reference types="vite/client" />
interface Window {
  // TurboWarp injects these runtime objects; their API is not published as TypeScript.
  ScratchBlocks?: any;
  vm?: any;
  AGENTWARP?: unknown;
  __agentwarpClient?: import('./sync-core').SyncState;
}
declare module 'scratchblocks/index.js' { const init: (window: Window) => any; export default init; }
declare module 'scratchblocks/scratch3/index.js' { export function makeStyle(): HTMLStyleElement; }
