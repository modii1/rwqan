import { TestSuiteDefinition } from '../src/runner';

export const liveApiSuite: TestSuiteDefinition = {
  name: 'live-api',
  notes: 'Live API tests against localhost:5001. Safe, read-only or pure compute. No destructive writes.',
  cases: [
    {
      id: 'API-001',
      feature: 'api/packages',
      flow: 'get',
      expected: '200 OK, JSON array or structure',
      severity: 'MEDIUM',
      status: 'PASS',
      run: async () => {
        const res = await fetch('http://localhost:5001/api/packages', { method: 'GET' });
        if (res.status !== 200) throw new Error(`status=${res.status}`);
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('application/json')) throw new Error(`ct=${ct}`);
        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('not_array');
        return { actual: `status=200 count=${data.length}`, status: 'PASS' };
      },
    },
    {
      id: 'API-002',
      feature: 'api/payment/calculate',
      flow: 'post-pure-compute',
      expected: '200 OK with pricing breakdown (no money movement)',
      severity: 'HIGH',
      status: 'PASS',
      run: async () => {
        const pkgsRes = await fetch('http://localhost:5001/api/packages', { method: 'GET' });
        const pkgs = (await pkgsRes.json()) as any[];
        if (!Array.isArray(pkgs) || pkgs.length === 0) throw new Error('no_packages_available');
        const packageId = pkgs[0].id;
        const res = await fetch('http://localhost:5001/api/payment/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId }),
        });
        if (res.status !== 200) throw new Error(`status=${res.status} packageId=${packageId}`);
        const data: any = await res.json();
        if (!data || !data.pricing) throw new Error('missing_pricing');
        return { actual: `status=200 packageId=${packageId} has_pricing`, status: 'PASS' };
      },
    },
    {
      id: 'API-003',
      feature: 'home',
      flow: 'get',
      expected: '200 OK',
      severity: 'LOW',
      status: 'PASS',
      run: async () => {
        const res = await fetch('http://localhost:5001/', { method: 'GET' });
        if (res.status !== 200) throw new Error(`status=${res.status}`);
        return { actual: `status=${res.status}`, status: 'PASS' };
      },
    },
  ],
};
