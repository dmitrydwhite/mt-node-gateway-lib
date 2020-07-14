const { newSystemUDP } = require('../systemUdp');
const { newSystemWS } = require('../systemWs');

const channelCreators = {
  // http: newSystemHTTP,
  // tcp: newSystemTCP,
  udp: newSystemUDP,
  websocket: newSystemWS,
};

const createChannelBus = () => {
  const bus = {
    http: undefined,
    tcp: undefined,
    udp: undefined,
    websocket: undefined,
  };

  const has = str => Object.keys(bus).includes(str);

  const active = () => Object.entries(bus)
    .filter((_, val) => !!val)
    .reduce((accum, [key, value]) => ({ ...accum, [key]: value }), {});

  const get = channel => {
    const foundActive = active()[channel];

    if (foundActive) {
      return foundActive;
    }

    throw new Error(`Channel ${channel} has not been created`);
  };

  const allActives = () => Object.values(bus)
    .filter(val => val)
    .map(val => val);

  const isActive = channel => !!active()[channel];

  const create = (channel, opts) => {
    if (has(channel)) {
      bus[channel] = channelCreators[channel](opts);
    } else {
      throw new Error(
        `Cannot create channel of type ${type}; must be one of ${Object.keys(bus)}`
      )
    }
  };

  return {
    allActives,
    active,
    isActive,
    get,
    has,
    create,
  };
};

module.exports = createChannelBus;
