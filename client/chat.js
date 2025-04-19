// chat.js - Secure CLI Chat with Mongo Peer Discovery and Local Node Sending
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateKeyPairSync } = require('crypto');
const readline = require('readline');
const axios = require('axios');
const { decryptRSA, encryptRSA } = require('../encryption/rsa');
const { decryptAES, encryptAES, generateAESKey, generateIV } = require('../encryption/aes');
const { getPublicKeyHash } = require('../encryption/identity');

const LOCAL_NODE = process.env.NODE || 'localhost:3000';
const CHAIN_URL = `http://${LOCAL_NODE}/chain`;
const SEND_URL = `http://${LOCAL_NODE}/send`;
const PEER_LIST_URL = `http://${LOCAL_NODE}/peers`;
const AUTO_REFRESH_INTERVAL = 1000;

let rl;

function setupReadline() {
    rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true
    });
}

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

const MONGO_API = process.env.MONGO_API || 'http://3.123.20.100:4000';

async function getPeerListFromMongo() {
    try {
        const res = await axios.get(`${MONGO_API}/nodes`);
        return res.data.map(n => n.url.replace(/^https?:\/\//, ''));
    } catch (err) {
        console.log('❌ Failed to fetch peers from Mongo:', err.message);
        return [];
    }
}

async function getFastestPeerFromMongo() {
    const peers = await getPeerListFromMongo();
    let fastest = null;
    let shortest = Infinity;

    for (const peer of peers) {
        const start = Date.now();
        try {
            await axios.get(`http://${peer}/peers`, { timeout: 1000 });
            const duration = Date.now() - start;
            if (duration < shortest) {
                shortest = duration;
                fastest = peer;
            }
        } catch { }
    }

    return fastest;
}

async function registerUser(username) {
    const password = await ask('🔐 Set a password for your private key: ');
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: 'aes-256-cbc',
            passphrase: password
        }
    });
    const keysDir = path.join(__dirname, '../keys');
    const metaDir = path.join(__dirname, '../metadata');
    if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir);
    if (!fs.existsSync(metaDir)) fs.mkdirSync(metaDir);
    fs.writeFileSync(`${keysDir}/${username}.priv.pem`, privateKey);
    fs.writeFileSync(`${keysDir}/${username}.pub.pem`, publicKey);
    const pubHash = getPublicKeyHash(publicKey);
    fs.writeFileSync(`${keysDir}/${pubHash}.pub.pem`, publicKey);
    const meta = {
        name: username,
        publicHash: pubHash,
        createdAt: new Date().toISOString()
    };
    fs.writeFileSync(`${metaDir}/${username}.json`, JSON.stringify(meta, null, 2));
    console.log(`✅ Registered ${username}`);
    console.log(`🔑 Public hash: ${pubHash}`);
}

function signMessage(messageBody, privateKeyObj) {
    const signer = crypto.createSign('SHA256');
    signer.update(JSON.stringify(messageBody));
    signer.end();
    return signer.sign(privateKeyObj).toString('base64');
}

async function fetchAndCachePublicKey(senderHash) {
    for (const peer of await getPeerListFromMongo()) {
        try {
            const url = `http://${peer}/pubkey/${senderHash}`;
            const response = await axios.get(url);
            const pubKey = response.data?.pubKey;
            if (pubKey) {
                fs.writeFileSync(`./keys/${senderHash}.pub.pem`, pubKey);
                return pubKey;
            }
        } catch { }
    }
    return null;
}

function verifySignature(tx, publicKeyPem) {
    const verifier = crypto.createVerify('SHA256');
    const unsignedTx = {
        senderHash: tx.senderHash,
        recipientHash: tx.recipientHash,
        timestamp: tx.timestamp,
        encryptedMessage: tx.encryptedMessage,
        encryptedKey: tx.encryptedKey,
        iv: tx.iv
    };
    verifier.update(JSON.stringify(unsignedTx));
    verifier.end();
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return verifier.verify(publicKey, Buffer.from(tx.signature, 'base64'));
}

let messageCache = new Set();
let lastSeenIndex = 0;

