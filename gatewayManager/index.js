const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const { majorTomGatewayManagerStates: gatewayStates } = require('../constants');
const createChannelBus = require('./channelBus');
const createCommandQueue = require('./commandQueue');
const { newNodeGateway } = require('../gatewayAPI');

/**
 * Create an instance of the Major Tom Node Gateway Manager
 * @param {Object} param0 Instantiation details
 * @param {String} param0.host The Major Tom host, e.g. 'you.majortom.cloud'
 * @param {String} param0.gatewayToken The Major Tom gateway token
 * @param {String} [param0.basicAuth] The basic auth string if your instance of Major Tom requires it
 * @param {Boolean} [param0.http] True if the gateway should not use a secure connection to Major Tom
 * @param {Writable} [param0.receiveStream] The Node JS Stream to receive incoming data from systems on
 * @param {Boolean} [param0.noQueue] True if the system can handle the transmission of multiple ongoing commands at once
 */
const newGatewayManager = ({
  host,
  gatewayToken,
  basicAuth,
  http,
  receiveStream,
  noQueue,
}) => {
  // These are some state manager helpers for this instance
  const channelBus = createChannelBus();
  const commandQueuer = createCommandQueue(noQueue);

  // These are objects that can be added to by the instance implementer
  const userListeners = {};
  const idMap = {};
  const validateByType = {};
  const commandHandlers = {};
  const idProcessors = {};
  const typeProcessors = {};

  // These are the stream and event managers for this instance
  const internalStream = new PassThrough();
  const commandStream = new EventEmitter();
  const majorTomStream = new EventEmitter();

  // Here we use the emitters to set up our connection to Major Tom
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

  // This is a general command validator function that can be overridden by the implementer
  let commandIsValid = () => true;

  /**
   * @private
   * Constructor for exposing the ability to translate messages coming from and going to systems.
   * @param {String} path Which direction (inbound or outbound) this is translating for
   */
  const translateFor = path => (...args) => {
    const channels = [];
    const others = [];
    let overwriteCustom = false;
    let cb = args.pop();

    if (typeof cb === 'boolean') {
      overwriteCustom = cb;
      cb = args.pop();
    }

    if (typeof cb !== 'function') {
      throw new Error('You must provide a translating function');
    }

    if (args.length === 0) {
      throw new Error('You must provide the system(s) or channel(s) to translate for');
    }

    args.forEach(arg => {
      (channelBus.has(arg) ? channels : others).push(arg);
    });

    [...channels, ...others].forEach(destination => {
      if (channelBus.get(destination)) {
        channelBus.get(destination)[path === 'inbound' ? 'unwrap' : 'wrap'](cb);
      } else {
        const destChannel = channelBus.allActives()
          .find(channel => channel.getRegisteredSystems().includes(destination));

        if (destChannel) {
          const addressDetail = destChannel.getAddressDetails()[destination];
          const registerArgs = path === 'inbound' ? [undefined, cb] : [cb];

          destChannel.unregisterSystem(destination);
          destChannel.registerSystem(destination, addressDetail, ...registerArgs);
        }
      }
    });
  };

  const checkCommandValid = data => {
    const { type } = data;

    if (validateByType[type]) {
      return validateByType[type](data);
    }

    return commandIsValid(data);
  };

  const makeCb = (next, id) => (...args) => {

  };

  const addChannel = (type, opts) => {
    const channelType = type.toLowerCase();
    const options = { ...(opts || {}), receiveStream: internalStream };

    channelBus.create(channelType, options);
  };

  const addSystem = (systemName, channel, destination) => {
    if (typeof systemName !== 'string') {
      throw new Error('System name must be a string');
    }

    const channelName = (channel || '').toLowerCase();
    const validChannel = channelBus.get(channelName);

    if (!validChannel) {
      throw new Error(
        'Indicate what channel to add this system to; one of "http", "tcp", "udp", "websocket".'
      )
    }

    validChannel.registerSystem(systemName, destination);
    commandQueuer.addSystem(systemName);
  };

  const connectToMajorTom = () => { majorTom.connect(); };

  const validateCommand = (cmdType, callback) => {
    if (typeof cmdType === 'string') {
      if (typeof callback !== 'function') {
        throw new Error(
          `Pass a function as the second argument to validateCommand that will be used to validate commands of type ${cmdType}`
        );
      }

      validateByType[cmdType] = callback;
    } else if (typeof cmdType === 'function') {
      commandIsValid = cmdType;
    } else {
      throw new Error(
        'Method signature not recognized: validateCommand can take either a single function to validate all command types, or a command type string and fucntion validator for that command type.'
      );
    }
  };

  const triggerCommandFinish = data => {
    const { id, system } = data;
    const foundSystem = system || (idMap[id] || {}).system || '';

    commandQueuer.finishItemOnQueue(foundSystem);

    const nextCommand = commandQueuer.getNextForSystem(foundSystem);

    if (nextCommand) {
      commandStream.emit('transition', 'uplinking_to_system', nextCommand);
    }

    delete idMap[id];
  };

  const defaultListeners = {
    received_from_mt: data => {
      const valid = checkCommandValid(data);

      if (valid instanceof Error) {
        commandStream.emit('transition', 'failed', data, valid);
      } else {
        majorTom.transmitCommandUpdate(data.id, 'preparing_on_gateway', data);
        setImmediate(() => {
          commandStream.emit('transition', 'preparing_on_gateway', data);
        });
      }
    },
    preparing_on_gateway: data => {
      const { id, type } = data;
      const handlerFn = commandHandlers[type];

      idMap[id] = data;

      if (!handlerFn) {
        return commandStream.emit('transition', 'gateway_prep_complete', data);
      }

      const makeCb = next => arg => {
        let errorArg;

        if (typeof arg === 'function') {
          idProcessors[data.id] = arg;
        } else if (arg instanceof Error) {
          errorArg = arg;
        }

        setImmediate(() => commandStream.emit('transition', next, data, errorArg));
      };

      const done = makeCb('gateway_prep_complete');
      const completeCommand = makeCb('completed');
      const failCommand = makeCb('failed');

      handlerFn(data, done, completeCommand, failCommand);
    },
    gateway_prep_complete: data => {
      const { system } = data;
      const destination = channelBus
        .allActives()
        .find(channel => channel.getRegisteredSystems().includes(system));

      if (destination) {
        commandStream.emit('transition', 'ready_for_system', data);
      } else {
        commandStream.emit(
          'transition',
          'failed',
          data,
          new Error(`Could not find destination system ${system}`)
        );
      }
    },
    ready_for_system: data => {
      const { system } = data;

      commandQueuer.queueForSystem(system, data);
      setImmediate(() => {
        if (commandQueuer.systemReady(system)) {
          commandStream.emit('transition', 'uplinking_to_system', commandQueuer.getNextForSystem(system));
        }
      });
    },
    uplinking_to_system: data => {
      const { system } = data;
      const destination = channelBus
        .allActives()
        .find(channel => channel.getRegisteredSystems().includes(system));

      majorTom.transmitCommandUpdate(data.id, 'uplinking_to_system', data);
      destination.send(data);
    },
    acked_by_system: data => {
      majorTom.transmitCommandUpdate(data.id, 'acked_by_system', data);
    },
    executing_on_system: data => {
      majorTom.transmitCommandUpdate(data.id, 'executing_on_system', data);
    },
    downlinking_from_system: data => {
      majorTom.transmitCommandUpdate(data.id, 'downlinking_from_system', data);

      if (commandHandlers.downlinking_from_system) {
        commandHandlers.downlinking_from_system(data);
      }
    },
    done_on_system: data => {
      const { id, system } = data;
      const foundSystem = system || idMap[id].system || '';

      commandQueuer.finishItemOnQueue(foundSystem);

      const nextCommand = commandQueuer.getNextForSystem(foundSystem);

      if (nextCommand) {
        commandStream.emit('transition', 'uplinking_to_system', nextCommand);
      }

      commandStream.emit('transition', 'processing_on_gateway', data);
    },
    processing_on_gateway: data => {
      const { id, type } = data;
      const processerFn = idProcessors[id] || typeProcessors[type || idMap[id].type];

      majorTom.transmitCommandUpdate(id, 'processing_on_gateway', data);

      if (!processerFn) {
        return commandStream.emit('transition', 'complete_on_gateway', data);
      }

      const makeCb = next => arg => {
        let errorArg;

        if (arg instanceof Error) {
          errorArg = arg;
        }

        setImmediate(() => commandStream.emit('transition', next, data, errorArg));
      };

      const done = makeCb('complete_on_gateway');
      const failCommand = makeCb('failed');

      processerFn(data, done, failCommand);
    },
    complete_on_gateway: data => {
      commandStream.emit('transition', 'completed', data);
    },
    cancel_on_gateway: data => {
      const { system } = data;

      commandQueuer.removeFromQueue(system, data);

      if (commandHandlers.cancelled) {
        commandHandlers.cancelled(data);
        setImmediate(() => {
          commandStream.emit('transition', 'cancelled', data);
        });
      } else {
        commandStream.emit('transition', 'cancelled', data);
      }
    },
    cancelled: data => {
      majorTom.cancelCommand(data.id);
      triggerCommandFinish(data);
    },
    completed: data => {
      majorTom.completeCommand(data.id, data.output);
      triggerCommandFinish(data);
    },
    failed: (data, ...errors) => {
      majorTom.failCommand(data.id, errors.map(err => err.toString()));
      triggerCommandFinish(data);
    },
  };

  const listeners = state => (...args) => {
    if (!userListeners[state] && !defaultListeners[state]) {
      return defaultListeners.failed(args[0], new Error(`Gateway did not understand state ${state}`));
    }

    return (userListeners[state] && userListeners[state](...args)) || defaultListeners[state](...args);
  };

  const handleOnGateway = (commandType, handler) => {
    if (typeof handler !== 'function') {
      throw new Error(`You must provide a function to handle commands of type ${commandType}`);
    }

    commandHandlers[commandType] = handler;
  };

  const processOnGateway = (commandType, handler) => {
    if (typeof handler !== 'function') {
      throw new Error(`You must provide a function to handle commands of type ${commandType}`);
    }

    typeProcessors[commandType] = handler;
  };

  const attachListener = (state, cb) => {
    if (typeof cb !== 'function') {
      throw new Error('You must attach a function as a listener callback');
    }

    if (gatewayStates.includes(state)) {
      userListeners[state] = cb;
    } else {
      throw new Error(`Cannot attach a listener to state ${state} as it's not one we recognize.`);
    }
  };

  const removeListener = state => {
    if (gatewayStates.includes(state)) {
      delete userListeners[state];
    }
  };

  const translateInboundFor = translateFor('inbound');

  const translateOutboundFor = translateFor('outbound');

  // Set up the transition listener for the command stream
  commandStream.on('transition', (nextState, ...data) => {
    listeners(nextState)(...data);
  });

  // Listen on our inbound stream for message types and command state updates coming from systems
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

  // Send our inbound stream to the implementer, if they have provided it
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
    processOnGateway,
    validateCommand,
  };
};

module.exports = newGatewayManager;
