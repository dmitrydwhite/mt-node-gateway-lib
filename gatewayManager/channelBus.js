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

  /**
   * Check if the passed arg is one of the supported channels
   * @param {String} str Check str to see if it's one of the known channels
   */
  const has = str => Object.keys(bus).includes(str);

  /**
   * Get an object with only the active channels
   */
  const active = () => Object.entries(bus)
    .filter((_, val) => !!val)
    .reduce((accum, [key, value]) => ({ ...accum, [key]: value }), {});

  /**
   * Returns the channel of the passed type, if it's been instantiated
   * @param {String} channel The channel type
   */
  const get = channel => {
    const foundActive = active()[channel];

    if (foundActive) {
      return foundActive;
    }

    throw new Error(`Channel ${channel} has not been created`);
  };

  /**
   * Returns an Array of the active channels
   */
  const allActives = () => Object.values(bus)
    .filter(val => val)
    .map(val => val);

  /**
   * Check if a passed channel type has been instantiated on this bus
   * @param {String} channel The channel to check if active
   */
  const isActive = channel => !!active()[channel];

  /**
   * Create a channel of the passed type, and attach it to this bus. There can only be a single
   * channel of each type. A new channel of the same type will overwrite the current instantiation
   * of that channel type.
   * @param {String} channel The type of channel to create
   * @param {Object} opts The channel configuration options
   */
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
