# `Node Gateway API`

To use the Node Gateway API one must require this package from npm.

```sh
npm install majortom-gateway
```

## `Node Gateway Object`

To create a Major Tom Node Gateway connection:
```js
const { newNodeGateway } = require('majortom-gateway');

const myGatewayConnection = newNodeGateway(options);
```

or if you're more comfortable with class-based instantiation:
```js
const { NodeGateway } = require('majortom-gateway');

const myGatewayConnection = new NodeGateway(...instantiationArgs);
```

### `newNodeGateway(options)`

* `options` `<Object>` Set of configuration options to establish the API connection.
  - `host` `<String>` The host for the connection's Major Tom instance, e.g. `"you.majortom.cloud"`.
  - `gatewayToken` `<String>` The gateway token; find it in the gateway page for this gateway in your Major Tom UI.
  - `[basicAuth]` `<String>` Encrypted basic auth string with username and password, if your instance requires it.
  - `[http]` `<Boolean>` Pass `true` here if the gateway should connect over an insecure http connection.
  - `[commandCallback]` `<Function>` The function to run when a command message is received from Major Tom.
  - `[cancelCallback]` `<Function>` The function to run when a cancel command message is received from Major Tom.
  - `[errorCallback]` `<Function>` The function to run when an error message is received from Major Tom.
  - `[rateLimitCallback]` `<Function>` The function to run when a rate limit message is received from Major Tom.
  - `[transitCallback]` `<Function>` The function to run when a transit message is received from Major Tom
  - `[sslVerify]` `<Object>` Used to establish secure socket layer
  - `[sslCaBundle]` `<Object>` Used to establish secure socket layer
  - `[verbose]` `<Boolean>` If true, will write the messages to `process.stdout`
  - `[customLogger]` `<Function>` A custom logging function

* Returns: `<NodeGatewayConnection>`

### `new NodeGateway(host, gatewayToken, sslVerify, basicAuth, http, sslCaBundle, commandCallback, errorCallback, rateLimitCallback, cancelCallback, transitCallback, verbose, customLogger)`

* Returns: `<NodeGatewayConnection>`

See the descriptions above for each of the arguments. This pattern matches more closely with the Python implementation; however the object parameter pattern used for `newNodeGateway` makes it simpler to pass only the arguments needed when instantiating.

### `NodeGatewayConnection`

#### `connection.connect()`
Establishes or re-establishes the WebSocket connection with Major Tom based on the host and gateway token used in instantiation.

#### `connection.cancelCommand(id)`
* `id` `<Number>` The id of the command to cancel

Informs Major Tom that the command with the passed id has been cancelled. Convenience method for calling `transmitCommandUpdate` with the state `'cancelled'`.

#### `connection.completeCommand(id[,output])`
* `id` `<Number>` The id of the command to complete
* `output` `<String>` The output of the completed command

Informs Major Tom that the command with the passed id has successfully completed. The passed output will be present in the Major Tom UI. Convenience method for calling `transmitCommandUpdate` with the state `'completed'`.

#### `connection.failCommand(id[,errors])`
* `id` `<Number>` The id of the command that failed
* `errors` `<Array>` An array of errors generated during the command failure

Informs Major Tom that the command with the passed id has failed. The passed errors Array will be present in the Major Tom UI. Convenience method for calling `transmitCommandUpdate` with the state `'failed'`.

#### `connection.transmit(message)`
* `message` `<String|Buffer|Object>` The message to send to Major Tom.

If `message` is a String or a Buffer, `transmit` will assume that in its String form it is correctly formed JSON and pass it directly to Major Tom. If it is an Object, it will be `JSON.stringify`ed.

#### `connection.transmitCommandUpdate(id,state[,options])`
* `id` `<Number>` The id of the command to update
* `state` `<String>` The next command state, must be one of `Major Tom Command States`
* `options` `<Object>` Information for Major Tom about the command's state; see Major Tom Gateway Docs for details of this object.

#### `connection.transmitEvents(event)`
* `event` `<Object>` The event details; see Major Tom Gateway Docs for details of this object.

#### `connection.transmitMetrics(metrics)`
* `metrics` `<Array>` The metrics to send to Major Tom; see Major Tom Gateway Docs for details of the objects in this Array.

#### `connection.transmittedCommand(id[,payload])`
* `id` `<Number>` The command to indicate has been transmitted to a system
* `payload` `<String>` Information about the command

Informs Major Tom that the command has been transmitted to the destination system. Convenience method for calling `transmitCommandUpdate` with the state `'transmitted_to_system'`.

#### `connection.updateCommandDefinitions(system, definitions)`
* `system` `<String>` The name or String identifier of the system to update command definitions
* `definitions` `<Array>` An array of defninitions objects; see Major Tom Gateway Docs for details of the objects in this Array.

#### `connection.updateFileList(system,files[,timestamp])`
* `system` `<String>` The name or String identifier of the system to provide a file list for
* `files` `<Array>` An array of file information objects; see Major Tom Gateway Docs for details of the objects in this Array.

#### `connection.downloadStagedFile(gatewayDownloadPath[,resultStream][, keepAlive])`
* `gatewayDownloadPath` `<String>` The url path where Major Tom is storing the file to download to the gateway.
* `resultStream` `<Stream.Writable>` A Node Writable Stream where the file can be written to, e.g. a Stream created with `fs.createWriteStream()`
* `keepAlive <Boolean>` Set to true if the download process should NOT call Stream.end() on the provided resultStream.
* Returns: `<Promise>`

If a `resultStream` is provided, the downloaded file will be written to that Stream, and nothing will be resolved from the Promise. Otherwise, after a successful download the promise will be resolved with the file in the form of a Node `<Buffer>`.

#### `connection.uploadDownlinkedFile(filename,filepath,system[,timestamp[,contentType[,commandId[,metadata]]]])`
* `filename` `<String>` The name that will represent this file in the Major Tom UI.
* `filepath` `<Buffer|String>` If this argument is a String then this method will naively attempt to resolve it using `fs.readFileSync`. If that fails, it will assume it's the desired file to upload, and convert it to a Node `<Buffer>`
* `system` `<String>` The name or String identifier of the system associated with this file
* `timestamp` `<Number>` a UNIX epoch in milliseconds UTC; defaults to when this method was called
* `contentType` `<String>` The file content type; defaults to `'binary/octet-stream'`
* `commandId` `<Number>` Optionally associate this file with a command
* `metadata` `<Object|String>` Optional metadata about this file in Object or String form

#### `connection.pipeFromMajorTom()`

Gives the implementer direct access to the Readable Stream of incoming messages from Major Tom.

#### `connection.pipeToMajorTom()`

Gives the implementer direct access to the Writable Stream to send messages directly to Major Tom.