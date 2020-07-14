const { PassThrough } = require('stream');
const manager = require('./gatewayManager');

const receiveStream = new PassThrough();

const myManager = manager({
  host: 'app.majortom.cloud',
  gatewayToken: '26f57249cbe7ea71d7535bebc206635dba15fd2d104e693f284395a98d0457a1',
});

myManager.addChannel('websocket', { useInsecure: true });
myManager.translateOutboundFor('websocket', JSON.stringify);
// myManager.translateInboundFor('websocket', (json, system) => {
//   const asObj = typeof json === 'string' ? JSON.parse(json) : json;
//   const { command } = asObj;
//   let commandObj;

//   if (command) {
//     commandObj = { system, ...command };

//     return JSON.stringify({ ...asObj, command: commandObj });
//   }

//   return JSON.stringify(asObj);
// });

myManager.addSystem('DirectionalLaser', 'websocket');

myManager.validateCommand(command => {
  const { type, fields } = command;

  switch (type) {
    case 'engage_laser':
      const [field] = fields;

      if (field.value > 1) {
        return new Error('Setting for Engage Power must be 0 or 1');
      }
    default:
      return true;
  }
});

myManager.connectToMajorTom();