const { Duplex } = require('stream');
const BASE_WAIT_TIME = 136;

class Outbound extends Duplex {
  constructor(opts) {
    super(opts);
    this.lastPush = Date.now();
    this.data = [];
    this.waitTime = BASE_WAIT_TIME;
  }

  setWaitTime(newWaitTime) {
    if (newWaitTime && Number.isFinite(newWaitTime)) {
      this.waitTime = newWaitTime;
    }
  }

  _write(chunk, encoding, callback) {
    this.data.push(chunk);
    callback();
  }

  _read() {
    const right_now = Date.now();
    const diff = right_now - this.lastPush;

    if (diff < this.waitTime) {
      setTimeout(() => {
        this.lastPush = Date.now();
        this.push(this.data.shift());
      }, this.waitTime - diff);
    } else {
      this.lastPush = right_now;
      this.push(this.data.shift());
    }
  }
}

module.exports = Outbound;
