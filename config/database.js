// src/database.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'wallet',
    user: process.env.DB_USER || 'root',
    password: '',// process.env.DB_PASSWORD || 'password',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    charset: 'utf8mb4'
});

// Test database connection
pool.getConnection()
    .then(connection => {
        console.log(' Database connected successfully');
        connection.release();
    })
    .catch(err => {
        console.error(' Database connection failed:', err.message);
    });

module.exports = pool;