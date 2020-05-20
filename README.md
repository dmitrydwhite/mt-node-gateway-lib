# wip-mt-node-gateway-lib

This app modularizes three gateway functions: communicating with major tom over a WebSocket connection, communicating with major tom over a REST connection, and communicating with Systems over a WebSocket connection, through an API.

`example-app.js` is an example implementation of using the library with a bare bones console output.

### To Run The Example App Locally

```sh
$ git clone <this-repo>
$ cd ./wip-mt-node-gateway-lib
$ npm install
$ node example/temp-server.js
```

This will start the localhost web server running.

### To Interact with `temp-server.js`

* navigate to [`http://localhost:8080/`](http://localhost:8080)

If you get a 200 response that says `App Listening` then the app is running.

However, it hasn't connected to Major Tom yet.

* connect to a Major Tom instance by navigating to a url with this pattern:

[`http://localhost:8080/connect?host=<your full major tom host, including protocol>&token=<your valid gateway token>`](http://localhost:8080/status)

* if your Major Tom instance is protected by Basic Auth, include the query param `&auth=true` in your url.  You'll be prompted to enter Basic Auth username and password in order to attempt a connection.

* After a moment or two, you'll be redirected to the `/status` path.  Here you'll either be shown `Connected` or `Not Connected`.  There will also be a button to retry your connection.  (Right now this works smoothly because when the pathname is updated, the query params are not, so you'll go back to `/connect?<all your query params>`.  When in doubt, manipulate the url directly.)

* If you want to disconnect the gateway from the Major Tom instance, navigate to [`http://localhost:8080/disconnect`](http://localhost:8080/disconnect)

### To Connect Systems

This gateway library is designed to accept connections from Systems over a WebSocket. For that purpose, it runs a WebSocket server to listen for connections.  That server can be configured by an implementer by passing an httpServer instance to the gateway instance constructor.

e.g.
```js
const gateway = require('./index.js');
const my_server = create_a_server_instance_somehow();

const my_gateway = gateway(my_server);

// Now we can do all the things a gateway does:
my_gateway.connect_to_mt(my_host, my_token, my_username, my_password);  // etc.

```

However, some implementation specificity decisions had to be made; therefore, this library currently explicitly expects the Websocket request to the server to be at the path `/<websocket connection key>/<system name>` There may be a better way to validate or expect WS connections, and to implement the server modularity.

In the case of `temp-server.js` and `example-app.js`, they are particularly designed to handle and expect connections from the Major Tom Example Satellite for Web, which is still being worked on.

See documentation on that project for further details.
