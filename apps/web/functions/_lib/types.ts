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
  /** The deploy Google redirects back to (every other deploy signs in through it), e.g. https://cloud-slicer.pages.dev. */
  AUTH_ORIGIN?: string;
  /** Other origins allowed to sign in, comma separated, "*" wildcards allowed (https://*.cloud-slicer.pages.dev). */
  TRUSTED_ORIGINS?: string;
  /** Better Auth's signing/encryption secret; the same on every deploy. CI creates it once. */
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 32 random bytes, base64: encrypts printer API keys at rest. CI creates it once. */
  ACCOUNT_ENC_KEY?: string;
  /** Tests only: sends Google's token requests to a mock at this URL. */
  OAUTH_TEST_BASE?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
}
