// src/utils/generateWalletNumber.js
const pool = require('../config/database');

const generateWalletNumber = async (connection = null) => {
    const db = connection || pool;
    let walletNumber;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
        // Generate 10-digit wallet number starting with 1-9
        const firstDigit = Math.floor(Math.random() * 9) + 1;
        const remainingDigits = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
        walletNumber = firstDigit + remainingDigits;

        // Check if wallet number is unique
        const [existing] = await db.execute(
            'SELECT id FROM wallets WHERE wallet_number = ?',
            [walletNumber]
        );

        if (existing.length === 0) {
            isUnique = true;
        }

        attempts++;
    }

    if (!isUnique) {
        throw new Error('Failed to generate unique wallet number after maximum attempts');
    }

    return walletNumber;
};

module.exports = { generateWalletNumber };

