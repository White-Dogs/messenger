const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateRSAKeyPair(username) {
    const keysDir = path.join(__dirname, '../keys');
    if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true });

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
    });

    fs.writeFileSync(`${keysDir}/${username}.pub.pem`, publicKey.export({ type: 'pkcs1', format: 'pem' }));
    fs.writeFileSync(`${keysDir}/${username}.priv.pem`, privateKey.export({ type: 'pkcs1', format: 'pem' }));
}

function encryptRSA(publicKey, data) {
    const key = typeof publicKey === 'string' ? crypto.createPublicKey(publicKey) : publicKey;
    return crypto.publicEncrypt(key, Buffer.from(data));
}


function decryptRSA(privateKey, encryptedData) {
    const key = typeof privateKey === 'string' ? crypto.createPrivateKey(privateKey) : privateKey;
    return crypto.privateDecrypt(key, encryptedData);
}

module.exports = {
    generateRSAKeyPair,
    encryptRSA,
    decryptRSA
};