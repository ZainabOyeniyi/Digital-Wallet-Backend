// const { Pool } = require('pg');
// require('dotenv').config();

// const pool = new Pool({
//     host: process.env.DB_HOST || 'localhost',
//     port: process.env.DB_PORT || 5432,
//     database: process.env.DB_NAME || 'wallet',
//     user: process.env.DB_USER || 'pguser',
//     password: process.env.DB_PASSWORD || 'pgpass123',
//     max: 10,
//     idleTimeoutMillis: 30000,
//     connectionTimeoutMillis: 60000,
// });

// // Test connection
// pool.connect()
//     .then(client => {
//         console.log('✅ Database connected successfully');
//         client.release();
//     })
//     .catch(err => {
//         console.error('❌ Database connection failed:', err.message);
//     });

// module.exports = pool;


const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'wallet',
    user: process.env.DB_USER || 'root',
    password: '',
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