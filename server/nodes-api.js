// nodes-api.js - Mongo API za registraciju i listanje nodova
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:wuEl1nrEaF4smaCc@cluster0.x51njve.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

app.use(cors());
app.use(bodyParser.json());

// Mongo schema
const nodeSchema = new mongoose.Schema({
    url: { type: String, required: true, unique: true },
    port: { type: Number },
    lastSeen: { type: Date, default: Date.now }
});

nodeSchema.index({ lastSeen: 1 });
const Node = mongoose.model('Node', nodeSchema);

// POST /heartbeat - register/update node
app.post('/heartbeat', async (req, res) => {
    const { url, port } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    try {
        const node = await Node.findOneAndUpdate(
            { url },
            { url, port, lastSeen: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true, node });
    } catch (err) {
        res.status(500).json({ error: 'DB error', details: err.message });
    }
});

// GET /nodes - return active nodes (seen in last 1 minute)
app.get('/nodes', async (req, res) => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    try {
        const nodes = await Node.find({ lastSeen: { $gte: oneMinuteAgo } });
        res.json(nodes);
    } catch (err) {
        res.status(500).json({ error: 'DB error', details: err.message });
    }
});

// Connect to MongoDB and start server
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => {
        console.log(`✅ Connected to MongoDB at ${MONGO_URI}`);
        app.listen(PORT, () => {
            console.log(`🚀 Mongo Node API running at http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
    });
