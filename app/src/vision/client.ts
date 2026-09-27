// Main-thread handle to the vision worker (one per page).
import * as Comlink from "comlink";
import type { VisionApi } from "./worker";

let remote: Comlink.Remote<VisionApi> | null = null;

export function vision(): Comlink.Remote<VisionApi> {
  remote ??= Comlink.wrap<VisionApi>(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
  return remote;
}

/** Transfer (zero-copy) an ImageBitmap to the worker. */
export const transfer = <T extends Transferable>(bmp: T) => Comlink.transfer(bmp, [bmp]);
