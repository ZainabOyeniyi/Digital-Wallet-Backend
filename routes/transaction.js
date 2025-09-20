// src/routes/transaction.js
const express = require('express');
const { query, param, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const {
    getTransactionHistory,
    getTransactionDetails
} = require('../controllers/transactionController');

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

const validateTransactionHistory = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
    query('type')
        .optional()
        .isIn(['CREDIT', 'DEBIT'])
        .withMessage('Type must be either CREDIT or DEBIT'),
    query('category')
        .optional()
        .isIn(['FUNDING', 'TRANSFER', 'WITHDRAWAL'])
        .withMessage('Category must be FUNDING, TRANSFER, or WITHDRAWAL'),
    query('status')
        .optional()
        .isIn(['PENDING', 'SUCCESS', 'FAILED'])
        .withMessage('Status must be PENDING, SUCCESS, or FAILED')
];

const validateTransactionDetails = [
    param('reference')
        .notEmpty()
        .withMessage('Transaction reference is required')
];

router.get('/history', authenticateToken, validateTransactionHistory, handleValidationErrors, getTransactionHistory);
router.get('/:reference', authenticateToken, validateTransactionDetails, handleValidationErrors, getTransactionDetails);

module.exports = router;