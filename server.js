
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { sql, connectDB } = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

const authRoutes = require('./routers');
const chatRoutes = require('./chat');
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// Kiểm tra backend
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'INTENT Backend is running'
    });
});

// Kiểm tra database và danh sách bảng
app.get('/api/db-test', async (req, res) => {
    try {
        const result = await sql.query`
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        `;

        res.json({
            success: true,
            database: 'INTENT_DB',
            tables: result.recordset
        });
    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            success: false,
            message: 'Cannot query database'
        });
    }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await sql.connect({
            server: process.env.DB_SERVER,
            port: Number(process.env.DB_PORT || 1433),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            options: {
                encrypt: false,
                trustServerCertificate: true
            }
        });

        console.log('Connected to SQL Server');

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('Startup failed:', error.message);
    }
}

startServer();
