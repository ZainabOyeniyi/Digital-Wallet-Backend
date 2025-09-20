// src/routes/wallet.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const {
    getWalletBalance,
    initializeFunding,
    transferMoney,
    withdrawMoney,
    getBanks,
    verifyAccountNumber,
    verifyPayment,
    // withdrawSimple
} = require('../controllers/walletController');

const router = express.Router();

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

const validateFunding = [
    body('amount')
        .isFloat({ min: 100, max: 1000000 })
        .withMessage('Amount must be between ₦100 and ₦1,000,000')
];

const validateTransfer = [
    body('recipientWalletNumber')
        .isLength({ min: 10, max: 10 })
        .isNumeric()
        .withMessage('Valid 10-digit wallet number is required'),
    body('amount')
        .isFloat({ min: 10, max: 1000000 })
        .withMessage('Amount must be between ₦10 and ₦1,000,000'),
    body('description')
        .optional()
        .isLength({ max: 255 })
        .withMessage('Description must not exceed 255 characters'),
    body('idempotencyKey')
        .optional()
        .isUUID()
        .withMessage('Idempotency key must be a valid UUID')
];

const validateWithdrawal = [
    body('amount')
        .isFloat({ min: 100, max: 1000000 })
        .withMessage('Amount must be between ₦100 and ₦1,000,000'),
    body('bankCode')
        .notEmpty()
        .withMessage('Bank code is required'),
    body('accountNumber')
        .isLength({ min: 10, max: 10 })
        .isNumeric()
        .withMessage('Valid 10-digit account number is required'),
    body('accountName')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Account name must be 2-100 characters'),
    body('idempotencyKey')
        .optional()
        .isUUID()
        .withMessage('Idempotency key must be a valid UUID')
];

const validateAccountVerification = [
    body('accountNumber')
        .isLength({ min: 10, max: 10 })
        .isNumeric()
        .withMessage('Valid 10-digit account number is required'),
    body('bankCode')
        .notEmpty()
        .withMessage('Bank code is required')
];

router.get('/balance', authenticateToken, getWalletBalance);
router.post('/fund', authenticateToken, validateFunding, handleValidationErrors, initializeFunding);
router.post('/transfer', authenticateToken, validateTransfer, handleValidationErrors, transferMoney);
router.post('/withdraw', authenticateToken, validateWithdrawal, handleValidationErrors, withdrawMoney);
router.get('/banks', authenticateToken, getBanks);
router.post('/verify-account', authenticateToken, validateAccountVerification, handleValidationErrors, verifyAccountNumber);
router.get('/verify-payment/:reference', authenticateToken, verifyPayment);
// Add this to your existing wallet routes
// router.post('/withdraw-simple', authenticateToken, withdrawSimple);

module.exports = router;