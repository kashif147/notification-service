/**
 * pino / pino-http redaction for request logging: credential-bearing headers are never written.
 * The default request / response serializers include every header, so these must be censored.
 */
const REQUEST_LOG_REDACT = Object.freeze({
  paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
  censor: "[REDACTED]",
});

module.exports = { REQUEST_LOG_REDACT };
