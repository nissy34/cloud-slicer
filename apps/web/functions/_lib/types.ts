// The slice of the Cloudflare Workers runtime these functions use (kept here
// instead of depending on @cloudflare/workers-types).

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: { changes?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;
}

export interface Env {
  /** Absent until the D1 database is bound: accounts then report "not set up". */
  DB?: D1Database;
  /** Host every provider redirects back to, e.g. https://slicer.awesomestuff.qzz.io. Defaults to the request's own origin. */
  AUTH_ORIGIN?: string;
  /** Hosts allowed to start a sign-in, comma separated; "*.example.com" matches subdomains. */
  ALLOWED_HOSTS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Tests only: replaces the providers' endpoints with a mock at this URL. */
  OAUTH_TEST_BASE?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
}
