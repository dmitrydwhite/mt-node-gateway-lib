const { Transform } = require('stream');

class Inbound extends Transform {
  constructor(opts) {
    super({
      ...(opts || {}),
      autoDestroy: false,
      end: false,
      objectMode: true,
    });
  }

  _transform(chunk, _, callback) {
    const { data } = chunk;
    let message;

    try {
      message = JSON.parse(data);
    } catch (parseError) {
      return callback(parseError);
    }

    callback(null, message);
  }
}

module.exports = Inbound;
