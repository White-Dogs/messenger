const Block = require('./Block');
const fs = require('fs');

class Blockchain {
    constructor() {
        this.chain = [{
            index: 0,
            timestamp: "2025-01-01T00:00:00.000Z",
            transactions: [{ msg: "Genesis Block" }],
            previousHash: "0",
            nonce: 0,
            hash: "0000000000000000000000000000000000000000000000000000000000000000"
        }];
        this.difficulty = 2;
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    addBlock(transactions) {
        const block = new Block(
            this.chain.length,
            new Date().toISOString(),
            transactions,
            this.getLatestBlock().hash
        );
        block.mine(this.difficulty);
        this.chain.push(block);
    }

    isValid() {
        for (let i = 1; i < this.chain.length; i++) {
            const curr = this.chain[i];
            const prev = this.chain[i - 1];
            if (curr.hash !== curr.calculateHash()) return false;
            if (curr.previousHash !== prev.hash) return false;
        }
        return true;
    }

    saveToFile(filePath) {
        fs.writeFileSync(filePath, JSON.stringify(this.chain, null, 2), 'utf8');
    }

    static loadFromFile(filePath) {
        if (!fs.existsSync(filePath)) return new Blockchain();

        const rawData = fs.readFileSync(filePath, 'utf8');
        const rawBlocks = JSON.parse(rawData);

        const chain = new Blockchain();
        chain.chain = rawBlocks.map((b, index) => {
            const block = new Block(
                b.index,
                b.timestamp,
                b.transactions,
                b.previousHash
            );
            block.nonce = b.nonce;
            block.hash = b.hash;
            return block;
        });

        return chain;
    }
}

module.exports = Blockchain;
