import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('API health foundation', () => {
  it('returns a structured health response', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBeTypeOf('string');
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'yuristim-api',
    });
  });

  it('reports readiness', async () => {
    const app = buildApp({ logger: false });
    apps.push(app);

    const response = await app.inject({
      method: 'GET',
      url: '/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      service: 'yuristim-api',
    });
  });
});
