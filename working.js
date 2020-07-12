const { SystemUDP } = require('./systemChannels');

const mine = new SystemUDP({ receiveStream: process.stdout });
