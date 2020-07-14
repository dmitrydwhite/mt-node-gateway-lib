const Inbound = require('./Inbound');
const Outbound = require('./Outbound');
const connectToMt = require('./connect');
const downloadStagedFromMt = require('./downloadStagedFile');
const uploadFileToMt = require('./uploadDownlinkedFile');
const { ONE_SECOND } = require('../constants');

const log = (...m) => console.dir(...m, { depth: null, colors: true });

/**
 * Create a new connection to Major Tom.
 * @param {Object} param0 The configuration for the gateway
 * @param {String} param0.host The Major Tom host
 * @param {String} param0.gatewayToken The Major Tom gateway token
 * @param {*} param0.sslVerify Wat?
 * @param {String} param0.basicAuth The basic auth string
 * @param {Boolean} param0.http True if the gateway should connect insecure
 * @param {*} param0.sslCaBundle I have no idea what this is
 * @param {Function} param0.commandCallback The function to call when the gateway receives a command from Major Tom
 * @param {Function} param0.errorCallback The function to call when an error message is received from Major Tom
 * @param {Function} param0.rateLimitCallback The function to call when a rate limit message is received from Major Tom
 * @param {Function} param0.cancelCallback The function to call when a cancel message is received from Major Tom
 */
const newNodeGateway = ({
  host,
  gatewayToken,
  sslVerify,
  basicAuth,
  http,
  sslCaBundle,
  commandCallback,
  errorCallback,
  rateLimitCallback,
  cancelCallback,
}) => {
  const restHost = `http${http ? '' : 's'}://${host}`;
  const majorTomOutbound = new Outbound();
  const fromMajorTom = new Inbound();
  let waiting = true;
  let majortom;

  majorTomOutbound.setEncoding('utf8');

  /**
   * Calls rateLimitCallback; if not implemented handles rate limiting.
   * @param {Object} message Object with rate limit information
   * @param {Number} message.rate The max number of messags per second
   * @param {Number} message.retry_after The number of seconds to wait before sending another message
   * @param {String} message.error The error message associated with the limiting
   */
  const rateLimitHandler = message => {
    const done = rateLimitCallback &&
      typeof rateLimitCallback === 'function' &&
      rateLimitCallback(message);

    if (!done) {
      const { rate, retry_after, error } = message.rate_limit;
      const delayMs = retry_after * ONE_SECOND;
      const waitBetweenMsgs = Math.floor(ONE_SECOND / rate);

      majorTomOutbound.pause();
      majorTomOutbound.setWaitTime(waitBetweenMsgs);

      setTimeout(() => {
        majorTomOutbound.resume();
      }, delayMs + waitBetweenMsgs)
    }
  };

  const commandHandler = message => {
    const done = commandCallback &&
      typeof commandCallback === 'function' &&
      commandCallback(message.command);

    if (!done) {
      if (!commandCallback) log('No command callback implemented');
      log('Command received:');
      log(message);
    }
  };

  const cancelHandler = message => {
    const done = cancelCallback &&
      typeof cancelCallback === 'function' &&
      cancelCallback(message.command.id);

    if (!done) {
      if (!cancelCallback) log('No cancel callback implemented');
      log('Cancel received');
      log(message);
    }
  };

  const errorHandler = message => {
    const done = errorCallback &&
      typeof errorCallback === 'function' &&
      errorCallback(message);

    if (!done) {
      if (!errorCallback) log('No error callback implemented');
      log('Error received:');
      log(message);
    }
  };

  const transmit = mtMsg => {
    let toSend;

    if (mtMsg instanceof Buffer) {
      toSend = mtMsg.toString();
    } else if (typeof mtMsg === 'string') {
      toSend = mtMsg;
    } else {
      toSend = JSON.stringify(mtMsg);
    }

    majorTomOutbound.write(toSend);
    log('Sending to Major Tom:');
    log(mtMsg);
  };

  const transmitCommandUpdate = (id, state, opts) => {
    const update = {
      type: 'command_update',
      command: {
        ...(opts || {}),
        id,
        state,
      },
    };

    transmit(update);
  };

  const transmitMetrics = metrics => {
    const measurements = {
      type: 'measurements',
      measurements: metrics.map(({
          system,
          subsystem,
          metric,
          value,
          timestamp,
        }) => ({
          system,
          subsystem,
          metric,
          value,
          timestamp: timestamp || Date.now(),
        })
      ),
    };

    transmit(measurements);
  };

  const transmitEvents = event => {
    const {
      command_id,
      debug,
      level,
      message,
      system,
      timestamp,
      type,
    } = event;

    const eventUpdate = {
      type: 'event',
      event: {
        command_id,
        debug,
        system,
        message,
        level: level || 'nominal',
        timestamp: timestamp || Date.now(),
        type: type || 'Gateway Event',
      },
    };

    transmit(eventUpdate);
  };

  const cancelCommand = id => transmitCommandUpdate(id, 'cancelled');
  const completeCommand = (id, output) => transmitCommandUpdate(id, 'completed', { output });
  const failCommand = (id, errors) => transmitCommandUpdate(id, 'failed', { errors });
  const transmittedCommand = (id, payload) =>
    transmitCommandUpdate(id, 'transmitted_to_system', { payload: payload || 'None Provided' });

  const updateCommandDefinitions = (system, definitions) => {
    const defsUpdate = {
      type: 'command_definitions_update',
      command_definitions: {
        system,
        definitions,
      },
    };

    transmit(defsUpdate);
  };

  const updateFileList = (system, files, timestamp) => {
    const filesUpdate = {
      type: 'file_list',
      file_list: {
        system,
        files,
        timestamp: timestamp || Date.now(),
      },
    };

    transmit(filesUpdate);
  };

  const handleMessage = message => {
    const { type } = message;

    manageOutbound(type);

    if (messageHandlers[type]) {
      return messageHandlers[type](message);
    }

    log(`Got unknown message type from Major Tom: ${message}`);
  };

  const manageOutbound = type => {
    if (type === 'error') {
      waiting = true;
      majorTomOutbound.pause();
      // majorTomOutbound.removeListener('data', sendToMt);
    }

    if (type === 'hello' && waiting) {
      let outbound;

      waiting = false;
      // majorTomOutbound.on('data', sendToMt);
      if (majorTomOutbound.isPaused()) {
        majorTomOutbound.resume();
      }

      startMtObStr();
    }
  };

  const startMtObStr = () => {
    majorTomOutbound.on('data', data => {
      majortom.send(data);
    })
  }

  const connect = () => {
    if (majortom) {
      return majortom.refresh();
    }

    majortom = connectToMt({ basicAuth, gatewayToken, host, useSecure: !http });

    majortom.on('message', receiveIncoming);
    majortom.open();

    fromMajorTom.on('data', handleMessage);
  };

  const receiveIncoming = data => {
    fromMajorTom.write(data);
  };

  /**
   * Asynchronously download a file that has been staged in Major Tom. If a resultStream is provided
   * then the file will be written to it in Buffer chunks. If not, then the whole file as a Buffer
   * will be the result of the resolved Promise.
   * @param {String} gatewayDownloadPath The path where the file is stored in Major Tom
   * @param {Stream} [resultStream] The stream to write the downloaded file data to
   */
  const downloadStagedFile = (gatewayDownloadPath, resultStream) => downloadStagedFromMt({
    gatewayDownloadPath,
    gatewayToken,
    restHost,
    resultStream,
    useSecure: !http,
  });

  /**
   * Upload a file to store it on Major Tom. Returns a promise that will resolve with the results of
   * the final REST request to Major Tom.
   * @param {String} fileName The file name
   * @param {String|Buffer} filePath May be the location where the file is stored, or the Buffer of the file contents
   * @param {String} system The system this file is from
   * @param {Number} [timestamp] The timestamp for this file, defaults to now
   * @param {String} [contentType] The file content type, defaults to "binary/octet-stream"
   * @param {Number} [commandId] If this upload is associated with a command, the id may be provided
   * @param {String} [metadata] Optional metadata to be stored with the file in Major Tom
   */
  const uploadDownlinkedFile = (
    fileName, filePath, system, timestamp, contentType, commandId, metadata
  ) => uploadFileToMt({
    fileName,
    filePath,
    system,
    timestamp,
    contentType,
    commandId,
    metadata,
    restHost,
    gatewayToken,
  });

  const messageHandlers = {
    hello: message => log(message),
    rate_limit: rateLimitHandler,
    command: commandHandler,
    error: errorHandler,
    cancel: cancelHandler,
  };

  return {
    connect,
    cancelCommand,
    completeCommand,
    failCommand,
    transmit,
    transmitCommandUpdate,
    transmitEvents,
    transmitMetrics,
    transmittedCommand,
    updateCommandDefinitions,
    updateFileList,
    downloadStagedFile,
    uploadDownlinkedFile,
  };
};

class NodeGateway {
  constructor(
    host,
    gatewayToken,
    sslVerify,
    basicAuth,
    http,
    sslCaBundle,
    commandCallback,
    errorCallback,
    rateLimitCallback,
    cancelCallback,
    verbose,
  ) {
    return newNodeGateway({
      host,
      gatewayToken,
      sslVerify,
      basicAuth,
      http,
      sslCaBundle,
      commandCallback,
      errorCallback,
      rateLimitCallback,
      cancelCallback,
    });
  }
}

module.exports = { NodeGateway, newNodeGateway };
