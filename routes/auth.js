// src/routes/auth.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const { register, login, getProfile, verifyOtp, generateOtp } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');

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

const validateRegistration = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email is required'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters'),
    body('firstName')
        .trim()
        .isLength({ min: 2 })
        .withMessage('First name must be at least 2 characters'),
    body('lastName')
        .trim()
        .isLength({ min: 2 })
        .withMessage('Last name must be at least 2 characters'),
    body('phone')
        .optional()
        .matches(/^(\+234|0)[0-9]{10}$/)
        .withMessage('Invalid Nigerian phone number')
];

const validateLogin = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email is required'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

router.post('/register', validateRegistration, handleValidationErrors, register);
router.post('/login', validateLogin, handleValidationErrors, login);
router.get('/profile', authenticateToken, getProfile);
router.post('/verify-otp', handleValidationErrors, verifyOtp);
router.post('/send-otp', generateOtp);

module.exports = router;


