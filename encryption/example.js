const fs = require('fs');
const path = require('path');
const { generateRSAKeyPair, encryptRSA, decryptRSA } = require('./rsa');
const { generateAESKey, generateIV, encryptAES, decryptAES } = require('./aes');
const { getPublicKeyHash } = require('./identity');

// Ensure keys directory exists
const keysPath = path.join(__dirname, '../keys');
if (!fs.existsSync(keysPath)) fs.mkdirSync(keysPath);

// Generate RSA keys
if (!fs.existsSync(`${keysPath}/Alice.priv.pem`)) generateRSAKeyPair('Alice');
if (!fs.existsSync(`${keysPath}/Bob.priv.pem`)) generateRSAKeyPair('Bob');

// Load keys
const alicePub = fs.readFileSync(`${keysPath}/Alice.pub.pem`, 'utf8');
const alicePriv = fs.readFileSync(`${keysPath}/Alice.priv.pem`, 'utf8');
const bobPub = fs.readFileSync(`${keysPath}/Bob.pub.pem`, 'utf8');
const bobPriv = fs.readFileSync(`${keysPath}/Bob.priv.pem`, 'utf8');

// Generate hashes (IDs)
const senderHash = getPublicKeyHash(alicePub);
const recipientHash = getPublicKeyHash(bobPub);

// Encrypt message
const message = "Secret message from Alice to Bob";
const aesKey = generateAESKey();
const iv = generateIV();
const encryptedMessage = encryptAES(message, aesKey, iv);
const encryptedAESKey = encryptRSA(bobPub, aesKey);

// Package transaction
const transaction = {
    senderHash,
    recipientHash,
    timestamp: new Date().toISOString(),
    encryptedKey: encryptedAESKey.toString('base64'),
    encryptedMessage,
    iv: iv.toString('base64')
};

// Save or print
console.log("TRANSACTION:");
console.log(JSON.stringify(transaction, null, 2));

// Optional test decryption
const decryptedKey = decryptRSA(bobPriv, Buffer.from(transaction.encryptedKey, 'base64'));
const decryptedMessage = decryptAES(transaction.encryptedMessage, decryptedKey, Buffer.from(transaction.iv, 'base64'));

console.log("DECRYPTED:", decryptedMessage);
fs.writeFileSync('latest-tx.json', JSON.stringify(transaction, null, 2));
