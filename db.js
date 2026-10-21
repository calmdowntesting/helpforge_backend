
require('dotenv').config();

const sql = require('mssql');

const config = {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: false,
        trustServerCertificate: true
    },
    connectionTimeout: 15000,
    requestTimeout: 15000
};

async function connectDB() {
    try {
        await sql.connect(config);
        console.log('Connected to SQL Server successfully!');

        const result = await sql.query`
            SELECT DB_NAME() AS DatabaseName
        `;

        console.log('Database:', result.recordset[0].DatabaseName);
    } catch (error) {
        console.error('Database connection failed:', error.message);
    }
}

module.exports = { sql, connectDB };
