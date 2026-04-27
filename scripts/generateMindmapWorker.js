//@ts-check
'use strict';

/**
 * generateMindmapWorker.js — Worker Thread entry for mindmap HTML generation
 *
 * NFR: nfr_extended.concurrency.rule_cpu
 *   "CPU 바운드 작업은 Worker Thread 분리. 메인 이벤트 루프 블로킹 금지."
 *
 * This worker is spawned by createServer.js POST /api/mindmap/rebuild.
 * The heavy synchronous work (generate-mindmap.js, ~700KB HTML) runs here
 * so the main event loop is never blocked.
 *
 * Protocol:
 *   parentPort.postMessage({ ok: true, durationMs })   on success
 *   parentPort.postMessage({ ok: false, error: string }) on failure
 */

const { workerData, parentPort } = require('node:worker_threads');
const path = require('node:path');

const repoRoot = (workerData && workerData.repoRoot)
  ? workerData.repoRoot
  : path.resolve(__dirname, '..');

const start = Date.now();

try {
  // require() executes the script synchronously in this worker thread
  // — safe because worker threads have their own event loop
  require(path.join(repoRoot, 'scripts', 'generate-mindmap.js'));

  const durationMs = Date.now() - start;
  parentPort.postMessage({ ok: true, durationMs });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
}
