import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { BlockedUrlError, hostIsPublic, isPublicDestination, safeFetch, type ResolveDns } from './link-reader.ts';
import { normalizeSiteUrl } from './brand-autopilot.ts';
import { fetchFeed } from '../fetch-rss/fetch-feed.ts';

// DNS de mentira: nenhum teste depende da rede.
const ZONA: Record<string, { A?: string[]; AAAA?: string[] }> = {
  'exemplo.com': { A: ['93.184.216.34'] },
  'cdn.exemplo.com': { A: ['93.184.216.35'], AAAA: ['2606:2800:220:1::1'] },
  'interno.exemplo.com': { A: ['10.0.0.5'] },
  'metadados.exemplo.com': { A: ['169.254.169.254'] },
  'v6interno.exemplo.com': { A: ['93.184.216.36'], AAAA: ['fd00::1'] },
  'mapeado.exemplo.com': { AAAA: ['::ffff:10.0.0.9'] },
};
const dns: ResolveDns = (host, type) => {
  const found = ZONA[host]?.[type];
  return found?.length ? Promise.resolve(found) : Promise.reject(new Deno.errors.NotFound(`no records for ${host}`));
};

/** fetch de mentira: registra cada URL pedida e responde pelo roteiro. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const impl = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response('nada', { status: 404 }));
  }) as typeof fetch;
  return { calls, impl };
}
const redirect = (location: string) => () => new Response(null, { status: 302, headers: { location } });
const ok = (body = 'ok') => () => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });

Deno.test('recusa endereço interno sem nem consultar o DNS', async () => {
  for (const url of [
    'http://169.254.169.254/latest/meta-data/',
    'https://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/',
    'http://2130706433/',
    'http://localhost./',
    'http://localhost../',
    'http://servico.local./',
    'http://[::1]/',
    'http://[::7f00:1]/',
    'http://[::ffff:169.254.169.254]/',
  ]) {
    const { calls, impl } = fakeFetch({});
    const unexpected: ResolveDns = () => Promise.reject(new Error(`DNS consultado para ${url}`));
    assertEquals(await isPublicDestination(url, { resolve: unexpected }), false, url);
    await assertRejects(() => safeFetch(url, { resolve: unexpected, fetch: impl }), BlockedUrlError, undefined, url);
    assertEquals(calls, [], url);
  }
});

Deno.test('nome que resolve para rede interna é recusado (A ou AAAA)', async () => {
  for (const host of ['interno.exemplo.com', 'metadados.exemplo.com', 'v6interno.exemplo.com', 'mapeado.exemplo.com']) {
    assertEquals(await hostIsPublic(host, { resolve: dns }), false, host);
    const { calls, impl } = fakeFetch({ [`https://${host}/`]: ok() });
    await assertRejects(() => safeFetch(`https://${host}/`, { resolve: dns, fetch: impl }), BlockedUrlError);
    assertEquals(calls, [], host);
  }
  assertEquals(await hostIsPublic('exemplo.com', { resolve: dns }), true);
  assertEquals(await hostIsPublic('cdn.exemplo.com', { resolve: dns }), true);
});

Deno.test('redirecionamento para IP ou nome interno é barrado antes do salto', async () => {
  for (const destino of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/admin', 'https://interno.exemplo.com/']) {
    const { calls, impl } = fakeFetch({ 'https://exemplo.com/feed': redirect(destino), [destino]: ok('segredo') });
    await assertRejects(() => safeFetch('https://exemplo.com/feed', { resolve: dns, fetch: impl }), BlockedUrlError);
    assertEquals(calls, ['https://exemplo.com/feed'], destino);
  }
});

Deno.test('segue redirecionamento público e devolve o endereço final', async () => {
  const { calls, impl } = fakeFetch({
    'https://exemplo.com/rss/': redirect('/rss.xml'),
    'https://exemplo.com/rss.xml': redirect('https://cdn.exemplo.com/rss.xml'),
    'https://cdn.exemplo.com/rss.xml': ok('<rss/>'),
  });
  const { response, url } = await safeFetch('https://exemplo.com/rss/', { resolve: dns, fetch: impl });
  assertEquals(url, 'https://cdn.exemplo.com/rss.xml');
  assertEquals(await response.text(), '<rss/>');
  assertEquals(calls.length, 3);
});

Deno.test('httpsOnly barra http em qualquer salto; maxRedirects 0 barra o redirecionamento', async () => {
  const http = fakeFetch({ 'https://exemplo.com/': redirect('http://exemplo.com/') });
  await assertRejects(
    () => safeFetch('https://exemplo.com/', { resolve: dns, fetch: http.impl, httpsOnly: true }),
    BlockedUrlError,
  );
  assertEquals(http.calls, ['https://exemplo.com/']);
  await assertRejects(() => safeFetch('http://exemplo.com/', { resolve: dns, httpsOnly: true }), BlockedUrlError);

  const semSalto = fakeFetch({ 'https://exemplo.com/foto.jpg': redirect('https://cdn.exemplo.com/foto.jpg') });
  await assertRejects(
    () => safeFetch('https://exemplo.com/foto.jpg', { resolve: dns, fetch: semSalto.impl, maxRedirects: 0 }),
    Error,
    'redireciona',
  );
  assertEquals(semSalto.calls, ['https://exemplo.com/foto.jpg']);

  const laco = fakeFetch({ 'https://exemplo.com/a': redirect('/a') });
  await assertRejects(() => safeFetch('https://exemplo.com/a', { resolve: dns, fetch: laco.impl }), Error, 'vezes demais');
  assertEquals(laco.calls.length, 5);
});

Deno.test('nome que não resolve sai como erro de DNS, sem buscar', async () => {
  const { calls, impl } = fakeFetch({});
  assertEquals(await hostIsPublic('nao-existe.exemplo.com', { resolve: dns }), false);
  await assertRejects(() => safeFetch('https://nao-existe.exemplo.com/', { resolve: dns, fetch: impl }), TypeError, 'dns error');
  assertEquals(calls, []);
});

Deno.test('runtime sem DNS cai só na checagem do endereço', async () => {
  const semDns: ResolveDns = () => Promise.reject(new Deno.errors.NotSupported('sem dns'));
  assertEquals(await hostIsPublic('exemplo.com', { resolve: semDns }), true);
  assertEquals(await isPublicDestination('http://169.254.169.254/', { resolve: semDns }), false);
  assertEquals(await isPublicDestination('http://localhost./', { resolve: semDns }), false);
});

Deno.test('site do autopilot: endereço interno não passa da normalização', () => {
  assertEquals(normalizeSiteUrl('minhamarca.com.br'), 'https://minhamarca.com.br/');
  for (const raw of ['169.254.169.254', 'http://169.254.169.254/latest', '127.0.0.1', 'localhost.', '10.0.0.1', '[::1]']) {
    assertEquals(normalizeSiteUrl(raw), null, raw);
  }
});

Deno.test('feed RSS: endereço interno vira motivo em português, sem buscar', async () => {
  for (const url of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1:8080/feed', 'http://localhost./rss']) {
    const result = await fetchFeed(url);
    assert(!result.ok, url);
    assertEquals(result.code, 'not_public', url);
    assertEquals(result.reason, 'Este endereço não é público. Use o link do feed aberto na internet.');
  }
});
