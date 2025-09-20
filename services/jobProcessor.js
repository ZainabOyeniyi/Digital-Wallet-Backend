// src/services/jobProcessor.js
const cron = require('node-cron');
const pool = require('../config/database');
const PaystackService = require('./paystackService');

class JobProcessor {
    static start() {
        console.log('Starting background job processor...');

        // Check pending withdrawals every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            await this.processPendingWithdrawals();
        });

        // Reconcile transactions every hour
        cron.schedule('0 * * * *', async () => {
            await this.reconcileTransactions();
        });

        //Delete expired OTPS after 15mins
        // cron.schedule('*/15 * * * *', async () => {
        //     await this.deleteExpiredOTPs();
        // });

        console.log(' Background jobs scheduled');
    }


    // static async deleteExpiredOTPs() {
    //     try {
    //         const [result] = await pool.execute(
    //             `DELETE FROMotp_verifications WHERE expires_at < NOW() AND verified = 0`
    //         );

    //         if (result.affectedRows > 0) {
    //             console.log(`Deleted ${result.affectedRows} expired OTPs`);
    //         }
    //     } catch (error) {
    //         console.error('Error deleting expired OTPs:', error);
    //     }
    // }

    static async processPaidWithdrawals() {
        console.log('Processing Paid Withdrawals...');

        const [paidWithdrawals] = await pool.execute(`
            SELECT 
                t.id,   
                t.reference,
                t.wallet_id,
                t.amount,   
                t.metadata,
                t.created_at
            FROM transactions t
            WHERE t.category = "WITHDRAWAL"
            AND t.status = "SUCCESS"            
            ORDER BY t.created_at ASC
            LIMIT 10
        `);
        for (const withdrawal of paidWithdrawals) {
            await this.checkWithdrawalStatus(withdrawal);
        }

    }
    static async processPendingWithdrawals() {
        console.log('Processing pending withdrawals...');

        try {
            // Get pending withdrawals older than 5 minutes
            const [pendingWithdrawals] = await pool.execute(`
                SELECT 
                    t.id,
                    t.reference,
                    t.wallet_id,
                    t.amount,
                    t.metadata,
                    t.created_at
                FROM transactions t
                WHERE t.category = 'WITHDRAWAL' 
                AND t.status = 'PENDING'
                AND t.created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
                ORDER BY t.created_at ASC
                LIMIT 10
            `);

            for (const withdrawal of pendingWithdrawals) {
                await this.checkWithdrawalStatus(withdrawal);
            }

            if (pendingWithdrawals.length > 0) {
                console.log(` Processed ${pendingWithdrawals.length} pending withdrawals`);
            }

        } catch (error) {
            console.error('Error processing pending withdrawals:', error);
        }
    }

    static async checkWithdrawalStatus(withdrawal) {
        try {
            const metadata = JSON.parse(withdrawal.metadata || '{}');
            const transferCode = metadata.paystackTransferCode;

            if (!transferCode) {
                console.warn(` No transfer code found for withdrawal ${withdrawal.reference}`);
                return;
            }

            // Check status with Paystack
            const result = await PaystackService.checkTransferStatus(transferCode);

            if (result.success) {
                const transferStatus = result.data.status;

                const connection = await pool.getConnection();

                try {
                    await connection.beginTransaction();

                    if (transferStatus === 'success') {
                        // Mark as successful
                        await connection.execute(
                            'UPDATE transactions SET status = "SUCCESS", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [withdrawal.id]
                        );

                        console.log(` Withdrawal ${withdrawal.reference} marked as successful`);

                    } else if (transferStatus === 'failed' || transferStatus === 'reversed') {
                        // Mark as failed and refund wallet
                        await connection.execute(
                            'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [withdrawal.id]
                        );

                        // Refund the wallet
                        await connection.execute(
                            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [withdrawal.amount, withdrawal.wallet_id]
                        );

                        console.log(` Withdrawal ${withdrawal.reference} failed, wallet refunded`);
                    }

                    await connection.commit();

                } catch (error) {
                    await connection.rollback();
                    throw error;
                } finally {
                    connection.release();
                }
            }

        } catch (error) {
            console.error(` Error checking withdrawal status for ${withdrawal.reference}:`, error);
        }
    }

    static async reconcileTransactions() {
        console.log(' Starting transaction reconciliation...');

        try {
            // Get transactions from last 24 hours for reconciliation
            const [recentTransactions] = await pool.execute(`
                SELECT 
                    t.id,
                    t.reference,
                    t.paystack_reference,
                    t.status,
                    t.category,
                    t.amount
                FROM transactions t
                WHERE t.created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
                AND t.paystack_reference IS NOT NULL
                AND t.category IN ('FUNDING', 'WITHDRAWAL')
                ORDER BY t.created_at DESC
                LIMIT 50
            `);

            for (const transaction of recentTransactions) {
                if (transaction.category === 'FUNDING') {
                    await this.reconcileFundingTransaction(transaction);
                } else if (transaction.category === 'WITHDRAWAL') {
                    await this.reconcileWithdrawalTransaction(transaction);
                }
            }

            console.log(`Reconciled ${recentTransactions.length} transactions`);

        } catch (error) {
            console.error('Error during transaction reconciliation:', error);
        }
    }

    static async reconcileFundingTransaction(transaction) {
        try {
            if (transaction.status === 'SUCCESS') {
                return; // Already processed
            }

            const result = await PaystackService.verifyPayment(transaction.paystack_reference);

            if (result.success && result.data.status === 'success') {
                const connection = await pool.getConnection();

                try {
                    await connection.beginTransaction();

                    // Update transaction status
                    await connection.execute(
                        'UPDATE transactions SET status = "SUCCESS", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                        [transaction.id]
                    );

                    // Get wallet ID
                    const [wallets] = await connection.execute(
                        'SELECT wallet_id FROM transactions WHERE id = ?',
                        [transaction.id]
                    );

                    if (wallets.length > 0) {
                        // Credit wallet
                        await connection.execute(
                            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                            [transaction.amount, wallets[0].wallet_id]
                        );
                    }

                    await connection.commit();
                    console.log(`Reconciled funding transaction: ${transaction.reference}`);

                } catch (error) {
                    await connection.rollback();
                    throw error;
                } finally {
                    connection.release();
                }
            }

        } catch (error) {
            console.error(` Error reconciling funding transaction ${transaction.reference}:`, error);
        }
    }

    static async reconcileWithdrawalTransaction(transaction) {
        // Similar logic to funding reconciliation but for withdrawals
        // Implementation would depend on specific business requirements
        console.log(` Reconciling withdrawal transaction: ${transaction.reference}`);
    }
}

// Start the job processor
JobProcessor.start();

module.exports = JobProcessor;