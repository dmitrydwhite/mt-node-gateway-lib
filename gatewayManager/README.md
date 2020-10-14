# `Node Gateway Manager`

The Node Gateway Manager is a convenience wrapper around the base Major Tom Node Gateway API that
allows for ease of integrating the WebSocket connection to Major Tom with connections (or
"channels") to systems. The manager uses the Major Tom Command States, as well as some additional
Gateway states, to allow the implementer to track and interact with the progress of commands and
messaging between Major Tom and any attached systems, over various channels.

## `Node Gateway Manager`

To create a Major Tom Node Gateway manager:
```js
const { newGatewayManager } = require('mt-node-gateway-api');

const myGatewayManager = newGatewayManager(options);
```

### `newGatewayManager(options)`
* `options` `<Object>` Set of configuration options to establish the Gateway Manager.
  - `host` `<String>` The host for the connection's Major Tom instance, e.g. `"you.majortom.cloud"`.
  - `gatewayToken` `<String>` The gateway token; find it in the gateway page for this gateway in your Major Tom UI.
  - `[basicAuth]` `<String>` Encrypted basic auth string with username and password, if your instance requires it.
  - `[http]` `<Boolean>` Pass `true` here if the gateway should connect over an insecure http connection.
  - `[receiveStream]` `<Stream.Writable>` The optional Node JS Writable Stream to receive incoming data from systems on

* Returns: `<NodeGatewayManager>`

### `NodeGatewayManager`

#### `manager.addChannel(type[,options])`
* `type` `<String>` One of `"http"`, `"tcp"`, `"udp"`, or `"websocket"` indicating the type of channel to add
* `options` `<Object>` The configuration options for the channel to add; see the channel docs for options available to each channel type

Informs the gateway manager to expect a channel of the specified type.

#### `manager.addSystem(system,channel[,destination])`
* `system` `<String>` The name or String identifier of the system to add
* `channel` `<String>` One of `"http"`, `"tcp"`, `"udp"`, or `"websocket"`; optional if there is only one channel added
* `destination` `<String>` Some channels require specific descriptions for each systems, such as host and ip; see channel docs for details

Informs the gateway manager to expect a system to be added over the specified channel. Some channels
require more specific pathing information to reach the system, e.g. a host and ip combination. See
the channel docs under `registerSystem` for details on the destination string for each channel.

#### `manager.sendCommandDefinitions(commandDefinitions)`
* `commandDefinitions` `<String|Object>` Either a JSON string or an object with a `system` and `definitions` field

Sends command definitions directly to Major Tom for the system indicated in the passed data. See
Major Tom system docs for details on how command definitions should be formatted.

#### `manager.attachListener(state, callback)`
* `state` `<String>` The gateway state to run the provided callback against
* `callback` `<Function>` The callback to run when the passed command state is emitted


#### `manager.removeListener(state)`
* `state` `<String>` The gateway state to remove the callback listener from

#### `manager.connectToMajorTom()`
Connects the Major Tom WebSocket side of the gateway.

#### `manager.translateOutboundFor(...destinations, callback[, overwriteCustom])`
* `...destinations` `<String>` Strings describing which channels or systems should use this translation function. If systems are passed, then this will be considered a "custom" function.
* `callback` `<Function>` The translation function to apply to these channels and systems
  - This callback will receive an object formatted according to Major Tom's rules for commands. It should return the data the system will need to execute the command, formatted according to the system requirements, as either a String or a Node `<Buffer>`.
* `overwriteCustom` `<Boolean>` Pass `true` if the function passed should replace the translation functions that have previously been provided to systems as custom translation functions

#### `manager.translateInboundFor(...destinations, callback[,overwriteCustom])`
* `...destinations` `<String>` Strings describing which channels or systems should use this untranslate function. If systems are passed, then this will be considered a "custom" function.
* `callback` `<Function>` The untranslation function to apply to these channels and systems
  - This callback will receive the data from the system in whatever form the system sends it. This function should call `.toString()` on the received data, as it could be either a String or a Node `<Buffer>`. This function must return an Object in the expected format for Major Tom and the Gateway Manager.

