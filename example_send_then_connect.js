// In this example we'll fill the outbound buffer of the Gateway interface
// before connecting to Major Tom
const { newNodeGateway } = require('./index');

const myGateway = newNodeGateway({
  host: 'app.majortom.cloud', // Put your host here
  gatewayToken: '', // Put your gateway token here
  verbose: true, // This way we'll see the output in the console window
});

// A base object that we'll add our values to:
const metricObj = { system: 'TEST_B', subsystem: 'b_counter', metric: 'b_count' };

// Here we call transmitMetrics 200 times before we are connected
for (let count = 200; count > 0; count -= 1) {
  myGateway.transmitMetrics([{ ...metricObj, value: count }]);
}

// Pause for effect...
console.log('Waiting 3 seconds to connect to Major Tom...');
setTimeout(() => {
  // When we connect, we'll have 200 messages immediately waiting for MT;
  // the interface will send them out slowly enough to not trigger a
  // rate_limit warning (~7 per second)
  myGateway.connect();
}, 2800);
