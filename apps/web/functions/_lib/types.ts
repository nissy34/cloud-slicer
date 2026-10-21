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

/** The slice of an R2 bucket binding these functions use. */
export interface R2Object {
  key: string;
  size: number;
}
export interface R2ObjectBody extends R2Object {
  body: ReadableStream;
}
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
}

export interface Env {
  /** Absent until the D1 database is bound: accounts then report "not set up". */
  DB?: D1Database;
  /** Saved projects (3MF + thumbnail). Absent until R2 is set up: online projects then report "not set up". */
  PROJECTS?: R2Bucket;
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
  /** Who may open the Admin page: Google account emails, comma separated. A Pages secret (CI copies the repository secret). */
  OWNER_EMAILS?: string;
  /** ECDSA P-256 private key (JWK) that signs relay tickets. CI creates it once; the relay gets the public half. */
  RELAY_TICKET_KEY?: string;
  /** Read-only Cloudflare API token ("Account Analytics: Read") and the account id: today's request counts on the Admin page. */
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  /** Tests only: sends Google's token requests to a mock at this URL. */
  OAUTH_TEST_BASE?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
}
