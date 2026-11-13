// The site helpers type-check against Vite's import.meta.env; the add-on never reads it.
interface ImportMeta {
  readonly env: Record<string, unknown>;
}

/** The add-on's version, put in by build.mjs (MCP_VERSION in CI: 0.1.<run number>). */
declare const __ADDON_VERSION__: string;
