const EventEmitter = require('events');
const Inbound = require('./Inbound');
const Outbound = require('./Outbound');
const connectToMt = require('./connect');
const downloadStagedFromMt = require('./downloadStagedFile');
const uploadFileToMt = require('./uploadDownlinkedFile');
const { ONE_SECOND, ONE_MINUTE } = require('../constants');

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
 * @param {Function} param0.blobCallback The function to call when the gateway receives a blob message from Major Tom
 * @param {Function} param0.errorCallback The function to call when an error message is received from Major Tom
 * @param {Function} param0.rateLimitCallback The function to call when a rate limit message is received from Major Tom
 * @param {Function} param0.cancelCallback The function to call when a cancel message is received from Major Tom
 * @param {Function} param0.transitCallback The function to call when a transit message is received from Major Tom
 * @param {Function} param0.blobsFinishedCallback The function to call when a blob_data_finished message is received from Major Tom
 * @param {Boolean} param0.verbose True if this should log to console
 * @param {Function} param0.customLogger A custom logging function that an implementer can use
 */
const newNodeGateway = ({
  host,
  altRestHost,
  gatewayToken,
  sslVerify,
  basicAuth,
  http,
  sslCaBundle,
  commandCallback,
  blobCallback,
  errorCallback,
  rateLimitCallback,
  cancelCallback,
  transitCallback,
  blobsFinishedCallback,
  verbose,
  customLogger,
}) => {
  const restHost = `http${http ? '' : 's'}://${basicAuth || ''}${altRestHost || host}`;
  const majorTomOutbound = new Outbound();
  const fromMajorTom = new Inbound();
  const eventBus = new EventEmitter();
  let waiting = true;
  let majortom;

  majorTomOutbound.setEncoding('utf8');

  /********** These are methods used internally by the library **********/

  const internalLogger = (...m) => {
    if (!verbose) return;

    const writeArgs = m.map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg);
      }

      return arg;
    });

    process.stdout.write([...writeArgs, '\n'].join(' '));
  };

  let log = (typeof customLogger === 'function' && customLogger) || internalLogger;

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

    if (!done && !majorTomOutbound.isPaused()) {
      majorTomOutbound.pause();

      const { rate, retry_after, error } = message.rate_limit;
      const delayMs = retry_after * ONE_SECOND;
      const waitBetweenMsgs = Math.floor(ONE_MINUTE / rate);

      log(`⚠️ Received rate limit message, throttling to 1 message every ${waitBetweenMsgs}ms`);

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
      eventBus.emit('command', message.command);
      if (!commandCallback) log('No command callback implemented');
      log('Command received:', message);
    }
  };

  const blobHandler = message => {
    const done = blobCallback &&
      typeof blobCallback === 'function' &&
      blobCallback(message);

    if (!done) {
      eventBus.emit('blob', message);
      if (!blobCallback) log('No blob callback implemented');
      log(`Blob string received`);
    }
  };

  const cancelHandler = message => {
    const done = cancelCallback &&
      typeof cancelCallback === 'function' &&
      cancelCallback(message.command.id);

    if (!done) {
      eventBus.emit('cancel', message.command.id);
      if (!cancelCallback) log('No cancel callback implemented');
      log('Cancel received:', message);
    }
  };

  const errorHandler = message => {
    const done = errorCallback &&
      typeof errorCallback === 'function' &&
      errorCallback(message);

    if (!done) {
      eventBus.emit('majorTomError', message);
      if (!errorCallback) log('No error callback implemented');
      log('Error received:', message);
    }
  };

  const transitHandler = message => {
    const done = transitCallback &&
      typeof transitCallback === 'function' &&
      transitCallback(message);

    if (!done) {
      eventBus.emit('transit', message);
      if (!transitCallback) log('No transit callback implemented');
      log('Major Tom expects a ground-station transit will occur: ', message);
    }
  };

  const blobFinishedHandler = message => {
    const done = blobsFinishedCallback &&
      typeof blobsFinishedCallback === 'function' &&
      blobsFinishedCallback(message);

    if (!done) {
      eventBus.emit('blobsFinished', message);
      if (!blobsFinishedCallback) log('No blob_data_finished callback implemented');
      log('Received blobs finished message: ', message);
    }
  }

  const handleMessage = message => {
    const { type } = message;

    manageIncomingErrorOrHello(type);

    if (messageHandlers[type]) {
      return messageHandlers[type](message);
    }

    log(`Got unknown message type from Major Tom: ${message}`);
  };

  const manageIncomingErrorOrHello = type => {
    if (type === 'error') {
      waiting = true;
      majorTomOutbound.pause();
    }

    if (type === 'hello' && waiting) {
      waiting = false;

      if (majorTomOutbound.isPaused()) {
        majorTomOutbound.resume();
      }

      startMajorTomOutboundStream();
    }
  };

  const startMajorTomOutboundStream = () => {
    majorTomOutbound.on('data', data => {
      log('Sending to Major Tom:', data);
      majortom.send(data);
    })
  };

  const messageHandlers = {
    hello: message => log(message),
    rate_limit: rateLimitHandler,
    command: commandHandler,
    error: errorHandler,
    cancel: cancelHandler,
    transit: transitHandler,
    received_blob: blobHandler,
    blob_data_finished: blobFinishedHandler,
  };

  /********** These are methods exposed to the library **********/

  /**
   * Takes a Buffer, String, or Object. If Buffer or String is received, assumes that it is properly
   * formatted JSON. Converts a received Object to a JSON string. Transmits the JSON to Major Tom.
   * @param {Buffer|String|Object} mtMsg The message to send to Major Tom
   */
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
  };

  /**
   *
   * @param {Buffer} blob
   */
  const transmitBlobForUplink = (blob, metaDataObj) => {
    if (!(blob instanceof Buffer)) {
      transmitEvents({
        level: 'critical',
        type: 'Gateway Error',
        message: 'Attempted to transmit a blob for uplink but received data type that is not a Buffer',
        debug: JSON.stringify({
          received: blob,
        }),
      });

      return;
    }

    if (metaDataObj && (typeof metaDataObj !== 'object') || Array.isArray(metaDataObj)) {
      transmitEvents({
        level: 'warning',
        type: 'Gateway Warning',
        message: 'Metadata for transmit blob for uplink must be an Object',
        debug: JSON.stringify({
          metadata: metaDataObj,
        }),
      });

      return;
    }

    transmit({
      type: 'transmit_blob',
      blob: blob.toString('base64'),
      ...(metaDataObj || {}),
    });
  };

  /**
   * Transmits a command update to Major Tom for the provided command ID.
   * @param {Number} id The command ID
   * @param {String} state The new command state
   * @param {Object} [opts] May be an object with additional command update fields, e.g. 'status', 'payload', 'output', 'errors'
   */
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

  /**
   * Transmits an Array of metrics using the 'measurements' type of message to Major Tom.
   * @typedef {Object} MetricObject
   * @prop {String} system The system associated with the metric
   * @prop {String} subsystem The subsystem associated with the metric
   * @prop {String} metric The name of the metric
   * @prop {Number} value The value of the metric
   * @prop {Number} timestamp The time the metric was created; will be assigned to received time if not present
   * @param {MetricObject[]} metrics The Array of metric objects to send to Major Tom
   */
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

  /**
   * Transmit the passed event to Major Tom
   * @typedef {Object} EventObject
   * @prop {Number} command_id The associated command ID
   * @prop {String} debug The debug string for the event
   * @prop {String} level One of 'nominal', 'warning', 'debug', 'error', 'critical'
   * @prop {String} message The event message string
   * @prop {String} system The system associated with this event
   * @prop {Number} timestamp The time for this event
   * @prop {String} type Description of the type of event
   * @param {EventObject|EventObject[]} eventParam The event to transmit
   */
  const transmitEvents = eventParam => {
    const events = (Array.isArray(eventParam) ? eventParam : [eventParam]).map(event => {
      const {
        command_id,
        debug,
        level,
        message,
        system,
        timestamp,
        type,
      } = event;

      return {
        command_id,
        debug,
        system,
        message: message || 'No message description received at gateway',
        level: level || 'nominal',
        timestamp: timestamp || Date.now(),
        type: type || 'Gateway Event',
      };
    });

    const eventUpdate = {
      type: 'event',
      events,
    };

    transmit(eventUpdate);
  };

  /**
   * Informs Major Tom that the command associated with the passed ID has been canceled. Shorthand
   * for calling transmitCommandUpdate with a state of 'cancelled'.
   * @param {Number} id The ID of the command to cancel
   */
  const cancelCommand = id => transmitCommandUpdate(id, 'cancelled');

  /**
   * Informs Major Tom that the command associated with the passed ID has successfully finished.
   * Shorthand for calling transmitCommandUpdate with a state of 'completed'.
   * @param {Number} id The ID of the command that has been completed
   * @param {String} [output] The output of the command
   */
  const completeCommand = (id, output) => transmitCommandUpdate(id, 'completed', { output });

  /**
   * Informs Major Tom that the command associated with the passed ID has failed. Shorthand for
   * calling transmitCommandUpdate with a state of 'failed'.
   * @param {Number} id The ID of the command that has failed
   * @param {Error[]} [errors] An array of the errors that occurred causing command failure
   */
  const failCommand = (id, errors) => transmitCommandUpdate(id, 'failed', { errors });

  /**
   * Informs Major Tom that the command associated with the passed ID has been sent to the system.
   * Shorthand for calling transmitCommandUpdate with a status of 'transmitted_to_system'.
   * @param {Number} id The id of the command that has been transmitted to the system
   * @param {String} [payload] The payload that was sent to the system
   */
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

  /**
   * Connect to the Major Tom WebSocket using the host, token, and security credentials provided at
   * instantiation.
   */
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
   * @param {Boolean} [keepAlive] If true, resultStream.end() will not be called
   */
  const downloadStagedFile = (gatewayDownloadPath, resultStream, keepAlive) => downloadStagedFromMt({
    gatewayDownloadPath,
    gatewayToken,
    restHost,
    resultStream,
    keepAlive,
    useSecure: !http,
    basicAuth,
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
    basicAuth,
  });

  /**
   * Provides access to the stream of messages coming from Major Tom
   * @returns {Inbound} Subclass of Transform stream
   */
  const pipeFromMajorTom = () => fromMajorTom;

  /**
   * Provides access to the single stream of messages to be sent to Major Tom
   * @returns {Outbound} Subclass of Duplex stream
   */
  const pipeToMajorTom = () => majorTomOutbound;

  /********** Here we also expose an event emitter interface to the API **********/
  const emitterInterface = {};

  for (prop in eventBus) {
    emitterInterface[prop] = eventBus[prop];
  }

  /**
   * Return the API surface:
   */
  return {
    connect,
    pipeFromMajorTom,
    pipeToMajorTom,
    transmit,
    transmitCommandUpdate,
    transmitEvents,
    transmitMetrics,
    transmitBlobForUplink,
    transmittedCommand,
    cancelCommand,
    completeCommand,
    failCommand,
    updateCommandDefinitions,
    updateFileList,
    downloadStagedFile,
    uploadDownlinkedFile,
    ...emitterInterface,
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
    transitCallback,
    blobsFinishedCallback,
    verbose,
    customLogger,
    altRestHost,
    blobCallback
  ) {
    return newNodeGateway({
      host,
      altRestHost,
      gatewayToken,
      sslVerify,
      basicAuth,
      http,
      sslCaBundle,
      commandCallback,
      errorCallback,
      rateLimitCallback,
      cancelCallback,
      transitCallback,
      blobsFinishedCallback,
      verbose,
      customLogger,
      blobCallback,
    });
  }
}

module.exports = { NodeGateway, newNodeGateway };