#### `manager.handleOnGateway(commandType, callback)`
* `commandType` `<String>` The Gateway Manager will intercept a command of this type received from Major Tom and run the provided callback.
* `callback` `<Function>` The callback to run when the Gateway Manager receives a command of this type.
* `callback` may take up to two arguments:
  - `command` `<Object>` The command received from Major Tom containing `id`, `type`, `system`, and `fields`.
  - `done` `<Function>` Call this function when the Gateway's interception is complete, and the command can move on to the next phase.
    * Pass `done` a callback function to run when this specific command has finished on the system. The callback will have the same signature as the parent callback. The difference between this callback passed to `done` and adding a listener for the `done_on_system` event is that this callback will be run only once.

#### `manager.validateCommand([commandType,]callback)`
* `commandType` `<String>` Specify that the passed function is only for the designated command type
* `callback` `<Function>` The function that will validate a command received from Major Tom
  - `callback` will receive the `command` object from Major Tom, with `id`, `type`, `system`, and `fields`. You may use this function to ensure that the command object has the correct field types, etc. If this function returns an `<Error>` then the command state will be changed to failed, and the info from the error will be passed to Major Tom.

### Gateway Manager Command Lifecycle

The Gateway Manager handles commands from Major Tom in Four Phases:

#### Phase I: Initial Gateway Phase
This phase begins when Major Tom sends a Command message to the gateway. The first lifecycle event emitted from the gateway is the custom gateway event _`received_from_mt`_. During this event, the Command object from MT is evaluated with any custom validator provided by the implementer. The command may then emit `failed`, if the validator returns an `<Error>`. Otherwise, the next event, `preparing_on_gateway` is emitted.

During the `preparing_on_gateway` event, the Gateway Manager checks to see if this command type has a custom handler, added with the `handleOnGateway` method. Again, if this method returns an `<Error>` then the command will be transitioned to the `failed` state.

When a handler has completed, signified by calling the `done` callback, or if there is no handler, the next event emitted in this phase is _`gateway_prep_complete`_. During this event, the Gateway Manager confirms that the Command's destination system is valid and known by the Manager. If it isn't, the Manager will emit `failed`; otherwise, it will emit the final event of this phase, `uplinking_to_system`.

#### Phase II: The System Phase
During this phase, the Gateway Manager is concerned with checking the state of command updates received from the system. The system can, of course, send any state; but the ones the Gateway Manager expects during this phase are `acked_by_system`, `executing_on_system`, `downlinking_from_system`, and `done_on_system`.

As noted, the system can also send other states like `failed` or `cancelled`.

When a system emits the gateway-specific _`done_on_system`_ event, that will trigger the next phase.

#### Phase III: Final Gateway Phase
This phase allows the gateway to perform any final processing based on any information received from the system. This can be processing indicated by command type and defined by passing a command type and callback to `processOnGateway`, or indicated on a per-command-id basis by passing a callback to the `done` function invoked during command handling in Phase I.

When the processing callback calls its own `done` function, or if there is no processing handler, the next event emitted will be _`complete_on_gateway`_, which will immediately trigger the `completed` event, ending the phase and the command's success lifecycle.

#### Phase IV: Failure and Cancellation Phase
This phase can be triggered at any time by any system updating a command's status to `failed`, or by a handler returning an `<Error>`, either of which will trigger the `failed` event. The Gateway Manager will automatically send the `failed` message on to Major Tom.

This phase can also be triggered by Major Tom sending a `cancel` message to the gateway. When this message is received, the Gateway Manager will emit a `cancel_on_gateway` event. Adding a listener for this event allows the implementer to send any system-specific cancel messages along to any systems that require such a message.