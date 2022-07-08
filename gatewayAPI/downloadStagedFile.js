const http = require('http');
const https = require('https');
const { Buffer } = require('buffer');
const { Writable } = require('stream');

/**
 * @param {string} basicAuthStr
 */
const getBasicAuthHeaderObj = basicAuthStr => {
  if (!basicAuthStr) {
    return {};
  }

  const stringToEncode = basicAuthStr.slice(-1) === '@' ? basicAuthStr.slice(0, -1) : basicAuthStr;

  return { Authorization: `Basic ${Buffer.from(stringToEncode).toString('base64')}` };
};

const downloadStagedFile = ({
  gatewayDownloadPath,
  gatewayToken,
  resultStream,
  restHost,
  useSecure,
  basicAuth,
}) => new Promise((resolve, reject) => {
  const nodeReq = useSecure ? https : http;
  const downloadUrl = new URL(gatewayDownloadPath, restHost).href;
  const writeStreamProvided = resultStream instanceof Writable;
  const chunks = [];

  const get = destination => {
    nodeReq.get(destination, { headers: { 'X-Gateway-Token': gatewayToken, ...basicAuth } }, response => {
      const { statusCode, statusMessage } = response;

      if (statusCode >= 400) {
        return reject(new Error(`GET Response status ${statusCode} ${statusMessage}`));
      }

      if (response.headers.location && response.headers.location !== destination) {
        // We need to follow Major Tom's redirects
        return get(response.headers.location);
      }

      response.on('data', chunk => {
        if (writeStreamProvided) {
          resultStream.write(chunk);
        } else {
          chunks.push(chunk);
        }
      });

      response.on('end', () => {
        if (writeStreamProvided) {
          resultStream.end();
          return resolve();
        } else {
          return resolve(Buffer.concat(chunks));
        }
      });

      response.on('error', readError => {
        return reject(readError);
      });
    }).on('error', httpError => reject(httpError));
  };

  get(downloadUrl);
});

module.exports = downloadStagedFile;
