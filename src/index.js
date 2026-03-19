'use strict';

const { startServer, createServer } = require('./server/createServer');

async function main() {
  const port = Number(process.env.PORT || '3000');
  const host = process.env.HOST || '127.0.0.1';
  const runtime = await startServer({ port, host });
  process.stdout.write(`my-module started on ${runtime.url}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  startServer,
};
