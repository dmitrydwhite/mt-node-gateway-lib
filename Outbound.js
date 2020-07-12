const { Duplex } = require('stream');
const BASE_WAIT_TIME = 133;

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
    this._read();
    callback();
  }

  _read() {
    const right_now = Date.now();
    const diff = right_now - this.lastPush;
    const chunk = this.data.shift();

    if (!chunk) return;

    if (diff > this.waitTime) {
      this.lastPush = right_now;
      this.push(chunk, 'utf8');
    } else {
      setTimeout(() => {
        this.lastPush = Date.now();
        this.push(chunk);
      }, this.waitTime - diff);
    }
  }
}

module.exports = Outbound;
