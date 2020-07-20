const manager = require('./gatewayManager');

const myManager = manager({
  host: 'app.majortom.cloud',
  gatewayToken: '26f57249cbe7ea71d7535bebc206635dba15fd2d104e693f284395a98d0457a1',
});

myManager.addChannel('websocket', { useInsecure: true });
myManager.translateOutboundFor('websocket', command => {
  const { id, type, fields } = command;

  return `ID:${id}/TYPE:${type.toUpperCase()}/${fields.map(({ name, value }) => `${name.toUpperCase()}:${value}/`)}`;
});

['loadDriver', 'happenator', 'hapticProcessor'].forEach(sys => {
  myManager.addSystem(sys, 'websocket');
});

myManager.connectToMajorTom();