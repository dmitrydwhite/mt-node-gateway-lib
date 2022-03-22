const { ONE_SECOND } = require("../constants");

/**
 * A light wrapper around a passed WebSocket implementation that allows
 * the implementer to retry and refresh a single connection.
 * @param {String} wsUrl The websocket url to connect
 * @param {Array} protocols Protocols to use to connect to the server
 * @param {Object} opts The config options for instantiation
 * @param {Number} opts.maxRetries Maximum number of times to retry connection if it errors or is closed
 * @param {Number} opts.retryDelay The delay in ms between retry attempts
 * @param {Number} opts.timeoutWait The number of ms to wait for an open event before the connection is considered timed out
 * @param {WebSocket} WebSocket The WebSocket class to use
 */
const ReconnectingWebsocket = (wsUrl, protocols, opts, WebSocket) => {
  // Private consts
  const url = wsUrl;
  const handlers = {
    open: undefined,
    close: undefined,
    message: undefined,
    error: undefined,
  };

  // Vars passed in opts
  const config = opts || {};
  const passedMaxRetries = config.maxRetries;
  let timeoutWait = config.timeoutWait || 2 * ONE_SECOND;
  let retryDelay = config.retryDelay || 5 * ONE_SECOND;
  let maxRetries = Number.isFinite(passedMaxRetries)
    ? passedMaxRetries
    : 3;

  // Private stateful vars
  let internalTimeout = null;
  let openConfirmTimer = null;
  let retryAttempts = 0;
  let protocol;
  let readyState;
  let ws;

  const on = (eventType, listener) => {
    if (
      Object.keys(handlers).includes(eventType) &&
      typeof listener === 'function'
    ) {
      handlers[eventType] = listener;
    }
  };

  const off = (eventType) => {
    if (Object.keys(handlers).includes(eventType)) {
      handlers[eventType] = undefined;
    }
  };

  const open = () => {
    ws = new WebSocket(url, protocols || []);
    ws.binaryType = 'blob';
    readyState = WebSocket.CONNECTING;

    const localWs = ws;

    clearTimeout(internalTimeout);

    // If we don't hear the 'open' or 'close' events before the
    // timeoutWait, then we'll call close ourselves.
    internalTimeout = setTimeout(() => {
      localWs.close();
    }, timeoutWait);

    ws.onopen = () => {
      // We are open, so don't trigger the close from above
      clearTimeout(internalTimeout);

      protocol = ws.protocol;
      readyState = WebSocket.OPEN;

      if (handlers.open) handlers.open();

      openConfirmTimer = setTimeout(() => {
        // We don't have a great way to confirm that the WebSocket is
        // reliably open; we can hear 'open' event, followed quickly
        // by 'close' event. We'll wait 500ms here, and if nothing
        // clears this timeout, we'll reset the retryAttempst counter.
        retryAttempts = 0;
      }, 500);
    };

    ws.onclose = event => {
      const closeData = event ? {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      } : undefined;

      if (event && event.wasClean === false) {
        retryAttempts += 1;
      }

      clearTimeout(internalTimeout);
      clearTimeout(openConfirmTimer);

      if (handlers.close) handlers.close(closeData);

      ws = null;

      if (retryAttempts >= maxRetries) {
        readyState = WebSocket.CLOSED;
        return;
      }

      readyState = WebSocket.CONNECTING;

      internalTimeout = setTimeout(() => {
        clearTimeout(internalTimeout);
        open();
      }, retryDelay);
    };

    ws.onmessage = chunk => {
      if (handlers.message) handlers.message(chunk);
    };

    ws.onerror = (...args) => {
      if (handlers.error) handlers.error(...args);
    }
  };

  const refresh = () => {
    retryAttempts = 0;

    if (ws && ws.readyState === 1) return;

    ws = null;
    open();
  };

  const getReadyState = () => readyState;
  const getProtocol = () => protocol;
  const getMaxRetries = () => maxRetries;
  const setMaxRetries = x => {
    if (Number.isFinite(x)) {
      maxRetries = x;
    }
  };
  const getTimeoutWait = () => timeoutWait;
  const setTimeoutWait = x => {
    if (Number.isFinite(x)) {
      timeoutWait = x;
    }
  };
  const getRetryDelay = () => retryDelay;
  const setRetryDelay = x => {
    if (Number.isFinite(x)) {
      retryDelay = x;
    }
  };

  const send = data => {
    if (!ws || !readyState) {
      refresh();
      setTimeout(() => {
        send(data);
      }, 750);
      // throw new Error(`Failed to execute 'send' on 'WebSocket': WebSocket has not been opened`)
    } else if (readyState === WebSocket.CONNECTING) {
      setTimeout(() => {
        send(data);
      }, 750);
      // throw new Error(`Failed to execute 'send' on 'WebSocket': Still in ${readyState} state.`);
    } else if (readyState === WebSocket.CLOSING || readyState === WebSocket.CLOSED) {
      refresh();
      setTimeout(() => {
        send(data);
      }, 750);
    }

    ws.send(data)
  };

  return {
    on,
    off,
    open,
    refresh,
    send,
    getReadyState,
    getProtocol,
    getMaxRetries,
    setMaxRetries,
    getTimeoutWait,
    setTimeoutWait,
    getRetryDelay,
    setRetryDelay,
  }
};

module.exports = ReconnectingWebsocket;
