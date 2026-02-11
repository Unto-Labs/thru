import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function getRpcTarget(): string {
  const url = process.env.NEXT_PUBLIC_RPC_URL?.trim();
  if (!url) {
    throw new Error('NEXT_PUBLIC_RPC_URL is not set');
  }
  return url;
}

function stripHopByHopHeaders(headers: Headers): void {
  headers.delete('connection');
  headers.delete('keep-alive');
  headers.delete('proxy-authenticate');
  headers.delete('proxy-authorization');
  headers.delete('te');
  headers.delete('trailer');
  headers.delete('transfer-encoding');
  headers.delete('upgrade');
}

function buildTargetUrl(requestUrl: string, path: string[]): string {
  const base = getRpcTarget().replace(/\/$/, '');
  const incoming = new URL(requestUrl);
  const joined = path.map((segment) => encodeURIComponent(segment)).join('/');
  return `${base}/${joined}${incoming.search}`;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path } = await context.params;
  const targetUrl = buildTargetUrl(request.url, path);
  const headers = new Headers(request.headers);

  headers.delete('host');
  headers.delete('content-length');
  stripHopByHopHeaders(headers);

  const body = await request.arrayBuffer().catch(() => null);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
    });

    const responseHeaders = new Headers(upstream.headers);
    stripHopByHopHeaders(responseHeaders);

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to reach RPC upstream';
    return NextResponse.json(
      { error: 'RPC proxy failed', targetUrl, message },
      { status: 502 }
    );
  }
}
