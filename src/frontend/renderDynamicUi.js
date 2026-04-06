'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const { buildHomeRuntime } = require('../../scripts/generate-ui-home');

const REPO_ROOT = path.resolve(__dirname, '../..');
const ARTIFACTS_ROOT = path.join(REPO_ROOT, 'artifacts');

const MIME_TYPES = {
  '.ahk': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'application/yaml; charset=utf-8',
  '.yml': 'application/yaml; charset=utf-8',
};

const MAX_ETAG_PAYLOAD_BYTES = 256 * 1024;

function getMimeType(absolutePath) {
  return MIME_TYPES[path.extname(absolutePath).toLowerCase()] || 'application/octet-stream';
}

function createEtag(payload) {
  return `"${crypto.createHash('sha256').update(payload).digest('hex')}"`;
}

function etagMatches(headerValue, etag) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) {
    return false;
  }
  return headerValue
    .split(',')
    .map((item) => item.trim())
    .includes(etag);
}

function sendContent(req, res, status, contentType, body) {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const headers = {
    'content-type': contentType,
    'content-length': String(payload.length),
    'cache-control': 'no-store',
  };
  if (
    (req.method || 'GET') === 'GET'
    || (req.method || 'GET') === 'HEAD'
  ) {
    if (payload.length <= MAX_ETAG_PAYLOAD_BYTES) {
      const etag = createEtag(payload);
      headers.etag = etag;
      headers['cache-control'] = 'private, max-age=0, must-revalidate';
      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.writeHead(304, headers);
        res.end();
        return;
      }
    }
  }
  res.writeHead(status, headers);
  if ((req.method || 'GET') === 'HEAD') {
    res.end();
    return;
  }
  res.end(payload);
}

function tryServeFile(req, res, absolutePath) {
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return false;
  }
  sendContent(req, res, 200, getMimeType(absolutePath), fs.readFileSync(absolutePath));
  return true;
}

function tryServeArtifact(req, res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const relativePath = normalized.replace(/^\/+/, '');
  const absolutePath = path.resolve(ARTIFACTS_ROOT, relativePath);
  const relativeToArtifacts = path.relative(ARTIFACTS_ROOT, absolutePath);
  if (relativeToArtifacts.startsWith('..') || path.isAbsolute(relativeToArtifacts)) {
    return false;
  }
  return tryServeFile(req, res, absolutePath);
}

function tryServeDynamicUi(req, res, pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    sendContent(req, res, 200, 'text/html; charset=utf-8', buildHomeRuntime().html);
    return true;
  }

  if (pathname === '/mindmap' || pathname === '/mindmap/' || pathname === '/mindmap/index.html') {
    return tryServeArtifact(req, res, '/mindmap/index.html');
  }

  if (pathname === '/catalog' || pathname === '/catalog/' || pathname === '/catalog-site' || pathname === '/catalog-site/' || pathname === '/catalog-site/index.html') {
    return tryServeArtifact(req, res, '/catalog-site/index.html');
  }

  if (pathname === '/study-guide' || pathname === '/study-guide/' || pathname === '/study-guide/index.html') {
    return tryServeArtifact(req, res, '/study-guide/index.html');
  }

  return tryServeArtifact(req, res, pathname);
}

module.exports = {
  tryServeDynamicUi,
};
