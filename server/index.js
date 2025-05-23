// index.js - Secure Blockchain Node with Mongo Sync and UPnP
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const os = require('os');
const Blockchain = require('../blockchain/Blockchain');

const app = express();
const PORT = process.env.PORT || 3000;
const CHAIN_FILE = `./chain-${PORT}.json`;
const MONGO_API = process.env.MONGO_API || 'http://3.123.20.100:4000';

let publicUrl = null;

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return process.env.PUBLIC_HOST || iface.address;
            }
        }
    }
    return '127.0.0.1';
}

async function setupUPnPAndRegister() {
    console.log('⚠️ UPnP port mapping failed. Falling back to local IP.');
    publicUrl = `http://${getLocalIp()}:${PORT}`;
    await startRegistration();
    // try {
    //     const upnp = require('nat-upnp');
    //     const client = upnp.

    //         client.portMapping({
    //             public: PORT,
    //             private: PORT,
    //             ttl: 3600,
    //             description: 'Blockchain Node UPnP'
    //         }, async (err) => {
    //             if (!err) {
    //                 try {
    //                     client.getExternalIPAddress(async (err, ip) => {
    //                         if (!err && ip) {
    //                             publicUrl = `http://${ip}:${PORT}`;
    //                             console.log(`🌍 UPnP Public URL: ${publicUrl}`);
    //                         } else {
    //                             console.log('⚠️ Failed to retrieve external IP from UPnP. Falling back.');
    //                             publicUrl = `http://${getLocalIp()}:${PORT}`;
    //                         }
    //                         await startRegistration();
    //                     });
    //                 } catch (error) {
    //                     console.log('⚠️ Failed to retrieve external IP from UPnP. Falling back.');
    //                     publicUrl = `http://${getLocalIp()}:${PORT}`;
    //                     await startRegistration();

    //                 }

    //             } else {
    //                 console.log('⚠️ UPnP port mapping failed. Falling back to local IP.');
    //                 publicUrl = `http://${getLocalIp()}:${PORT}`;
    //                 await startRegistration();
    //             }
    //         });
    // } catch (e) {
    //     console.log('⚠️ UPnP module not available. Falling back to local IP.');
    //     publicUrl = `http://${getLocalIp()}:${PORT}`;
    //     await startRegistration();
    // }
}

async function startRegistration() {
    console.log(`🌐 Node public URL: ${publicUrl}`);
    await sendHeartbeat();
    setInterval(sendHeartbeat, 30_000);
}

async function sendHeartbeat() {
    try {
        await axios.post(`${MONGO_API}/heartbeat`, {
            url: publicUrl,
            port: PORT
        });
        console.log(`📡 Sent heartbeat: ${publicUrl}`);
    } catch (err) {
        console.log('❌ Failed to send heartbeat:', err.message);
    }
}

let chain = Blockchain.loadFromFile(CHAIN_FILE);
app.use(bodyParser.json());

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

app.post('/send', async (req, res) => {
    const tx = req.body;
    if (!tx.senderHash || !tx.recipientHash || !tx.encryptedMessage || !tx.encryptedKey || !tx.iv) {
        return res.status(400).json({ error: "Invalid transaction format" });
    }

    const duplicate = chain.chain.some(block =>
        block.transactions.some(t => t.timestamp === tx.timestamp && t.senderHash === tx.senderHash)
    );
    if (duplicate) {
        return res.status(409).json({ error: "Duplicate transaction" });
    }

    const keyPath = path.join(__dirname, `../keys/${tx.senderHash}.pub.pem`);
    if (!fs.existsSync(keyPath)) {
        return res.status(403).json({ error: 'Public key for sender not found' });
    }

    const pubKey = fs.readFileSync(keyPath, 'utf8');
    if (!verifySignature(tx, pubKey)) {
        return res.status(403).json({ error: 'Invalid signature' });
    }

    chain.addBlock([tx]);
    chain.saveToFile(CHAIN_FILE);
    console.log(`🔐 New message block added (from ${tx.senderHash.slice(0, 10)}...)`);

    return res.json({ success: true, blockIndex: chain.chain.length - 1 });
});

app.get('/chain', (req, res) => {
    res.json(chain.chain);
});

app.get('/sync', async (req, res) => {
    let replaced = false;
    try {
        const response = await axios.get(`${MONGO_API}/nodes`);
        const peers = response.data.map(n => n.url.replace(/^http?:\/\//, '').replace(/\/$/, ''));
        for (const peer of peers) {
            try {
                const syncUrl = `http://${peer}/chain`;
                const res = await axios.get(syncUrl);
                const theirChain = res.data;
                if (theirChain.length > chain.chain.length) {
                    const tempChain = Blockchain.loadFromFile(CHAIN_FILE);
                    tempChain.chain = theirChain;
                    if (tempChain.isValid()) {
                        chain.chain = theirChain;
                        replaced = true;
                    }
                }
            } catch (err) {
                console.log(`❌ Failed to sync with ${peer}`);
            }
        }
    } catch (err) {
        console.log('❌ Could not fetch nodes from Mongo API:', err.message);
    }

    if (replaced) {
        chain.saveToFile(CHAIN_FILE);
        return res.json({ success: true, replaced: true });
    } else {
        return res.json({ success: true, replaced: false });
    }
});

app.get('/peers', async (req, res) => {
    try {
        const response = await axios.get(`${MONGO_API}/nodes`);
        res.json(response.data.map(n => n.url));
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch peers from Mongo API' });
    }
});

app.post('/register', (req, res) => {
    res.status(501).json({ error: 'This node uses MongoDB for peer discovery.' });
});

app.get('/pubkey/:id', (req, res) => {
    const keyFile = path.join(__dirname, `../keys/${req.params.id}.pub.pem`);
    if (fs.existsSync(keyFile)) {
        const pubKey = fs.readFileSync(keyFile, 'utf8');
        res.json({ pubKey });
    } else {
        res.status(404).json({ error: 'Key not found' });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Node running at http://localhost:${PORT}`);
    await setupUPnPAndRegister();
    try {
        await axios.get(`http://localhost:${PORT}/sync`);
        console.log('🔄 Initial sync complete');
    } catch {
        console.log('⚠️ Initial sync failed');
    }
});

// ⏱ Auto sync every 10 seconds
setInterval(async () => {
    try {
        await axios.get(`http://localhost:${PORT}/sync`);
        console.log('🔄 Auto-sync done');
    } catch {
        console.log(`❌ Auto-sync failed`);
    }
}, 10_000);
