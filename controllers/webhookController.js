// src/controllers/webhookController.js
const crypto = require('crypto');
const pool = require('../config/database');

const paystackWebhook = async (req, res) => {
    try {
        // Verify webhook signature
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex');

        console.log(` Paystack webhook signature: ${hash}`);

        if (hash !== req.headers['x-paystack-signature']) {
            console.error('Invalid webhook signature');
            return res.status(400).send('Invalid signature');
        }

        const event = req.body;
        console.log(` Paystack webhook received: ${event.event}`);

        switch (event.event) {
            case 'charge.success':
                await handleSuccessfulFunding(event.data);
                break;
            case 'transfer.success':
                await handleSuccessfulWithdrawal(event.data);
                break;
            case 'transfer.failed':
                await handleFailedWithdrawal(event.data);
                break;
            case 'transfer.reversed':
                await handleReversedWithdrawal(event.data);
                break;
            default:
                console.log(` Unhandled webhook event: ${event.event}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).send('Error processing webhook');
    }
};

// Updated handleSuccessfulFunding function

const handleSuccessfulFunding = async (data) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        console.log(`🔄 Processing funding webhook: ${data.reference}`);

        // Find the transaction (could be PENDING or already SUCCESS from immediate verification)
        const [transactions] = await connection.execute(
            'SELECT t.id, t.wallet_id, t.amount, t.status FROM transactions t WHERE t.paystack_reference = ? AND t.category = "FUNDING"',
            [data.reference]
        );

        if (transactions.length === 0) {
            console.warn(`❌ No funding transaction found for reference: ${data.reference}`);
            await connection.rollback();
            return;
        }

        const transaction = transactions[0];

        // If already processed by immediate verification, skip
        if (transaction.status === 'SUCCESS') {
            console.log(`✅ Funding already processed by immediate verification: ${data.reference}`);
            await connection.commit();
            return;
        }

        // Verify amount matches (webhook data is in kobo)
        const paystackAmount = data.amount / 100;
        if (Math.abs(paystackAmount - parseFloat(transaction.amount)) > 0.01) {
            console.error(`❌ Amount mismatch for ${data.reference}: expected ${transaction.amount}, got ${paystackAmount}`);
            await connection.rollback();
            return;
        }

        // Update transaction status
        await connection.execute(
            'UPDATE transactions SET status = "SUCCESS", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.id]
        );

        // Credit wallet
        await connection.execute(
            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.amount, transaction.wallet_id]
        );

        await connection.commit();
        console.log(`✅ Webhook funding completed: ${data.reference} - ₦${transaction.amount}`);

    } catch (error) {
        await connection.rollback();
        console.error('❌ Error handling successful funding webhook:', error);
        throw error;
    } finally {
        connection.release();
    }
};

const handleSuccessfulWithdrawal = async (data) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        console.log(` Processing successful withdrawal: ${data.reference}`);

        // Update transaction status
        const [result] = await connection.execute(
            'UPDATE transactions SET status = "SUCCESS", updated_at = CURRENT_TIMESTAMP WHERE reference = ? AND status = "PENDING"',
            [data.reference]
        );

        if (result.affectedRows === 0) {
            console.warn(` No pending withdrawal found for reference: ${data.reference}`);
        } else {
            console.log(` Withdrawal completed: ${data.reference}`);
        }

        await connection.commit();

    } catch (error) {
        await connection.rollback();
        console.error(' Error handling successful withdrawal:', error);
        throw error;
    } finally {
        connection.release();
    }
};

const handleFailedWithdrawal = async (data) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        console.log(` Processing failed withdrawal: ${data.reference}`);

        // Get transaction details
        const [transactions] = await connection.execute(
            'SELECT t.id, t.wallet_id, t.amount FROM transactions t WHERE t.reference = ? AND t.status = "PENDING"',
            [data.reference]
        );

        if (transactions.length === 0) {
            console.warn(`  No pending withdrawal found for reference: ${data.reference}`);
            await connection.rollback();
            return;
        }

        const transaction = transactions[0];

        // Update transaction status to failed
        await connection.execute(
            'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.id]
        );

        // Refund the wallet (since money was already debited)
        await connection.execute(
            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.amount, transaction.wallet_id]
        );

        await connection.commit();
        console.log(` Withdrawal failed, wallet refunded: ${data.reference} - ₦${transaction.amount}`);

    } catch (error) {
        await connection.rollback();
        console.error(' Error handling failed withdrawal:', error);
        throw error;
    } finally {
        connection.release();
    }
};

const handleReversedWithdrawal = async (data) => {
    // Handle the same way as failed withdrawal
    await handleFailedWithdrawal(data);
};

module.exports = paystackWebhook;