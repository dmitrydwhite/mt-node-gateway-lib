const WebSocket = require('ws');
const reconnectingWebsocket = require('./reconnecting-ws');

const WS_GATEWAY_API_PATH = '/gateway_api/v1.0';

const connectToMt = ({ basicAuth, gatewayToken, host, useSecure }) => {
  const protocol = useSecure ? 'wss://' : 'ws://';
  const auth = basicAuth ? basicAuth : '';
  const gatewayTokenParam = `?gateway_token=${gatewayToken}`;

  const WS = reconnectingWebsocket(
    `${protocol}${auth}${host}${WS_GATEWAY_API_PATH}${gatewayTokenParam}`,
    null, null, WebSocket
  );

  return WS;
}

module.exports = connectToMt;
