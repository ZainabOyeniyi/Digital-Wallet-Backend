// server.js
require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 3000;


// Start background job processor
require('./services/jobProcessor').start();

app.listen(PORT, () => {
    console.log(` Digital Wallet Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});