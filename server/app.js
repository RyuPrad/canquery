require('dotenv/config');

const express = require('express');
const helmet = require('helmet');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.set('trust proxy', 1);
app.use(helmet());

// Build CORS allowlist
const allowlist = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map(o => o.trim())
        .filter(o => o)
);
if (process.env.NODE_ENV !== 'production') {
    allowlist.add('http://localhost:5173');
    allowlist.add('http://127.0.0.1:5173');
}

// CORS middleware
app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return next();
    }

    if (allowlist.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        return next();
    }

    return res.status(403).json({ error: 'Origin not allowed' });
});

app.use(express.json());

app.get('/healthz', (req, res) => {
    res.json({ ok: true });
});

app.use((req, res, next) => {
    next(new AppError('Not found', 404));
});

app.use(errorHandler);

module.exports = app;
