// Static files (public/: data, models, memes, fixtures) are addressed root-relative ("/data/x") in code
// and in the generated data (cards.json imageUrl, meta.json recognizerFile). The app can also be built
// under a sub-path (npm run build:site → /projects/rift-pulls/), so every such path goes through here.

/** "/data/cards.json" → "<BASE_URL>data/cards.json". Absolute URLs pass through unchanged. */
export function assetUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return base.replace(/\/?$/, "/") + path.replace(/^\/+/, "");
}
