const inboxesUrl = 'https://api.hubapi.com/conversations/v3/conversations/inboxes';

export async function checkHubSpot(serviceKey, fetchInboxes = fetch) {
  const key = serviceKey?.trim();
  if (!key) return 'not_configured';

  const url = new URL(inboxesUrl);
  const signal = AbortSignal.timeout(8000);
  try {
    for (let page = 0; page < 10; page++) {
      const response = await fetchInboxes(url, {
        headers: { Authorization: `Bearer ${key}` },
        redirect: 'error',
        signal,
      });
      if (response.status === 401) return 'invalid_key';
      if (response.status === 403) return 'access_denied';
      if (response.status === 429) return 'rate_limited';
      if (!response.ok) return 'unavailable';

      const data = await response.json();
      if (!Array.isArray(data?.results)) return 'unavailable';
      if (data.results.some(inbox => inbox?.type === 'HELP_DESK')) return 'connected';
      if (!data.paging?.next) return 'no_help_desk';

      const cursor = data.paging.next.after;
      if (typeof cursor !== 'string' || !cursor || cursor === url.searchParams.get('after')) {
        return 'unavailable';
      }
      url.searchParams.set('after', cursor);
    }
  } catch {
    return 'unavailable';
  }
  return 'unavailable';
}

export async function serveHubSpotCheck(request, response, port, serviceKey) {
  const { host, origin } = request.headers;
  const localHost = host === `127.0.0.1:${port}` || host === `localhost:${port}`;
  const headers = { 'Cache-Control': 'no-store' };
  if (!localHost || origin !== `http://${host}` || request.headers['sec-fetch-site'] === 'cross-site') {
    return response.writeHead(403, headers).end();
  }
  if (request.method !== 'POST') {
    return response.writeHead(405, { ...headers, Allow: 'POST' }).end();
  }

  const status = await checkHubSpot(serviceKey);
  response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ status }));
}
