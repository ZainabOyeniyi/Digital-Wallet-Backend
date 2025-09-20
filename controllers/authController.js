const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { generateWalletNumber } = require('../utils/generateWalletNumber');
const nodemailer = require('nodemailer');

// Setup Nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// Generate OTP and send via email
const generateOtp = async (req, res) => {
    console.log('Full request body:', req.body);
    console.log('Headers:', req.headers);
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP

    try {
        // Insert or update OTP for user by email
        await pool.execute(
            `INSERT INTO otp_verifications (email, otp, created_at, updated_at)
             VALUES (?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE otp = VALUES(otp), updated_at = NOW()`,
            [email, otp]
        );

        // Send OTP via email
        await transporter.sendMail({
            from: `"Cointo" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your Cointo OTP Code',
            text: `Your OTP code is: ${otp}. It expires in 10 minutes.`,
            html: `<p>Your OTP code is: <strong>${otp}</strong>. It expires in 10 minutes.</p>`,
        });

        res.json({ message: 'OTP sent to email' });
    } catch (error) {
        console.error('OTP generation error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
};

// OTP verification
const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    try {
        // Find OTP record by email
        const [rows] = await pool.execute(
            `SELECT * FROM otp_verifications WHERE email = ? AND otp = ?`,
            [email, otp]
        );

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        // Check OTP expiration (valid for 10 minutes)
        const createdAt = new Date(rows[0].created_at);
        if ((Date.now() - createdAt.getTime()) > 10 * 60 * 1000) {
            return res.status(400).json({ error: 'OTP expired' });
        }

        // Delete OTP after successful verification
        await pool.execute(`DELETE FROM otp_verifications WHERE id = ?`, [rows[0].id]);

        // Find user by email
        const [users] = await pool.execute(
            `SELECT id, email, first_name, last_name, phone FROM users WHERE email = ?`,
            [email]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Get wallet number
        const [wallets] = await pool.execute(
            `SELECT wallet_number FROM wallets WHERE user_id = ?`,
            [user.id]
        );

        res.json({
            token,
            walletNumber: wallets[0]?.wallet_number,
            fullName: `${user.first_name} ${user.last_name}`,
            email: user.email,
            phoneNumber: user.phone,
        });
    } catch (error) {
        console.error('OTP verification error:', error);
        res.status(500).json({ error: 'OTP verification failed' });
    }
};

// Register )
const register = async (req, res) => {
    const { email, password, firstName, lastName, phone } = req.body;

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingUsers] = await connection.execute(
            'SELECT id FROM users WHERE email = ?',
            [email]
        );

        if (existingUsers.length > 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'User already exists with this email' });
        }

        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const [userResult] = await connection.execute(
            'INSERT INTO users (email, password_hash, first_name, last_name, phone) VALUES (?, ?, ?, ?, ?)',
            [email, hashedPassword, firstName, lastName, phone || null]
        );

        const userId = userResult.insertId;

        const [users] = await connection.execute(
            'SELECT id, email, first_name, last_name FROM users WHERE email = ?',
            [email]
        );

        const user = users[0];

        const walletNumber = await generateWalletNumber(connection);

        await connection.execute(
            'INSERT INTO wallets (user_id, wallet_number) VALUES (?, ?)',
            [user.id, walletNumber]
        );

        await connection.commit();

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                walletNumber,
            },
            token,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Registration error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'User already exists' });
        }
        res.status(500).json({ error: 'Registration failed. Please try again.' });
    } finally {
        connection.release();
    }
};

// Login and getProfile)
const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const [users] = await pool.execute(
            `SELECT 
                u.id, 
                u.email, 
                u.password_hash, 
                u.first_name, 
                u.last_name,
                u.phone,
                w.wallet_number,
                w.balance 
            FROM users u 
            LEFT JOIN wallets w ON u.id = w.user_id 
            WHERE u.email = ?`,
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                phone: user.phone,
                walletNumber: user.wallet_number,
                balance: parseFloat(user.balance || 0),
            },
            token,
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed. Please try again.' });
    }
};

const getProfile = async (req, res) => {
    try {
        const [users] = await pool.execute(
            `SELECT 
                u.id, 
                u.email, 
                u.first_name, 
                u.last_name,
                u.phone,
                w.wallet_number,
                w.balance 
            FROM users u 
            LEFT JOIN wallets w ON u.id = w.user_id 
            WHERE u.id = ?`,
            [req.userId]
        );

        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];

        res.json({
            user: {
                id: user.id,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                phone: user.phone,
                walletNumber: user.wallet_number,
                balance: parseFloat(user.balance || 0),
            },
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
};

module.exports = { register, login, getProfile, verifyOtp, generateOtp };