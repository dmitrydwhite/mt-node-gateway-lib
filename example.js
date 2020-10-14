const manager = require('./gatewayManager');

const myManager = manager({
  host: 'app.majortom.cloud',
  gatewayToken: '26f57249cbe7ea71d7535bebc206635dba15fd2d104e693f284395a98d0457a1',
});

myManager.addChannel('udp');
myManager.addSystem('udpBurster', 'udp', 41014);
myManager.translateOutboundFor('udp', JSON.stringify);
myManager.translateInboundFor('udp', buf => {
  console.log('got udp message');
  const asStr = buf.toString();
  const asObj = JSON.parse(asStr);
  console.log(asObj);

  return asObj;
});

myManager.connectToMajorTom();