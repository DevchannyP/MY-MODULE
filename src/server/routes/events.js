'use strict';

const { EventBus } = require('../../shared/EventBus');

function formatSse(eventName, payload) {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function createEventsRouteHandler() {
  const eventBus = EventBus.getInstance();

  return function handleEventsRoute(req, res, { url, responseHeaders = {} } = {}) {
    if (req.method !== 'GET' || url.pathname !== '/api/v1/system/events') {
      return false;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      ...responseHeaders,
    });
    res.write(formatSse('mpo.connected', {
      connected_at: new Date().toISOString(),
    }));

    const unsubscribe = eventBus.subscribe('*', (event) => {
      if (!event || typeof event.type !== 'string' || !event.type.startsWith('mpo.')) {
        return;
      }
      res.write(formatSse(event.type, {
        ...event,
        event_type: event.type,
      }));
    });

    req.on('close', () => {
      unsubscribe();
      res.end();
    });
    return true;
  };
}

module.exports = {
  createEventsRouteHandler,
};
