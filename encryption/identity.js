const crypto = require('crypto');

function getPublicKeyHash(publicKeyPem) {
    return crypto.createHash('sha256').update(publicKeyPem).digest('hex');
}

module.exports = { getPublicKeyHash };
