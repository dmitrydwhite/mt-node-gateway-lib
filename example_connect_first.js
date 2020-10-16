// In this example, we connect to Major Tom before we start sending data
// over the Gateway WebSocket
const { newNodeGateway } = require('./index');

const myGateway = newNodeGateway({
  host: 'app.majortom.cloud', // Put your host here
  gatewayToken: '', // Put your gateway token here
  verbose: true, // This way we'll see the output in the console window
});

// A base object that we'll add our values to:
const metricObj = { system: 'TEST_A', subsystem: 'a_counter', metric: 'a_count' };
let count = 200;

// We connect first:
myGateway.connect();

// Then we send 200 metrics at a 2 per second pace:
const countdown = setInterval(() => {
  if (count <= 0) {
    clearInterval(countdown);
  }

  myGateway.transmitMetrics([{ ...metricObj, value: count }]);
  count--;
}, 500);
