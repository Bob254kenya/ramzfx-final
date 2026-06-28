require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { initializeDatabase } = require('./db');

const app = express();
const PORT = process.env.PORT || 8000;
const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(
    cors(
        corsOrigins.length > 0
            ? {
                  origin(origin, callback) {
                      if (!origin || corsOrigins.includes(origin)) {
                          callback(null, true);
                          return;
                      }
                      callback(new Error(`Origin ${origin} is not allowed by CORS`));
                  },
              }
            : undefined
    )
);
app.use(express.json());

// Initialize database flag
let isDbInitialized = false;

// Middleware to ensure DB is initialized (especially for Vercel serverless)
app.use(async (req, res, next) => {
    if (!isDbInitialized && process.env.DATABASE_URL) {
        try {
            await initializeDatabase();
            isDbInitialized = true;
        } catch (error) {
            console.error('Lazy DB Init Error:', error);
        }
    }
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'API server is running',
        env: process.env.VERCEL ? 'vercel' : 'local',
        db: isDbInitialized ? 'connected' : 'disconnected'
    });
});

// Routes
app.use('/api/bot-ideas', require('./routes/bot-ideas'));
app.use('/api/best-bot-stats', require('./routes/best-bot-stats'));
app.use('/api/scanner', require('./routes/scanner'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/exchange-rates', require('./routes/exchange-rates'));

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// Initialize database and start server
async function start() {
    try {
        if (!isDbInitialized && process.env.DATABASE_URL) {
            await initializeDatabase();
            isDbInitialized = true;
        }

        // Only start the listener if not running as a Vercel function
        if (!process.env.VERCEL) {
            app.listen(PORT, '0.0.0.0', () => {
                console.log(`API server running on http://0.0.0.0:${PORT}`);
            });
        }
    } catch (error) {
        console.error('Failed to start server:', error);
        if (!process.env.VERCEL) {
            process.exit(1);
        }
    }
}

start();

module.exports = app;