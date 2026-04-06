'use strict';

const { startServer, createServer } = require('./server/createServer');
const { getFeatureFlags } = require('./infrastructure/FeatureFlagProvider');
const { emitStartupDiagnostic } = require('./infrastructure/startupDiagnostic');

async function main() {
  const port = Number(process.env.PORT || '3000');
  const host = process.env.HOST || '127.0.0.1';

  // 시작 진단: .env 로드 상태 + 활성 플래그 목록을 stderr에 출력
  emitStartupDiagnostic({ flagsProvider: getFeatureFlags() });

  const runtime = await startServer({ port, host });
  process.stdout.write(`my-module started on ${runtime.url}\n`);

  let stopping = false;
  const handleSignal = (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    runtime.shutdown({ reason: signal })
      .then(() => {
        process.stdout.write(`my-module drained and stopped after ${signal}\n`);
      })
      .catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
      })
      .finally(() => {
        process.exit();
      });
  };

  process.once('SIGTERM', () => handleSignal('SIGTERM'));
  process.once('SIGINT', () => handleSignal('SIGINT'));
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
