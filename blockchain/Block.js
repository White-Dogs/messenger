const crypto = require('crypto');

class Block {
    constructor(index, timestamp, transactions, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.nonce = 0;
        this.hash = this.calculateHash();
    }

    calculateHash() {
        const data = this.index + this.timestamp + JSON.stringify(this.transactions) + this.previousHash + this.nonce;
        return crypto.createHash('sha256').update(data).digest('hex');
    }

    mine(difficulty = 2) {
        while (this.hash.substring(0, difficulty) !== Array(difficulty + 1).join("0")) {
            this.nonce++;
            this.hash = this.calculateHash();
        }
    }
}

module.exports = Block;
