const http = require('http');
const https = require('https');
const { Transform } = require('stream');
const express = require('express');
const WebSocket = require('ws');

const createTransformOpts = (func, system) => ({
  system,
  objectMode: true,
  transform: function(data, _, cb) {
    const transformed = func(data, this.system);

    if (transformed instanceof Error) {
      cb(transformed);
    } else {
      cb(null, transformed);
    }
  }
});

class ConfigurableTransform extends Transform {
  constructor(options, system) {
    const opts = typeof options === 'function' ?
      createTransformOpts(options, system)
      : { ...(options || {}), system };
    super(opts);
  }
}

/**
 *
 * @param {Object} opts The configuration options
 * @param {Boolean} [useInsecure] Set to true if the WebSocket server should be over ws instead of wss
 * @param {Number} port The port where the WebSocket server should run
 */
const newSystemWS = opts => {
  // Consume all the configuration options
  const conf = opts || {};
  const secure = !conf.useInsecure;
  const port = conf.port || 8532;
  const host = conf.host || undefined;
  const receiveStream = conf.receiveStream;
  let messageCb = typeof conf.onmessage === 'function' && conf.onmessage;
  let serverErrorCb = typeof conf.oncxerror === 'function' && conf.oncxerror;
  let wrapFn = typeof conf.wrap === 'function' ? conf.wrap : x => x;
  let unwrapFn = typeof conf.unwrap === 'function' ? conf.unwrap : x => x;

  const getDestinationStringFromRequest = request => {
    const { url, headers } = request;
    const [systemName, hashTime] = url.split('/').filter(x => x);
    const hashCheck = Buffer.from(`${systemName}${hashTime}`).toString('base64').replace(/=|\//g, '');
    const protocolHeader = Object.keys(headers)
      .find(key => key.toLowerCase() === 'sec-websocket-protocol');

    if (headers[protocolHeader].indexOf(hashCheck) === -1) {
      return new Error(`Received a connection request that could not be validated from ${url}`);
    }

    return systemName;
  };

  let validateIncoming = typeof conf.validateRequest === 'function'
    ? conf.validateRequest
    : getDestinationStringFromRequest;

  // Set the address books
  const addresses = {};
  const systems = {};

  // Set the internal stateful variables
  let receiveStreamOpen = !!receiveStream;
  let httpServer;
  let server;

  const setServer = () => {
    const expApp = express();

    httpServer = (secure ? https : http).createServer(expApp);
    server = new WebSocket.Server({ clientTracking: false, noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      const destinationString = validateIncoming(req);

      if (destinationString instanceof Error) {
        // Destroy the socket
        socket.destroy();
        // TODO: this may not be the best way to inform anyone that we've got an unexpected connection attempt.
        console.log('We received a connection request over WebSocket that could not be verified');
        throw destinationString;
      }

      server.handleUpgrade(req, socket, head, ws => {
        server.emit('connection', ws, destinationString);
      })
    });

    httpServer.on('error', err => {
      closeChannel();
      if (serverErrorCb) {
        serverErrorCb(err);
      }

      throw err;
    });

    server.on('connection', (cx, dest) => {
      if (!addresses[dest]) {
        registerSystem(dest);
      }

      const destinationStream = addresses[dest];

      cx.on('message', message => {
        destinationStream.inbound.write(message);
      });

      cx.on('error', err => {
        destinationStream.isConnected = false;

        if (serverErrorCb) {
          serverErrorCb(err);
        }
      });

      destinationStream.isConnected = true;
      destinationStream.connection = cx;

      if (destinationStream.outbound.isPaused()) {
        destinationStream.outbound.resume();
      }
    });

    server.on('error', err => {
      closeChannel();
      if (serverErrorCb) {
        serverErrorCb(err);
      }
    });

    httpServer.listen(port, host || '127.0.0.1', () => {
      console.log(`WebSocket Channel Open at ${host || '127.0.0.1'}:${port}`);
    });
  };

  const registerSystem = (systemName, destination, customWrapper, customUnwrapper) => {
    const destinationString = systemName || destination;

    if (typeof destinationString !== 'string') {
      throw new Error('System name must be a string');
    }

    if (addresses[destinationString]) {
      throw new Error(
        `The system at ${destinationString} has already been registered; unregister it and try again`
      );
    }

    const addressObj = {
      outbound: new ConfigurableTransform(customWrapper || wrapFn, systemName),
      inbound: new ConfigurableTransform(customUnwrapper || unwrapFn, systemName),
      customOut: !!customWrapper,
      customIn: !!customUnwrapper,
      isConnected: false,
    };

    addressObj.outbound.system = systemName;
    addressObj.inbound.system = systemName;

    addressObj.outbound.on('data', data => {
      if (addressObj.connection && addressObj.isConnected) {
        addressObj.connection.send(data);
      } else {
        addressObj.outbound.pause();
        addressObj.outbound.unshift(data);
      }
    });

    if (receiveStream) {
      addressObj.inbound.pipe(receiveStream);
    }

    addresses[destinationString] = addressObj;
  };

  /**
   * Send a message to a system.
   * @param {*} data Data to send to a system
   * @param {String} [system] The name of the system to send the data to. Optional if only one system.
   * @returns {void|Error}
   */
  const send = (data, system) => {
    const destinations = Object.keys(addresses);

    if (destinations.length === 0) {
      throw new Error('You must register a system in order to send');
    }

    if (!system && destinations.length === 1) {
      addresses[destinations[0]].outbound.write(data);
      return;
    }

    if (!system) {
      throw new Error(
        'You must provide the system name in order to send; or use sendAll if you want to send to all systems'
      );
    }

    const destinationSystem = addresses[system];

    if (destinationSystem) {
      destinationSystem.outbound.write(data);
    } else {
      throw new Error('You are attempting to send data to a system that has not been registered');
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

  const getAddressDetails = () => Object.keys(addresses)
    .reduce((accum, curr) => ({ ...accum, [curr]: curr }), {});

  const getRegisteredSystems = () => Object.keys(addresses);

  const unregisterSystem = systemName => delete addresses[systemName];

  const wrap = (newWrapFn, overWriteCustom) => {
    if (typeof newWrapFn !== 'function') {
      throw new Error('You must provide a function to method wrap');
    }

    wrapFn = newWrapFn;

    const systemsToWrap = overWriteCustom
      ? Object.keys(addresses)
      : Object.keys(addresses).filter(addr => !addresses[addr].customOut);

    systemsToWrap.forEach(systemName => {
      // Store a copy of the existing connection
      const cxRef = addresses[systemName].connection;
      // Store the value of the connected flag
      const wasCx = addresses[systemName].isConnected;

      unregisterSystem(systemName);
      registerSystem(systemName);

      // Attach the connection
      addresses[systemName].connection = cxRef;
      addresses[systemName].isConnected = wasCx;
    });
  };

  const unwrap = (newUnwrapFn, overWriteCustom) => {
    if (typeof newUnwrapFn !== 'function') {
      throw new Error('You must provide a function to method wrap');
    }

    unwrapFn = newUnwrapFn;

    const systemsToWrap = overWriteCustom
      ? Object.keys(addresses)
      : Object.keys(addresses).filter(addr => !addresses[addr].customOut);

    systemsToWrap.forEach(systemName => {
      // Store a copy of the existing connection
      const cxRef = addresses[systemName].connection;
      // Store the value of the connected flag
      const wasCx = addresses[systemName].isConnected;

      unregisterSystem(systemName);
      registerSystem(systemName);

      const [prevMsgListener] = cxRef.listeners('message');

      cxRef.removeEventListener('message', prevMsgListener);

      cxRef.on('message', message => {
        addresses[systemName].inbound.write(message);
      });

      // Attach the connection
      addresses[systemName].connection = cxRef;
      addresses[systemName].isConnected = wasCx;
    });
  };

  const closeChannel = () => {
    Object.values(addresses).forEach((_, cxObj) => {
      cxObj.isConnected = false;
      if (cxObj.connection) cxObj.connection.close();
    });

    process.nextTick(() => {
      server = null;
    });
  };

  /**
   * Set a handler for messages received from registered systems.
   * @param {Function} cb Handler for a message from a system
   * @returns {void|Error}
   */
  const onmessage = cb => {
    if (typeof cb !== 'function') {
      throw new Error('Provide a function to the onmessage handler');
    }

    messageCb = cb;

    if (receiveStreamOpen) {
      throw new Error(
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
      throw new Error('Provide a function to the connection error handler');
    }

    serverErrorCb = cb;
  };

  setServer();

  if (receiveStream) {
    receiveStream.on('close', () => {
      receiveStreamOpen = false;

      if (messageCb) {
        Object.keys(addresses).forEach(dest => {
          addresses[dest].inbound.unpipe();
          addresses[dest].inbound.on('data', data => {
            messageCb(data, dest);
          });
        });
      }
    });
  }

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
* Create a System WebSocket Channel using class syntax
*/
class SystemWS {
  constructor(opts) {
    return newSystemWS(opts);
  }
}

module.exports = { newSystemWS, SystemWS };
