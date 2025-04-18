const crypto = require('crypto');

function generateAESKey() {
    return crypto.randomBytes(32); // 256 bits
}

function generateIV() {
    return crypto.randomBytes(16); // 128-bit IV
}

function encryptAES(plainText, key, iv) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
}

function decryptAES(cipherText, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(cipherText, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

module.exports = {
    generateAESKey,
    generateIV,
    encryptAES,
    decryptAES
};