async function refreshInbox(myId, myPrivKey) {
    try {
        const res = await axios.get(CHAIN_URL);
        const chain = res.data;
        for (let i = lastSeenIndex + 1; i < chain.length; i++) {
            const block = chain[i];
            for (const tx of block.transactions) {
                const txId = `${block.index}:${tx.senderHash}:${tx.timestamp}`;
                if (tx.recipientHash === myId && !messageCache.has(txId)) {
                    try {
                        const aesKey = decryptRSA(myPrivKey, Buffer.from(tx.encryptedKey, 'base64'));
                        const decrypted = decryptAES(tx.encryptedMessage, aesKey, Buffer.from(tx.iv, 'base64'));
                        tx.decrypted = decrypted;
                        let verified = false;
                        let senderKeyFile = null;
                        try {
                            senderKeyFile = fs.readFileSync(`./keys/${tx.senderHash}.pub.pem`, 'utf8');
                        } catch {
                            senderKeyFile = await fetchAndCachePublicKey(tx.senderHash);
                        }
                        if (senderKeyFile) {
                            verified = verifySignature(tx, senderKeyFile);
                        }
                        console.log(`\n💬 [Block ${block.index}] From ${tx.senderHash.slice(0, 10)}...`);
                        console.log(`   → ${decrypted}`);
                        console.log(`   🔏 Signature: ${verified ? '✅ VERIFIED' : '❌ UNKNOWN'}\n`);
                        messageCache.add(txId);
                    } catch (err) {
                        console.log(`❌ Failed to decrypt message`);
                    }
                }
            }
            lastSeenIndex = block.index;
        }
    } catch (err) {
        console.log('❌ Inbox refresh failed:', err.message);
    }
}

async function sendMessage(myId, myPrivKey, recipientId, recipientPubKey) {
    const message = await ask('💬 Message to send: ');
    const aesKey = generateAESKey();
    const iv = generateIV();
    const encryptedMessage = encryptAES(message, aesKey, iv);
    const encryptedAESKey = encryptRSA(recipientPubKey, aesKey);
    const tx = {
        senderHash: myId,
        recipientHash: recipientId,
        timestamp: new Date().toISOString(),
        encryptedMessage,
        encryptedKey: encryptedAESKey.toString('base64'),
        iv: iv.toString('base64')
    };
    tx.signature = signMessage(tx, myPrivKey);
    try {
        const sendRes = await axios.post(SEND_URL, tx);
        console.log(`✅ Message sent in block #${sendRes.data.blockIndex}`);
    } catch (err) {
        console.log(`❌ Message failed:`, err.response?.data || err.message);
    }
}

async function commandLoop(myId, myPrivKey, recipientId, recipientPubKey) {
    console.log(`\n📨 Commands: /send /refresh /exit`);
    setInterval(() => refreshInbox(myId, myPrivKey), AUTO_REFRESH_INTERVAL);
    rl.prompt();
    rl.on('line', async (line) => {
        const input = line.trim();
        switch (input) {
            case '/send':
                await sendMessage(myId, myPrivKey, recipientId, recipientPubKey);
                break;
            case '/refresh':
                await refreshInbox(myId, myPrivKey);
                break;
            case '/exit':
                console.log('👋 Bye');
                rl.close();
                process.exit(0);
                break;
            default:
                console.log('⚠️ Unknown command');
        }
        rl.prompt();
    });
    rl.prompt();
}

async function main() {
    setupReadline();
    const args = process.argv.slice(2);
    if (args[0] === '/register' && args[1]) {
        await registerUser(args[1]);
        process.exit(0);
    }
    const myName = args[0] || await ask('Your name: ');
    const recipientName = args[1] || await ask('Recipient name: ');
    const keyDir = path.join(__dirname, '../keys');
    const privKeyPem = fs.readFileSync(`${keyDir}/${myName}.priv.pem`, 'utf8');
    const pubKeyPem = fs.readFileSync(`${keyDir}/${myName}.pub.pem`, 'utf8');
    const privKeyPassword = await ask(`🔐 Password for ${myName}: `);
    const myPrivKey = crypto.createPrivateKey({
        key: privKeyPem,
        format: 'pem',
        type: 'pkcs8',
        passphrase: privKeyPassword
    });
    let recipientPubKey;
    const localPath = path.join(keyDir, `${recipientName}.pub.pem`);
    if (fs.existsSync(localPath)) {
        recipientPubKey = fs.readFileSync(localPath, 'utf8');
    } else {
        const keyPath = path.join(keyDir, `${recipientName}.pub.pem`);
        if (fs.existsSync(keyPath)) {
            recipientPubKey = fs.readFileSync(keyPath, 'utf8');
        } else {
            recipientPubKey = await fetchAndCachePublicKey(recipientName);
            if (!recipientPubKey) {
                console.error('❌ Public key for recipient not found locally or remotely.');
                process.exit(1);
            }
        }
    }
    const myId = getPublicKeyHash(pubKeyPem);
    const recipientId = getPublicKeyHash(recipientPubKey);
    console.log(`🔓 You: ${myName} (${myId.slice(0, 12)}...)`);
    console.log(`📬 Chatting with: ${recipientName} (${recipientId.slice(0, 12)}...)`);
    await refreshInbox(myId, myPrivKey);
    await commandLoop(myId, myPrivKey, recipientId, recipientPubKey);
}

main();