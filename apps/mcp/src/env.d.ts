// The site helpers type-check against Vite's import.meta.env; the add-on never reads it.
interface ImportMeta {
  readonly env: Record<string, unknown>;
}
