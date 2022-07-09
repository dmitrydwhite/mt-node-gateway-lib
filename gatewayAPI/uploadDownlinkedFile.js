const fs = require('fs');
const crypto = require('crypto');
const request = require('request');
const { Buffer } = require('buffer');
const { Readable } = require('stream');

const MAJOR_TOM_DOWNLINK_API = '/gateway_api/v1.0/downlinked_files';
const RAILS_ACTIVE_STORAGE_PATH = '/rails/active_storage/direct_uploads';

const getFileFromAmbiguousArg = ambiguousArg => {
  try {
    const foundFile = fs.readFileSync(ambiguousArg);
    const File = foundFile instanceof Buffer ? foundFile : Buffer.from(foundFile);

    return File;
  } catch (ignore) {
    return Buffer.from(ambiguousArg);
  }
};

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

const calculateChecksum = File => new Promise(resolve => {
  const checksumCalculator = new Readable();
  const hashing = crypto.createHash('md5');

  // This is a little dance to hash the file as a stream:
  checksumCalculator._read = function() { return false; };
  checksumCalculator.push(File);
  checksumCalculator.push(null);

  checksumCalculator.on('data', fileChunk => {
    hashing.update(fileChunk, 'utf8');
  });

  checksumCalculator.on('end', () => {
    resolve(hashing.digest('base64'));
  });
});

const makeFirstRequest = ({
  byteSize,
  checksum,
  contentType,
  fileName,
  gatewayToken,
  restHost,
  authHeader,
}) => new Promise((resolve, reject) => {
  request({
    uri: new URL(RAILS_ACTIVE_STORAGE_PATH, restHost).href,
    method: 'post',
    headers: { 'X-Gateway-Token': gatewayToken, 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      byte_size: byteSize,
      checksum,
      content_type: contentType,
      filename: fileName,
    }),
  }, (error, response, body) => {
    const { statusCode, statusMessage } = response || {};

    if (error || statusCode >= 400) {
      return reject(error || new Error(`POST Response status ${statusCode} ${statusMessage}`));
    }

    if (body) {
      try {
        return resolve(JSON.parse(body));
      } catch (parseError) {
        return reject(parseError);
      }
    }

    reject(new Error('Response received but no body was present'));
  });
});

const makeSecondRequest = ({
  checksum,
  contentType,
  uri,
  authHeader,
  File,
}) => new Promise((resolve, reject) => {
  request({
    uri,
    method: 'put',
    body: File,
    headers: { 'Content-Type': contentType, 'Content-MD5': checksum }
  }, (error, response) => {
    const { statusCode, statusMessage } = response || {};

    if (error || statusCode >= 400) {
      return reject(error || new Error(`PUT Response status ${statusCode} ${statusMessage}`));
    }

    return resolve();
  })
});

const makeThirdRequest = ({
  commandId,
  fileName,
  gatewayToken,
  metadata,
  restHost,
  authHeader,
  signed_id,
  system,
  timestamp,
}) => new Promise((resolve, reject) => {
  request({
    uri: new URL(MAJOR_TOM_DOWNLINK_API, restHost).href,
    method: 'post',
    headers: { 'Content-Type': 'application/json', 'X-Gateway-Token': gatewayToken, ...authHeader },
    body: JSON.stringify({
      command_id: commandId || null,
      metadata: metadata || null,
      name: fileName,
      signed_id,
      system,
      timestamp,
    }),
  }, (error, response, body) => {
    const { statusCode, statusMessage } = response || {};

    if (error || statusCode >= 400) {
      return reject(error || new Error(`POST Response status ${statusCode} ${statusMessage}`));
    }

    try {
      return resolve(JSON.parse(body));
    } catch (parseError) {
      reject(parseError);
    }
  })
});

const uploadDownlinkedFile = async ({
  fileName,
  filePath,
  system,
  timestamp,
  contentType = 'binary/octet-stream',
  commandId,
  metadata,
  restHost,
  gatewayToken,
  basicAuth,
}) => {
  const File = getFileFromAmbiguousArg(filePath);
  const byteSize = File.length;
  const authHeader = getBasicAuthHeaderObj(basicAuth);

  const checksum = await calculateChecksum(File);
  const firstResponse = await makeFirstRequest({
    byteSize,
    checksum,
    fileName,
    gatewayToken,
    restHost,
    authHeader,
  });
  const { direct_upload = {}, signed_id } = firstResponse;
  const { url } = direct_upload;

  await makeSecondRequest({ checksum, contentType, uri: url, authHeader, File });

  return await makeThirdRequest({
    commandId,
    fileName,
    gatewayToken,
    metadata,
    restHost,
    authHeader,
    signed_id,
    system,
    timestamp: timestamp || Date.now(),
  });
};

module.exports = uploadDownlinkedFile;
