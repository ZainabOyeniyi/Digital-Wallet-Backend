// src/controllers/transactionController.js
const pool = require('../config/database');

const getTransactionHistory = async (req, res) => {
    const { page = 1, limit = 20, type, category, status } = req.query;
    const offset = (page - 1) * limit;

    try {
        // Build dynamic query based on filters
        let whereClause = 'WHERE w.user_id = ?';
        let queryParams = [req.userId];

        if (type && ['CREDIT', 'DEBIT'].includes(type)) {
            whereClause += ' AND t.type = ?';
            queryParams.push(type);
        }

        if (category && ['FUNDING', 'TRANSFER', 'WITHDRAWAL'].includes(category)) {
            whereClause += ' AND t.category = ?';
            queryParams.push(category);
        }

        if (status && ['PENDING', 'SUCCESS', 'FAILED'].includes(status)) {
            whereClause += ' AND t.status = ?';
            queryParams.push(status);
        }

        // Get transactions with pagination
        const [transactions] = await pool.execute(`
            SELECT 
                t.id,
                t.type,
                t.category,
                t.amount,
                t.status,
                t.reference,
                t.description,
                t.created_at,
                t.updated_at,
                rw.wallet_number as recipient_wallet_number,
                CASE 
                    WHEN t.recipient_wallet_id IS NOT NULL THEN (
                        SELECT CONCAT(u.first_name, ' ', u.last_name) 
                        FROM users u 
                        JOIN wallets w ON u.id = w.user_id 
                        WHERE w.id = t.recipient_wallet_id
                    )
                    ELSE NULL 
                END as recipient_name
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            LEFT JOIN wallets rw ON t.recipient_wallet_id = rw.id
            ${whereClause}
            ORDER BY t.created_at DESC
            LIMIT ? OFFSET ?
        `, [...queryParams, parseInt(limit), parseInt(offset)]);

        // Get total count for pagination
        const [countResult] = await pool.execute(`
            SELECT COUNT(*) as total
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            ${whereClause}
        `, queryParams);

        const total = countResult[0].total;

        res.json({
            transactions: transactions.map(txn => ({
                id: txn.id,
                type: txn.type,
                category: txn.category,
                amount: parseFloat(txn.amount),
                status: txn.status,
                reference: txn.reference,
                description: txn.description,
                recipientWalletNumber: txn.recipient_wallet_number,
                recipientName: txn.recipient_name,
                createdAt: txn.created_at,
                updatedAt: txn.updated_at
            })),
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalRecords: parseInt(total),
                hasNextPage: (page * limit) < total,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Get transaction history error:', error);
        res.status(500).json({ error: 'Failed to fetch transaction history' });
    }
};

const getTransactionDetails = async (req, res) => {
    const { reference } = req.params;

    try {
        const [transactions] = await pool.execute(`
            SELECT 
                t.id,
                t.type,
                t.category,
                t.amount,
                t.status,
                t.reference,
                t.description,
                t.metadata,
                t.created_at,
                t.updated_at,
                w.wallet_number as sender_wallet_number,
                rw.wallet_number as recipient_wallet_number,
                CASE 
                    WHEN t.recipient_wallet_id IS NOT NULL THEN (
                        SELECT CONCAT(u.first_name, ' ', u.last_name) 
                        FROM users u 
                        JOIN wallets w ON u.id = w.user_id 
                        WHERE w.id = t.recipient_wallet_id
                    )
                    ELSE NULL 
                END as recipient_name
            FROM transactions t
            JOIN wallets w ON t.wallet_id = w.id
            LEFT JOIN wallets rw ON t.recipient_wallet_id = rw.id
            WHERE t.reference = ? AND w.user_id = ?
        `, [reference, req.userId]);

        if (transactions.length === 0) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        const transaction = transactions[0];

        res.json({
            transaction: {
                id: transaction.id,
                type: transaction.type,
                category: transaction.category,
                amount: parseFloat(transaction.amount),
                status: transaction.status,
                reference: transaction.reference,
                description: transaction.description,
                metadata: transaction.metadata ? JSON.parse(transaction.metadata) : null,
                senderWalletNumber: transaction.sender_wallet_number,
                recipientWalletNumber: transaction.recipient_wallet_number,
                recipientName: transaction.recipient_name,
                createdAt: transaction.created_at,
                updatedAt: transaction.updated_at
            }
        });
    } catch (error) {
        console.error('Get transaction details error:', error);
        res.status(500).json({ error: 'Failed to fetch transaction details' });
    }
};

module.exports = {
    getTransactionHistory,
    getTransactionDetails
};