const { Transform } = require('stream');

const createTransformOpts = (func, system) => ({
  system,
  objectMode: true,
  transform: function(data, _, cb) {
    const transformed = func(data, this.system);

    if (transformed instanceof Error) {
      cb(transformed);
    } else {
      cb(null, transformed);
    }
  }
});

class ConfigurableTransform extends Transform {
  /**
   * A convenience wrapper for easily creating a transform stream that calls the provided function on every streamed chunk.
   * @param {Object|Function} options An object with config options for the transform, or a function to set as the transform method
   * @param {String} system The system identifier; it will be passed as the second arg to the transformation function passed
   */
  constructor(options, system) {
    const opts = typeof options === 'function' ?
      createTransformOpts(options, system)
      : { ...(options || {}), system };
    super(opts);
  }
}

module.exports = ConfigurableTransform;
