const isString = str => {
  if (typeof str === 'string') {
    return str;
  }

  throw new Error(`String required but received ${typeof str} ${str}`);
};

const isFn = fn => {
  if (typeof fn === 'function') {
    return fn;
  }

  throw new Error(`Function required but received ${typeof fn} ${fn}`);
};

const createCommandQueue = parallel => {
  const systemQueues = {};
  const commandHandlers = {};

  const isQ = systemName => Object.keys(systemQueues).includes(systemName);

  const addSystem = systemName => {
    const newQueue = [];

    newQueue.ready = true;

    systemQueues[isString(systemName)] = newQueue;
  };

  const addHandlerById = (id, handler) => {
    commandHandlers[id] = isFn(handler) && ((...args) => {
      handler(...args);
      setImmediate(() => { delete commandHandlers[id]; });
    });
  };

  const getSystemQueue = systemName => systemQueues[isString(systemName)];

  const getHandlerById = id => commandHandlers[id];

  const getNextForSystem = systemName => {
    const q = systemQueues[isString(systemName)];

    q.ready = false;

    return q.shift();
  };

  const finishItemOnQueue = systemName => {
    if (isQ(systemName)) {
      systemQueues[systemName].ready = systemQueues[systemName].length === 0;
    }
  };

  const systemReady = systemName => parallel || getSystemQueue(systemName).ready;

  const removeFromQueue = (systemName, command) => {
    const { id } = command;

    if (Object.keys(systemQueues).includes(systemName)) {
      systemQueues[systemName] = systemQueues[systemName].filter(queued => queued.id !== id);

      systemQues[systemName].ready = systemQueues[systemName].length === 0;
    }
  };

  const queueForSystem = (systemName, command) => {
    if (Object.keys(systemQueues).includes(systemName)) {
      systemQueues[systemName].push(command);
    } else {
      throw new Error(
        `Could not queue command for system ${systemName} because its queue hasn't been created yet`
      );
    }
  };

  return {
    addSystem,
    addHandlerById,
    getSystemQueue,
    getHandlerById,
    getNextForSystem,
    finishItemOnQueue,
    systemReady,
    removeFromQueue,
    queueForSystem,
  };
};

module.exports = createCommandQueue;
