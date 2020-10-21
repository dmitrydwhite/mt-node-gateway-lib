// In this example, we connect to Major Tom before we start sending data,
// then we send data at a nice even rate, then we intermittently send bursts
// of data as well.
const { newNodeGateway } = require('./index');

const myGateway = newNodeGateway({
  host: 'app.majortom.cloud', // Put your host here
  gatewayToken: '', // Put your gateway token here
  verbose: true, // This way we'll see the output in the console window
});

// A base object for our a_counter subsystem that we'll add our values to:
const metricObj = { system: 'TEST_A', subsystem: 'a_counter', metric: 'a_count' };

// A base object for our r_counter subsystem that we'll add our values to:
const rMetricObj = { system: 'TEST_A', subsystem: 'r_counter', metric: 'r_count' };
let count = 0;

// We connect first:
myGateway.connect();

// Then we send 200 metrics at a 2 per second pace:
const countdown = setInterval(() => {
  myGateway.transmitMetrics([{ ...metricObj, value: count, timestamp: Date.now() }]);
  count++;
}, 500);

setInterval(() => {
  for (let i = 0; i < 95; i++) {
    myGateway.transmitMetrics([{ ...rMetricObj, value: i, timestamp: Date.now() }]);
  }
}, 2300);
