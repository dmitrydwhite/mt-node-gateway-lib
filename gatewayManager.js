const { EventEmitter } = require('events');
const { Writable, PassThrough } = require('stream');
const { newNodeGateway } = require('./index');
const { newSystemWs } = require('./systemWs');
const { newSystemUDP } = require('./systemUdp');

/**
 * Create an instance of the Major Tom Node Gateway Manager
 * @param {Object} param0 Instantiation details
 * @param {String} param0.host The Major Tom host, e.g. 'you.majortom.cloud'
 * @param {String} param0.gatewayToken The Major Tom gateway token
 * @param {String} [param0.basicAuth] The basic auth string if your instance of Major Tom requires it
 * @param {Boolean} [param0.http] True if the gateway should not use a secure connection to Major Tom
 * @param {Writable} [param0.receiveStream] The Node JS Stream to receive incoming data from systems on
 */
const newGatewayManager = ({
  host,
  gatewayToken,
  basicAuth,
  http,
  receiveStream,
}) => {
  const commandStream = new EventEmitter();
  const majorTomStream = new EventEmitter();
  const commandCallback = cmd => { commandStream.emit('transition', 'received_from_mt', cmd); };
  const cancelCallback = id => { commandStream.emit('transition', 'cancel_on_gateway', id); };
  const errorCallback = err => { majorTomStream.emit('major_tom_error', err); };
  const rateLimitCallback = msg => { majorTomStream.emit('rate_limit', msg); };
  const majorTom = newNodeGateway({
    host,
    gatewayToken,
    basicAuth,
    http,
    commandCallback,
    cancelCallback,
    errorCallback,
    rateLimitCallback,
  });
  const channelCreators = {
    // http: newSystemHTTP,
    // tcp: newSystemTCP,
    udp: newSystemUDP,
    websocket: newSystemWs,
  };
  const channelBus = {
    http: undefined,
    tcp: undefined,
    udp: undefined,
    websocket: undefined,
  };

  const internalStream = new PassThrough();

  const userListeners = {
    received_from_mt: undefined,
    preparing_on_gateway: undefined,
    gateway_prep_complete: undefined,
    uplinking_to_system: undefined,
    acked_by_system: undefined,
    executing_on_system: undefined,
    downlinking_from_system: undefined,
    done_on_system: undefined,
    processing_on_gateway: undefined,
    complete_on_gateway: undefined,
    cancel_on_gateway: undefined,
    cancelled: undefined,
    completed: undefined,
    failed: undefined,
  };

  const gatewayHandlers = {};
  const gatewayProcessers = {};
  let commandIsValid = () => true;

  const received_from_mtListener = data => {
    const validate = commandIsValid(data);

    if (validate instanceof Error) {
      commandStream.emit('transition', 'failed', data, validate);
    } else {
      majorTom.transmitCommandUpdate(data.id, 'preparing_on_gateway', data);
      process.nextTick(() => {
        commandStream.emit('transition', 'preparing_on_gateway', data);
      });
    }
  };
  const preparing_on_gatewayListener = data => {
    const { type } = data;
    console.log(type)

    if (gatewayHandlers[type]) {
      gatewayHandlers[type](data);
    } else {
      commandStream.emit('transition', 'gateway_prep_complete', data);
    }
  };
  const gateway_prep_completeListener = data => {
    const { system } = data;
    const destination = activeChannels()
      .find(channel => channel.getRegisteredSystems().includes(system));

    if (destination) {
      destination.send(data);
      commandStream.emit('transition', 'uplinking_to_system', data);
    } else {
      commandStream.emit('transition', 'failed', data, new Error(`Could not find destination system ${system}`));
    }
  };
  const uplinking_to_systemListener = data => {
    majorTom.transmitCommandUpdate(data.id, 'uplinking_to_system', data);
  };
  const acked_by_systemListener = data => {
    commandStream.emit('transition', 'executing_on_system', data);
    majorTom.transmitCommandUpdate(data.id, 'acked_by_system', data);
  };
  const executing_on_systemListener = data => {
    majorTom.transmitCommandUpdate(data.id, 'executing_on_system', data);
  };
  const downlinking_from_systemListener = data => {
    majorTom.transmitCommandUpdate(data.id, 'downlinking_from_system', data);
    if (gatewayHandlers.downlinking_from_system) {
      gatewayHandlers.downlinking_from_system(data);
    }
  };
  const done_on_systemListener = data => {
    commandStream.emit('transition', 'processing_on_gateway', data);
  };
  const processing_on_gatewayListener = data => {
    // TODO: We need to handle the possibility (probably reality) that the gateway handler will not
    // know the type, just the id.
    const { type } = data;

    majorTom.transmitCommandUpdate(data.id, 'processing_on_gateway', data);

    if (gatewayHandlers[type]) {
      gatewayHandlers[type](data);
    } else {
      commandStream.emit('transition', 'complete_on_gateway', data);
    }
  };
  const complete_on_gatewayListener = data => {
    commandStream.emit('transition', 'completed', data);
  };
  const cancel_on_gatewayListener = data => {
    if (gatewayHandlers.canceled) {
      gatewayHandlers.canceled(data);
    } else {
      commandStream.emit('transition', 'cancelled', data);
    }
  };
  const cancelledListener = data => {
    majorTom.cancelCommand(data.id);
  };
  const completedListener = data => {
    majorTom.completeCommand(data.id, data.output);
  };
  const failedListener = (data, errors) => {
    majorTom.failCommand(data.id, (Array.isArray(errors) ? errors : [errors]));
  };

  const listeners = {
    received_from_mt: userListeners.received_from_mt || received_from_mtListener,
    preparing_on_gateway: userListeners.preparing_on_gateway || preparing_on_gatewayListener,
    gateway_prep_complete: userListeners.gateway_prep_complete || gateway_prep_completeListener,
    uplinking_to_system: userListeners.uplinking_to_system || uplinking_to_systemListener,
    acked_by_system: userListeners.acked_by_system || acked_by_systemListener,
    executing_on_system: userListeners.executing_on_system || executing_on_systemListener,
    downlinking_from_system: userListeners.downlinking_from_system || downlinking_from_systemListener,
    done_on_system: userListeners.done_on_system || done_on_systemListener,
    processing_on_gateway: userListeners.processing_on_gateway || processing_on_gatewayListener,
    complete_on_gateway: userListeners.complete_on_gateway || complete_on_gatewayListener,
    cancel_on_gateway: userListeners.cancel_on_gateway || cancel_on_gatewayListener,
    cancelled: userListeners.cancelled || cancelledListener,
    completed: userListeners.completed || completedListener,
    failed: userListeners.failed || failedListener,
  };

  const oneChannel = () => {
    const channelArr = Object.values(channelBus).filter(x => x);

    if (channelArr.length === 1) {
      return channelArr[0];
    }
  };

  const activeChannels = () => Object.keys(channelBus)
      .filter(channelName => channelBus[channelName])
      .map(key => channelBus[key]);

  const isChannelName = str => Object.keys(channelBus).includes(str);

  const addSystem = (systemName, channel, destination) => {
    const singleChannel = oneChannel();
    const channelValid = channel && activeChannels().includes(channel.toLowerCase());
    const destChannel = singleChannel || channelValid;

    if (typeof systemName !== 'string') {
      throw new Error('System name must be a string');
    }

    if (!destChannel) {
      throw new Error(
        'Indicate what channel to add this system to; one of "http", "tcp", "udp", "websocket".'
      )
    }

    destChannel.registerSystem(systemName, destination);
  };

  /**
   *
   * @param {String} type Channel type; one of "http", "tcp", "udp", "websocket"
   * @param {Object} opts The channel configuration options
   * @param {String} [opts.host] The host or ip where this channel should connect; defaults to local host
   * @param {String|Number} opts.port The port for this channel to connect on
   * @param {Function} [opts.onmessage] The
   *
   */
  const addChannel = (type, opts) => {
    const creatorFn = channelCreators[type.toLowerCase()];

    if (!creatorFn) {
      throw new Error(
        `Cannot create channel of type ${type}; must be one of "http", "tcp", "udp", "websocket"`
      );
    }

    channelBus[type.toLowerCase()] = creatorFn({ ...(opts || {}), receiveStream: internalStream });
  };

  const addMessageHandler = (channel, handler) => {
    if (channelBus[channel]) {
      return channelBus[channel].onmessage(handler);
    }

    throw new Error(`Channel of type ${channel} has not been added`);
  };

  const connectToMajorTom = () => {
    majorTom.connect();
  };

  /**
   *
   * @param  {...String} destinations Any number of destination strings
   * @param {Function} translate The function to assign as the outbound translation function
   * @param {Boolean} [overwriteCustom] True if the passed function should replace a system's custom translation functions
   */
  const translateOutboundFor = (...args) => {
    const channels = [];
    const others = [];
    let overwriteCustom = false;
    let cb = args.pop();

    if (cb === true) {
      overwriteCustom = true;
      cb = args.pop();
    }

    if (typeof cb !== 'function') {
      throw new Error('You must provide a translating function');
    }

    if (args.length === 0) {
      throw new Error('You must provide the system(s) or channel(s) to translate for');
    }

    args.forEach(arg => {
      (isChannelName(arg) ? channels : others).push(arg);
    });

    [...channels, ...others].forEach(destination => {
      if (isChannelName(destination)) {
        channelBus[destination].wrap(cb);
      } else {
        const destChannel = activeChannels()
          .find(channel => channel.getRegisteredSystems().includes(destination));

        if (destChannel) {
          const addressDetail = destChannel.getAddressDetails()[destination];

          destChannel.unregisterSystem(destination);
          destChannel.registerSystem(destination, addressDetail, cb);
        }
      }
    });
  };

  /**
   *
   * @param  {...String} destinations Any number of destination strings
   * @param {Function} translate The function to assign as the outbound translation function
   * @param {Boolean} [overwriteCustom] True if the passed function should replace a system's custom translation functions
   */
  const translateInboundFor = (...args) => {
    const channels = [];
    const others = [];
    let overwriteCustom = false;
    let cb = args.pop();

    if (cb === true) {
      overwriteCustom = true;
      cb = args.pop();
    }

    if (typeof cb !== 'function') {
      throw new Error('You must provide a translating function');
    }

    if (args.length === 0) {
      throw new Error('You must provide the system(s) or channel(s) to translate for');
    }

    args.forEach(arg => {
      (isChannelName(arg) ? channels : others).push(arg);
    });

    [...channels, ...others].forEach(destination => {
      if (isChannelName(destination)) {
        channelBus[destination].unwrap(cb);
      } else {
        const destChannel = activeChannels()
          .find(channel => channel.getRegisteredSystems().includes(destination));

        if (destChannel) {
          const addressDetail = destChannel.getAddressDetails()[destination];

          destChannel.unregisterSystem(destination);
          destChannel.registerSystem(destination, addressDetail, undefined, cb);
        }
      }
    });
  };

  const handleOnGateway = (commandType, handler) => {
    if (typeof handler !== 'function') {
      throw new Error(`You must provide a function to handle commands of type ${commandType}`);
    }

    gatewayHandlers[commandType] = handler;
  };

  const processOnGateway = (commandType, handler) => {
    if (typeof handler !== 'function') {
      throw new Error(`You must provide a function to handle commands of type ${commandType}`);
    }

    gatewayProcessers[commandType] = handler;
  }

  const attachListener = (state, cb) => {
    if (typeof cb !== 'function') {
      throw new Error('You must attach a function as a listner callback');
    }

    if (Object.keys(listeners).includes(state)) {
      userListeners[state] = cb;
    } else {
      throw new Error(`Cannot attach a listener to state ${state} as it's not one we recognize.`);
    }
  };

  const removeListener = state => {
    if (Object.keys(listeners).includes(state)) {
      userListeners[state] = undefined;
    }
  };

  const validateCommand = cb => {
    if (typeof cb !== 'function') {
      throw new Error('Must use a function to validate commands');
    }

    commandIsValid = cb;
  }

  commandStream.on('transition', (nextState, data) => {
    if (listeners[nextState]) {
      listeners[nextState](data);
    } else {
      listeners.failed(data, new Error(`Gateway did not understand state ${nextState}`));
    }
  });

  internalStream.on('data', data => {
    const inputString = data.toString();
    const asObj = JSON.parse(inputString);
    const {
      command,
      command_definitions,
      event,
      file_list,
      downlinked_file,
      measurements,
      type,
    } = asObj;

    if (type === 'command_update' && command) {
      commandStream.emit('transition', command.state, command);
    } else if (type === 'command_definitions_update' && command_definitions) {
      const { system, definitions } = command_definitions;

      majorTom.updateCommandDefinitions(system, definitions);
    } else if (type === 'event' && event) {
      majorTom.transmitEvents(event);
    } else if (type === 'file_list' && file_list) {
      const { system, files, timestamp } = file_list;

      majorTom.updateFileList(system, files, timestamp);
    } else if (type === 'file_metadata_update' && downlinked_file) {
      majorTom.transmit(asObj);
    } else if (type === 'measurements' && measurements) {
      majorTom.transmitMetrics(measurements);
    }
  });

  if (receiveStream) {
    internalStream.pipe(receiveStream);
  }

  return {
    addChannel,
    addSystem,
    attachListener,
    removeListener,
    connectToMajorTom,
    translateOutboundFor,
    translateInboundFor,
    handleOnGateway,
    validateCommand,
  };
};

module.exports = newGatewayManager;
