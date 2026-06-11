require('dotenv/config');

const express = require('express');
const helmet = require('helmet');
const AppError = require('./utils/AppError');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter } = require('./middleware/rateLimits');
const catalogController = require('./controllers/catalogController');
const datasetsRouter = require('./routes/datasets');
const resourcesRouter = require('./routes/resources');
const organizationsRouter = require('./routes/organizations');
const statsRouter = require('./routes/stats');
const jobsRouter = require('./routes/jobs');

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

app.get('/healthz', catalogController.healthz);

app.use('/api', generalLimiter);
app.use('/api/v1/datasets', datasetsRouter);
app.use('/api/v1/resources', resourcesRouter);
app.use('/api/v1/organizations', organizationsRouter);
app.use('/api/v1/stats', statsRouter);
app.use('/api/v1/jobs', jobsRouter);

app.use((req, res, next) => {
    next(new AppError('Not found', 404));
});

app.use(errorHandler);

module.exports = app;
