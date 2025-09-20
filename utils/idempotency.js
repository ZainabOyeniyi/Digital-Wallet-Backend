// src/utils/idempotency.js
const crypto = require('crypto');

const generateIdempotencyKey = () => {
    return crypto.randomUUID();
};

const validateIdempotencyKey = (key) => {
    if (!key || typeof key !== 'string') {
        return false;
    }

    // Check if it's a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(key);
};

module.exports = {
    generateIdempotencyKey,
    validateIdempotencyKey
};