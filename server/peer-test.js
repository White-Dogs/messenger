const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const NUM_NODES = 3;
const BASE_PORT = 3000;
const processes = [];

function waitForReady(port, retries = 10) {
    return new Promise(async (resolve) => {
        const url = `http://localhost:${port}/peers`;
        for (let i = 0; i < retries; i++) {
            try {
                await axios.get(url);
                return resolve(true);
            } catch {
                await new Promise(r => setTimeout(r, 500));
            }
        }
        resolve(false);
    });
}

(async () => {
    for (let i = 0; i < NUM_NODES; i++) {
        const port = BASE_PORT + i;
        const peers = [];
        for (let j = 0; j < NUM_NODES; j++) {
            if (j !== i) peers.push(`localhost:${BASE_PORT + j}`);
        }

        const env = {
            ...process.env,
            PORT: port,
            PEERS: peers.join(',')
        };

        const child = spawn('node', [path.join(__dirname, 'index.js')], {
            env,
            stdio: ['ignore', 'inherit', 'inherit']
        });

        processes.push(child);

        console.log(`⏳ Waiting for node ${port} to be ready...`);
        const ready = await waitForReady(port);
        if (ready) {
            console.log(`✅ Node ${port} is ready.`);
        } else {
            console.log(`❌ Node ${port} failed to start.`);
        }
    }

    console.log('🚦 All nodes started and registered.');
})();

process.on('SIGINT', () => {
    console.log('\n🛑 Killing all nodes...');
    processes.forEach(proc => proc.kill());
    process.exit();
});
