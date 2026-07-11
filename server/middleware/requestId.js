const { randomUUID } = require('crypto');

function requestId(req, res, next) {
    // Generate this ourselves rather than trusting a caller-supplied header,
    // which avoids log spoofing while still giving operators and users the
    // same correlation token.
    req.id = randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
}

module.exports = requestId;
