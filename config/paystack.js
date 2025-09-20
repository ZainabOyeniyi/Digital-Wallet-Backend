// src/config/paystack.js
const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

if (!PAYSTACK_SECRET_KEY) {
    console.error(' Paystack secret key is required');
    process.exit(1);
}

const paystackClient = axios.create({
    baseURL: PAYSTACK_BASE_URL,
    headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
    },
    timeout: 30000
});

// Request interceptor for logging
paystackClient.interceptors.request.use(
    (config) => {
        console.log(` Paystack API Request: ${config.method.toUpperCase()} ${config.url}`);
        return config;
    },
    (error) => {
        console.error(' Paystack Request Error:', error);
        return Promise.reject(error);
    }
);

// Response interceptor for logging
paystackClient.interceptors.response.use(
    (response) => {
        console.log(`Paystack API Response: ${response.status} ${response.config.url}`);
        return response;
    },
    (error) => {
        console.error(' Paystack Response Error:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);

module.exports = {
    paystackClient,
    PAYSTACK_PUBLIC_KEY,
    PAYSTACK_SECRET_KEY
};