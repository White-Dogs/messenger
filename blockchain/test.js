const Blockchain = require('./Blockchain');
const fs = require('fs');

const transaction = JSON.parse(fs.readFileSync('./latest-tx.json', 'utf8'));
const chainFile = './chain.json';

const chatChain = Blockchain.loadFromFile(chainFile);
chatChain.addBlock([transaction]);
chatChain.saveToFile(chainFile);

console.log("Added new block. Is chain valid?", chatChain.isValid());
