// Files shared to the installed app from Android's Share menu. The service
// worker (public/sw.js) keeps them in a cache and opens /?shared=1; the page
// takes them from there once (state/projects.ts opens them).
import { MODEL_EXTENSIONS } from './presets';

export const sharedOnLoad = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('shared');

/** The shared files, removed from the cache and from the address bar; [] when none. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!sharedOnLoad()) return [];
  const url = new URL(location.href);
  url.searchParams.delete('shared');
  history.replaceState(history.state, '', url);
  try {
    const cache = await caches.open('shared-files');
    const files: File[] = [];
    for (const key of await cache.keys()) {
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) continue;
      const name = decodeURIComponent(res.headers.get('X-File-Name') ?? '') || 'model';
      files.push(new File([await res.blob()], name, { type: res.headers.get('Content-Type') ?? '' }));
    }
    return files;
  } catch {
    return [];
  }
}

/** Files the app can open; the rest are named in a message. */
export function splitShared(files: File[]): { open: File[]; skipped: string[] } {
  const ok = (f: File) => MODEL_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext));
  return { open: files.filter(ok), skipped: files.filter((f) => !ok(f)).map((f) => f.name) };
}
