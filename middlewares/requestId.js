const { randomUUID } = require("crypto");

function requestId(req, res, next) {
  req.id = req.get("X-Request-ID") || randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
}

module.exports = requestId;
