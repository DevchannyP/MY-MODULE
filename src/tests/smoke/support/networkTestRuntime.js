'use strict';

function isSocketListenPermissionError(error) {
  return Boolean(
    error
    && error.code === 'EPERM'
    && typeof error.message === 'string'
    && error.message.includes('listen')
  );
}

async function startServerOrSkip(t, startServer, options) {
  try {
    return await startServer(options);
  } catch (error) {
    if (isSocketListenPermissionError(error)) {
      t.skip('socket listen is not permitted in this environment');
      return null;
    }
    throw error;
  }
}

module.exports = {
  startServerOrSkip,
};
