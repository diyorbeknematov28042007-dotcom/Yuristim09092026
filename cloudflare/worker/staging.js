// Isolated D1 connectivity probe. The business API and bot remain disabled
// until their full Worker runtime and secure secrets have been reviewed.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      return Response.json({ status: 'up', service: 'yuristim-v2-staging', apiReady: false });
    }
    if (request.method === 'GET' && path === '/ready') {
      return Response.json({ status: 'migration_incomplete', apiReady: false }, { status: 503 });
    }
    if (request.method === 'GET' && path === '/infra/ready') {
      try {
        const row = await env.DB.prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('users','ai_messages','credit_transactions','telegram_update_claims')",
        ).first();
        const ready = row?.count === 4;
        return Response.json(
          { status: ready ? 'schema_ready' : 'schema_missing', apiReady: false },
          { status: ready ? 200 : 503 },
        );
      } catch {
        return Response.json({ status: 'database_unavailable', apiReady: false }, { status: 503 });
      }
    }
    return Response.json(
      { error: 'MIGRATION_INCOMPLETE', message: 'The staging API and bot are not yet available.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  },
};
