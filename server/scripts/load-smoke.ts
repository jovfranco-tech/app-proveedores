const baseUrl = process.env.LOAD_TEST_BASE_URL ?? process.env.API_BASE_URL ?? 'http://127.0.0.1:5174';
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY ?? 10);
const rounds = Number(process.env.LOAD_TEST_ROUNDS ?? 3);

async function timed(path: string, init?: RequestInit, expectedStatus = 200) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const ms = Math.round(performance.now() - start);
  return { path, status: response.status, expectedStatus, ok: response.status === expectedStatus, ms };
}

async function login(role: 'cliente' | 'proveedor' | 'admin') {
  const emails = {
    cliente: 'cliente@conectapro.mx',
    proveedor: 'proveedor@conectapro.mx',
    admin: 'admin@conectapro.mx'
  };
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, email: emails[role], password: process.env.DEMO_PASSWORD ?? 'Demo123!' })
  });
  if (!response.ok) throw new Error(`Login ${role} fallo: ${response.status}`);
  const body = (await response.json()) as { data: { accessToken: string } };
  return body.data.accessToken;
}

const clientToken = await login('cliente');
const providerToken = await login('proveedor');

const jobs: Array<Promise<{ path: string; status: number; expectedStatus: number; ok: boolean; ms: number }>> = [];
for (let round = 0; round < rounds; round += 1) {
  for (let index = 0; index < concurrency; index += 1) {
    jobs.push(timed('/api/categories'));
    jobs.push(timed('/api/health'));
    jobs.push(timed('/api/requests', { headers: { Authorization: `Bearer ${providerToken}` } }));
  }
}

jobs.push(
  timed('/api/requests', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Presupuesto invalido',
      categoryId: 'cerrajeria',
      address: 'CDMX',
      dateTime: new Date(Date.now() + 86_400_000).toISOString(),
      budget: 0,
      description: 'Debe fallar por presupuesto invalido.'
    })
  }, 400)
);

const results = await Promise.all(jobs);
const failures = results.filter((result) => !result.ok);
const sorted = [...results].sort((a, b) => a.ms - b.ms);
const p95 = sorted[Math.floor(sorted.length * 0.95)]?.ms ?? 0;

console.log(
  JSON.stringify(
    {
      baseUrl,
      requests: results.length,
      failures: failures.length,
      p95Ms: p95,
      slowest: sorted.slice(-5)
    },
    null,
    2
  )
);

if (failures.length) {
  process.exitCode = 1;
}

export {};
