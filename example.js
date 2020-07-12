const { PassThrough } = require('stream');
const manager = require('./gatewayManager');

const receiveStream = new PassThrough();

const myManager = manager({
  host: 'app.majortom.cloud',
  gatewayToken: 'cea421445199172bbaae5e9ef0b8aff51e9781b7f105d89af0da70c938055ab0',
  // receiveStream,
});

// receiveStream.on('data', data => {
//   const received = JSON.parse(data.toString());
//   console.dir(received);
// });

myManager.addChannel('websocket', { useInsecure: true });
myManager.translateOutboundFor('websocket', JSON.stringify);

myManager.addSystem('patioCamera');

myManager.connectToMajorTom();