const dgram = require('dgram');
const process = require('process');
const ConfigurableTransform = require('./ConfigurableTransform');

const udpVersions = { udp4: true, udp6: true };

const parseDestination = str => {
  const asNumber = Number(str);

  if (Number.isInteger(asNumber)) {
    return ['127.0.0.1', asNumber];
  }

  const hasProtocol = str.indexOf('://') >= 4;
  const { hostname, port } = new URL(`${hasProtocol ? '' : 'https://'}${str}`);

  return [hostname, port];
};

const newSystemUDP = opts => {
  // Consume all the configuration options
  const conf = opts || {};
  const udpVersion = udpVersions[conf.udpVersion] ? conf.udpVersion : 'udp4';
  const port = conf.port || 41114;
  const host = conf.host || undefined;
  const receiveStream = conf.receiveStream;
  let messageCb = typeof conf.onmessage === 'function' && conf.onmessage;
  let serverErrorCb = typeof conf.oncxerror === 'function' && conf.oncxerror;
  let wrapFn = typeof conf.wrap === 'function' ? conf.wrap : x => x;
  let unwrapFn = typeof conf.unwrap === 'function' ? conf.unwrap : x => x;

  // Set the address books
  const addresses = {};
  const systems = {};

  // Set the internal stateful variables
  let receiveStreamOpen = !!receiveStream;
  let serverReady = false;
  let server;

  /**
   * Instantiates the UDP server, sets the listening, error, and message handlers. Binds the server
   * to the provided port and ip address.
   */
  const setServer = () => {
    server = dgram.createSocket(udpVersion);

    server.on('listening', () => {
      serverReady = true;

      Object.keys(addresses).forEach(addr => {
        const currentQ = addresses[addr].outbound;

        if (currentQ.isPaused()) {
          currentQ.resume();
        }
      });
    });

    server.on('error', err => {
      serverReady = false;
      server.close();

      if (serverErrorCb) serverErrorCb(err);

      process.nextTick(() => {
        server = null;
        setServer();
      });
    });

    server.on('message', (message, rinfo) => {
      console.log('incoming message');
      console.log(addresses);
      const { address, port } = rinfo;
      console.log(rinfo);
      const destinationStream = addresses[`${address || ''}:${port}`].inbound;

      if (destinationStream) {
        console.log('found dat destination stream');
        destinationStream.write(message);
      }
    });

    server.bind(port, host || '127.0.0.1');
  };

  /**
   * Register a system that this UDP connection can communicate with.
   * @param {String} systemName The local name of the system to register
   * @param {String|Number} destination Port only, as a number or string; or ip and port in the format 'IP.IP.IP.IP:PORT'
   * @param {Function} [customWrapper] If this system should have a specific wrapping function for messages sent to it
   * @param {Function} [customUnwrapper] If this system should have a specific unwrapping function for messages received from it
   * @returns {void|Error}
   */
  const registerSystem = (systemName, destination, customWrapper, customUnwrapper) => {
    const [ip, port] = parseDestination(destination);
    const destinationStr = `${ip}:${port}`;

    if (!port) {
      return new Error(
        'You must provide at least a destination port in order to register a system'
      );
    }

    if (addresses[destinationStr]) {
      return new Error(
        `The system at ${destination} has already been registered; unregister it and try again`
      );
    }

    systems[systemName] = destinationStr;

    const addressObj = {
      outbound: new ConfigurableTransform(customWrapper || wrapFn, systemName),
      inbound: new ConfigurableTransform(customUnwrapper || unwrapFn, systemName),
      customOut: !!customWrapper,
      customIn: !!customUnwrapper,
    };

    addressObj.outbound.on('data', data => {
      if (server && serverReady) {
        server.send(data, port, ip);
      } else {
        addressObj.outbound.pause();
        addressObj.outbound.unshift();
      }
    });

    if (receiveStreamOpen) {
      addressObj.inbound.pipe(receiveStream);
    } else if (messageCb) {
      addressObj.inbound.on('data', data => {
        messageCb(data, systemName);
      });
    }

    addresses[destinationStr] = addressObj;
  };

  /**
   * Removes a system from the list of systems available to this UDP connection
   * @param {String} systemName Name of system to un-register
   */
  const unregisterSystem = systemName => {
    const addrStr = systems[systemName];

    delete systems[systemName];
    delete addresses[addrStr];
  };

  const getRegisteredSystems = () => Object.keys(systems);

  const getAddressDetails = () => systems;

  /**
   * Send a message to a system.
   * @param {*} data Data to send to a system
   * @param {String} [system] The name of the system to send the data to. Optional if only one system.
   * @returns {void|Error}
   */
  const send = (data, system) => {
    const destinations = Object.keys(addresses);

    if (destinations.length === 0) {
      return new Error('You must register a system in order to send');
    }

    if (!system && destinations.length === 1) {
      addresses[destinations[0]].outbound.write(data);
      return;
    }

    if (!system) {
      return new Error(
        'You must provide the system name in order to send; or use sendAll if you want to send to all systems'
      );
    }

    const destinationSystem = addresses[systems[system]];

    if (destinationSystem) {
      destinationSystem.outbound.write(data);
    } else {
      return new Error('You are attempting to send data to a system that has not been registered');
    }
  };

  /**
   * Sends the passed data to all registered systems
   * @param {*} data Message to send to all registered systems
   */
  const sendAll = data => {
    Object.keys(addresses).forEach(registered => {
      registered.outbound.write(data);
    });
  };

  /**
   * Allows a user to update how messages from the gateway to the systems are converted into what
   * the systems can understand.
   * @param {Function} newWrapFn The new function to convert Major Tom JSON to what our UDP systems can understand
   * @param {Boolean} [overwriteCustom] True if even systems with a custom wrapping function should have theirs replaced with this new one
   */
  const wrap = (newWrapFn, overwriteCustom) => {
    if (typeof wrapFn !== 'function') {
      return new Error('You must provide a function to method wrap');
    }

    wrapFn = newWrapFn;

    const systemsToWrap = overwriteCustom
      ? Object.keys(systems)
      : Object.keys(systems).filter(sysName => !addresses[systems[sysName]].customOut);

    systemsToWrap.forEach(sysName => {
      const destinationStr = systems[sysName];

      unregisterSystem(sysName);
      registerSystem(sysName, destinationStr);
    });
  };

  /**
   * Allows a user to update how messages from the systems are converted into Major Tom JSON
   * @param {Function} newUnwrapFn The new function to convert messages from systems to Major Tom JSON
   * @param {Boolean} overwriteCustom True if even systems with custom unwrapping functions should have theirs replaced with this new one
   * @returns {void|Error}
   */
  const unwrap = (newUnwrapFn, overwriteCustom) => {
    if (typeof wrapFn !== 'function') {
      return new Error('You must provide a function to method unwrap');
    }

    unwrapFn = newUnwrapFn;

    const systemsToUnwrap = overwriteCustom
      ? Object.keys(systems)
      : Object.keys(systems).filter(sysName => !addresses[systems[sysName]].customIn);

    systemsToUnwrap.forEach(sysName => {
      const destinationStr = systems[sysName];

      unregisterSystem(sysName);
      registerSystem(sysName, destinationStr);
    });
  };

  /**
   * Set a handler for messages received from registered systems.
   * @param {Function} cb Handler for a message from a system
   * @returns {void|Error}
   */
  const onmessage = cb => {
    if (typeof cb !== 'function') {
      return new Error('Provide a function to the onmessage handler');
    }

    messageCb = cb;

    if (receiveStreamOpen) {
      return new Error(
        'A message handler was provided while a receive stream was open; to use the handler function, close the receive stream'
      )
    } else {
      Object.keys(addresses).forEach(a => {
        addresses[a].inbound.on('data', data => {
          messageCb(data, Object.keys(systems).find(sysName => systems[sysName] === a));
        });
      });
    }
  };

  const oncxerror = cb => {
    if (typeof cb !== 'function') {
      return new Error('Provide a function to the connection error handler');
    }

    serverErrorCb = cb;
  };

  /**
   * Close the server associated with this channel.
   * @param {Function} cb Callback to run after server closes
   */
  const closeChannel = cb => {
    const callback = typeof cb === 'function' ? cb : undefined;

    serverReady = false;
    server.close(callback);

    process.nextTick(() => {
      server = null;
    });
  };

  if (receiveStream) {
    receiveStream.on('close', () => {
      receiveStreamOpen = false;

      if (messageCb) {
        Object.keys(addresses).forEach(a => {
          addresses[a].inbound.unpipe();
          addresses[a].inbound.on('data', data => {
            messageCb(data, Object.keys(systems).find(sysName => systems[sysName] === a));
          });
        });
      }
    });
  }

  setServer();

  return {
    send,
    sendAll,
    onmessage,
    oncxerror,
    registerSystem,
    unregisterSystem,
    getRegisteredSystems,
    getAddressDetails,
    wrap,
    unwrap,
    closeChannel,
  };
};

/**
 * Create a System UDP Channel using class syntax
 */
class SystemUDP {
  constructor(opts) {
    return newSystemUDP(opts);
  }
}

module.exports = { newSystemUDP, SystemUDP };
