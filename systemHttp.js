const newSystemHttp = () => {
  const conf = opts || {};
  const secure = !conf.useInsecure;
  const port = conf.port || 7788;
  const receiveStream = conf.receiveStream;
  let messageCb = typeof conf.onmessage === 'function' && conf.onmessage;
  let serverErrorCb = typeof conf.oncxerror === 'function' && conf.oncxerror;
  let wrapFn = typeof conf.wrap === 'function' ? conf.wrap : x => x;
  let unwrapFn = typeof conf.unwrap === 'function' ? conf.unwrap : x => x;

  const getDestinationStringFromRequest = () => {
    // TODO: Implement this somehow, maybe using headers?
  }

  let validateIncoming = typeof conf.validateRequest === 'function'
    ? conf.validateRequest
    : getDestinationStringFromRequest;

  // Set the address books
  const addresses = {};
  const systems = {};

  // Set the internal stateful variables
  let receiveStreamOpen = !!receiveStream;
  let server;

  const setServer = () => {
    const expApp = express();

    expApp.listen(port);
  };

  const send = (data, system) => {

  };

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

module.exports = newSystemHttp;
