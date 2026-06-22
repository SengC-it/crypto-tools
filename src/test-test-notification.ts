import handler from '../api/test-notification';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  process.env.CRON_SECRET = 'unit-test-secret';

  let statusCode = 0;
  let payload: any = null;

  const req: any = {
    method: 'GET',
    headers: {},
    query: {},
  };

  const res: any = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: any) {
      payload = body;
      return this;
    },
  };

  await handler(req, res);

  assert(statusCode === 401, `expected 401 without secret, got ${statusCode}`);
  assert(payload?.error === 'Unauthorized', 'expected Unauthorized response');

  console.log('Test notification endpoint auth passed');
}

main().catch((err) => {
  console.error(`Test notification endpoint test failed: ${err.message}`);
  process.exit(1);
});
