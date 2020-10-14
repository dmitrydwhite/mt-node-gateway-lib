# Major Tom Gateway API Package

NPM Package for interacting with Major Tom's Gateway API.

## The gateway object

The Gateway API functions are accessible once a new gateway object has been instantiated. This is
the simplest way to communicate with Major Tom.

```js
import MTGateway from 'major-tom-gateway';

const myHost = 'you.majortom.cloud';
const myToken = 'your-gateway-token'; // Find this in the Major Tom UI on your gateway's page

const myGatewayObject = MTGateway(myHost, myToken);
```

Check out the Docs to see its use. Also check out the quick start below.

The `connect` function must be called in order to start receiving messages from Major Tom.

The `major-tom-gateway` Package is currently in Beta, so please submit an issue or come talk to us
if you have any comments/questions/feedback.

## The gateway manager

The gateway manager is a convenience wrapper around the gateway object that also allows for connecting systems over various channels.

## Quick Start

You can start a simple Major Tom gateway right in your node REPL! First off, start an interactive
node REPL session in a terminal window:
```sh
$ node
```
Now you're in a node environment. First off, let's require this package, as well as set variables
related to our Major Tom instance, and our gateway.

```js
const { newGatewayManager } = require('major-tom-gateway');

// We'll name these variables the same as the property names for the gateway manager configuration
// object, so we can use object property shorthand.
const host = '<your app host>'; // Usually something like you.majortom.cloud
const gatewayToken = '<your gateway token>'; // This is found in the Major Tom gateway UI

// Now we'll create our Gateway Object. We'll name it with a short name so we can minimize typing:
const g = newGatewayManager({ host, gatewayToken });

// Remember we still aren't connected yet, until we explicitly call `connectToMajorTom`:
g.connectToMajorTom();
```
Now if everything went swimmingly, we're connected to Major Tom. You should see a greeting message from Major Tom in the node REPL. So we have one side of the gateway ready; now we need to set up the other side as well. This ability to modify your connection with Major Tom in real time is what makes the gateway manager a helpful tool.

Next let's add a system. For this demo, we'll inform the gateway manager that we're going to be connecting to our system over WebSocket:
```js
g.addChannel('websocket');
```
For this demo, it's as simple as that. Check out the Channels docs to see how each channel can be configured.

Next we'll inform the manager to expect a system named `"PageSystem"` to be connecting to the gateway over WebSocket. We _do_ need to inform the gateway manager _before_ the system tries to connect, so that the gateway can validate the system when it tries to connect. (The WebSocket channel provides a default means of validating the connection; see the Channel docs for details on the default validation, and for instructions on creating your custom validation.)

```js
g.addSystem('PageSystem', 'websocket');
```

