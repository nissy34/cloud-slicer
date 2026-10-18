// Small response helpers.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Every state-changing call must come from the page itself (blocks cross-site form posts). */
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-origin request refused');
}

export async function readJson<T>(request: Request, maxBytes = 512 * 1024): Promise<T> {
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/json'))
    throw new HttpError(415, 'Expected application/json');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request too large');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
