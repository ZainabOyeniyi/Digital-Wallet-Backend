const pool = require('../config/database');
const { paystackClient } = require('../config/paystack');
const { generateReference } = require('../utils/generateReference');
const { generateIdempotencyKey } = require('../utils/idempotency');

// Paystack test bank accounts for test mode (from Paystack documentation)
const PAYSTACK_TEST_ACCOUNTS = {
    '0000000000': { bankCode: '057', accountName: 'Paystack Test Account (Zenith Bank)', status: 'SUCCESS' },
    '9999999999': { bankCode: '057', accountName: 'Invalid Test Account (Zenith Bank)', status: 'FAILED' },
    '0001234567': { bankCode: '057', accountName: 'Paystack Transfer Test (Zenith Bank)', status: 'SUCCESS' },
    // Map frontend test accounts to Paystack test accounts for compatibility
    '0123456789': { bankCode: '057', accountName: 'Test Success Account (Zenith Bank)', status: 'SUCCESS' },
    '1234567890': { bankCode: '057', accountName: 'Test Pending Account (Zenith Bank)', status: 'PENDING' },
    '9876543210': { bankCode: '057', accountName: 'Test Failed Account (Zenith Bank)', status: 'FAILED' },
};

// Get wallet balance
const getWalletBalance = async (req, res) => {
    try {
        const [wallets] = await pool.execute(
            'SELECT balance, wallet_number, currency, u.first_name, u.last_name FROM wallets w JOIN users u ON w.user_id = u.id WHERE w.user_id = ? AND w.is_active = TRUE',
            [req.userId]
        );

        if (wallets.length === 0) {
            return res.status(404).json({ status: 'error', message: 'Wallet not found' });
        }

        const wallet = wallets[0];
        res.json({
            status: 'success',
            balance: parseFloat(wallet.balance),
            walletNumber: wallet.wallet_number,
            currency: wallet.currency,
            fullName: `${wallet.first_name} ${wallet.last_name}`,
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ status: 'error', message: 'Failed to fetch wallet balance' });
    }
};

// Initialize wallet funding
const initializeFunding = async (req, res) => {
    const { amount } = req.body;

    if (!amount || amount < 100) {
        return res.status(400).json({ status: 'error', message: 'Amount must be at least ₦100' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [users] = await connection.execute(
            'SELECT email, first_name, last_name FROM users WHERE id = ?',
            [req.userId]
        );

        if (users.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        const user = users[0];
        const reference = generateReference();

        const response = await paystackClient.post('/transaction/initialize', {
            email: user.email,
            amount: Math.round(amount * 100), // Convert to kobo
            reference,
            callback_url: `${process.env.FRONTEND_URL}/fund-success`,
            metadata: {
                custom_fields: [
                    {
                        display_name: 'Customer Name',
                        variable_name: 'customer_name',
                        value: `${user.first_name} ${user.last_name}`,
                    },
                ],
            },
        });

        if (!response.data.status) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: response.data.message || 'Failed to initialize payment' });
        }

        const [wallets] = await connection.execute(
            'SELECT id FROM wallets WHERE user_id = ? AND is_active = TRUE',
            [req.userId]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Wallet not found' });
        }

        await connection.execute(
            'INSERT INTO transactions (wallet_id, type, category, amount, reference, description, paystack_reference, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [
                wallets[0].id,
                'CREDIT',
                'FUNDING',
                amount,
                reference,
                'Wallet funding via Paystack',
                reference,
                'PENDING',
            ]
        );

        await connection.commit();

        res.json({
            status: 'success',
            authorization_url: response.data.data.authorization_url,
            access_code: response.data.data.access_code,
            reference,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Initialize funding error:', error);
        res.status(500).json({ status: 'error', message: error.response?.data?.message || 'Failed to initialize funding' });
    } finally {
        connection.release();
    }
};

// Transfer money to another wallet
const transferMoney = async (req, res) => {
    const { recipientWalletNumber, amount, description, idempotencyKey } = req.body;

    if (!recipientWalletNumber || !amount || amount < 100) {
        return res.status(400).json({ status: 'error', message: 'Recipient wallet number and amount (minimum ₦100) are required' });
    }

    if (!idempotencyKey) {
        return res.status(400).json({ status: 'error', message: 'Idempotency key is required' });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingTxn] = await connection.execute(
            'SELECT id, status, reference FROM transactions WHERE idempotency_key = ?',
            [idempotencyKey]
        );

        if (existingTxn.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Transaction already processed',
                reference: existingTxn[0].reference,
                transactionId: existingTxn[0].id,
            });
        }

        const [senderWallets] = await connection.execute(
            'SELECT id, balance, wallet_number FROM wallets WHERE user_id = ? AND is_active = TRUE FOR UPDATE',
            [req.userId]
        );

        if (senderWallets.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Sender wallet not found or inactive' });
        }

        const senderWallet = senderWallets[0];

        if (parseFloat(senderWallet.balance) < amount) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });
        }

        const [recipientWallets] = await connection.execute(
            'SELECT id, user_id, wallet_number FROM wallets WHERE wallet_number = ? AND is_active = TRUE FOR UPDATE',
            [recipientWalletNumber]
        );

        if (recipientWallets.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Recipient wallet not found' });
        }

        const recipientWallet = recipientWallets[0];

        if (senderWallet.id === recipientWallet.id) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: 'Cannot transfer money to your own wallet' });
        }

        const reference = generateReference();

        await connection.execute(
            'UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [amount, senderWallet.id]
        );

        await connection.execute(
            'INSERT INTO transactions (wallet_id, type, category, amount, status, reference, description, idempotency_key, recipient_wallet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [
                senderWallet.id,
                'DEBIT',
                'TRANSFER',
                amount,
                'COMPLETED',
                reference,
                description || `Transfer to ${recipientWalletNumber}`,
                idempotencyKey,
                recipientWallet.id,
            ]
        );

        await connection.execute(
            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [amount, recipientWallet.id]
        );

        await connection.execute(
            'INSERT INTO transactions (wallet_id, type, category, amount, status, reference, description, idempotency_key, recipient_wallet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [
                recipientWallet.id,
                'CREDIT',
                'TRANSFER',
                amount,
                'COMPLETED',
                `rcv_${reference}`,
                description || `Transfer from ${senderWallet.wallet_number}`,
                `rcv_${idempotencyKey}`,
                senderWallet.id,
            ]
        );

        await connection.commit();

        const [updatedWallet] = await connection.execute(
            'SELECT balance FROM wallets WHERE id = ?',
            [senderWallet.id]
        );

        res.json({
            status: 'success',
            message: 'Transfer successful',
            reference,
            amount: parseFloat(amount),
            recipientWalletNumber,
            newBalance: parseFloat(updatedWallet[0].balance),
        });
    } catch (error) {
        await connection.rollback();
        console.error('Transfer error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ status: 'error', message: 'Duplicate transaction detected' });
        } else if (error.code === 'ER_LOCK_WAIT_TIMEOUT') {
            return res.status(503).json({ status: 'error', message: 'Transaction timeout, please try again' });
        }
        res.status(500).json({ status: 'error', message: error.message || 'Transfer failed' });
    } finally {
        connection.release();
    }
};

// Withdraw money to a bank account
const withdrawMoney = async (req, res) => {
    const { amount, bankCode, accountNumber, accountName, idempotencyKey } = req.body;

    if (!amount || amount < 100 || !bankCode || !accountNumber || !accountName || !idempotencyKey) {
        return res.status(400).json({
            status: 'error',
            message: 'Amount (minimum ₦100), bank code, account number, account name, and idempotency key are required',
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [existingTxn] = await connection.execute(
            'SELECT id, status, reference FROM transactions WHERE idempotency_key = ? AND category = "WITHDRAWAL"',
            [idempotencyKey]
        );

        if (existingTxn.length > 0) {
            await connection.rollback();
            return res.status(409).json({
                status: 'error',
                message: 'Withdrawal already processed',
                reference: existingTxn[0].reference,
                transactionId: existingTxn[0].id,
            });
        }

        const [wallets] = await connection.execute(
            'SELECT id, balance FROM wallets WHERE user_id = ? AND is_active = TRUE FOR UPDATE',
            [req.userId]
        );

        if (wallets.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Wallet not found or inactive' });
        }

        const wallet = wallets[0];

        if (parseFloat(wallet.balance) < amount) {
            await connection.rollback();
            return res.status(400).json({ status: 'error', message: 'Insufficient wallet balance' });
        }

        const reference = generateReference();

        if (process.env.NODE_ENV === 'test') {
            const testAccount = PAYSTACK_TEST_ACCOUNTS[accountNumber];

            if (!testAccount || testAccount.bankCode !== bankCode || testAccount.accountName.toLowerCase() !== accountName.toLowerCase()) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid test account details. Use Paystack test accounts: ${Object.keys(PAYSTACK_TEST_ACCOUNTS).join(', ')} with bank code 057`,
                });
            }

            let status = testAccount.status;
            let message = 'Test withdrawal simulated successfully';

            if (status === 'FAILED') {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: 'Test withdrawal failed (simulated)',
                    reference,
                });
            }

            if (status !== 'PENDING') {
                await connection.execute(
                    'UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [amount, wallet.id]
                );
            }

            await connection.execute(
                'INSERT INTO transactions (wallet_id, type, category, amount, status, reference, description, idempotency_key, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
                [
                    wallet.id,
                    'DEBIT',
                    'WITHDRAWAL',
                    amount,
                    status,
                    reference,
                    `Test withdrawal to ${accountName} (${accountNumber}) - ${bankCode}`,
                    idempotencyKey,
                    JSON.stringify({ bankCode, accountNumber, accountName, withdrawal_type: 'bank_transfer_test' }),
                ]
            );

            await connection.commit();

            const [updatedWallet] = await connection.execute(
                'SELECT balance FROM wallets WHERE id = ?',
                [wallet.id]
            );

            return res.json({
                status: 'success',
                message,
                reference,
                amount: parseFloat(amount),
                newBalance: parseFloat(updatedWallet[0].balance),
                status: status,
            });
        }

        const recipientResponse = await paystackClient.post('/transferrecipient', {
            type: 'nuban',
            name: accountName,
            account_number: accountNumber,
            bank_code: bankCode,
            currency: 'NGN',
        });

        if (!recipientResponse.data.status) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: recipientResponse.data.message || 'Failed to create transfer recipient',
            });
        }

        const recipientCode = recipientResponse.data.data.recipient_code;

        const transferResponse = await paystackClient.post('/transfer', {
            source: 'balance',
            amount: Math.round(amount * 100),
            recipient: recipientCode,
            reference,
            reason: 'Wallet withdrawal',
        });

        if (!transferResponse.data.status) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: transferResponse.data.message || 'Failed to initiate withdrawal',
            });
        }

        await connection.execute(
            'UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [amount, wallet.id]
        );

        await connection.execute(
            'INSERT INTO transactions (wallet_id, type, category, amount, status, reference, description, idempotency_key, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [
                wallet.id,
                'DEBIT',
                'WITHDRAWAL',
                amount,
                'PENDING',
                reference,
                `Withdrawal to ${accountName} (${accountNumber}) - ${bankCode}`,
                idempotencyKey,
                JSON.stringify({
                    bankCode,
                    accountNumber,
                    accountName,
                    paystackTransferCode: transferResponse.data.data.transfer_code,
                    recipientCode,
                }),
            ]
        );

        await connection.commit();

        res.json({
            status: 'success',
            message: 'Withdrawal initiated successfully',
            reference,
            amount: parseFloat(amount),
            status: 'PENDING',
            transferCode: transferResponse.data.data.transfer_code,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Withdrawal error:', error);
        res.status(500).json({ status: 'error', message: error.response?.data?.message || error.message || 'Withdrawal failed' });
    } finally {
        connection.release();
    }
};

// Get list of banks
const getBanks = async (req, res) => {
    try {
        const response = await paystackClient.get('/bank?currency=NGN');

        if (response.data.status) {
            res.json({
                status: 'success',
                banks: response.data.data.map(bank => ({
                    name: bank.name,
                    code: bank.code,
                    slug: bank.slug,
                })),
            });
        } else {
            res.status(400).json({ status: 'error', message: 'Failed to fetch banks' });
        }
    } catch (error) {
        console.error('Get banks error:', error);
        res.status(500).json({ status: 'error', message: error.response?.data?.message || 'Failed to fetch banks list' });
    }
};

// Verify account number
const verifyAccountNumber = async (req, res) => {
    const { accountNumber, bankCode } = req.body;

    if (!accountNumber || !bankCode || accountNumber.length !== 10) {
        return res.status(400).json({ status: 'error', message: 'Invalid account number (must be 10 digits) or bank code' });
    }

    try {
        if (process.env.NODE_ENV === 'test') {
            const testAccount = PAYSTACK_TEST_ACCOUNTS[accountNumber];

            if (testAccount && testAccount.bankCode === bankCode) {
                if (testAccount.status === 'FAILED') {
                    return res.status(400).json({
                        status: 'error',
                        message: 'Invalid test account details (simulated failure)',
                    });
                }
                return res.json({
                    status: 'success',
                    accountName: testAccount.accountName,
                    accountNumber,
                });
            } else {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid test account. Use Paystack test accounts: ${Object.keys(PAYSTACK_TEST_ACCOUNTS).join(', ')} with bank code 057`,
                });
            }
        }

        const response = await paystackClient.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);

        if (response.data.status) {
            res.json({
                status: 'success',
                accountName: response.data.data.account_name,
                accountNumber: response.data.data.account_number,
            });
        } else {
            res.status(400).json({ status: 'error', message: response.data.message || 'Invalid account details' });
        }
    } catch (error) {
        console.error('Account verification error:', error);
        res.status(error.response?.status || 500).json({
            status: 'error',
            message: error.response?.data?.message || 'Account verification failed',
        });
    }
};

// Verify payment
const verifyPayment = async (req, res) => {
    const { reference } = req.params;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [transactions] = await connection.execute(
            'SELECT id, wallet_id, amount, status FROM transactions WHERE paystack_reference = ? AND category = "FUNDING"',
            [reference]
        );

        if (transactions.length === 0) {
            await connection.rollback();
            return res.status(404).json({ status: 'error', message: 'Transaction not found' });
        }

        const transaction = transactions[0];

        if (transaction.status === 'COMPLETED') {
            const [wallets] = await connection.execute(
                'SELECT balance FROM wallets WHERE id = ?',
                [transaction.wallet_id]
            );

            await connection.commit();
            return res.json({
                status: 'success',
                message: 'Payment already processed',
                reference,
                amount: parseFloat(transaction.amount),
                newBalance: parseFloat(wallets[0].balance),
                status: 'COMPLETED',
            });
        }

        const response = await paystackClient.get(`/transaction/verify/${reference}`);

        if (!response.data.status || response.data.data.status !== 'success') {
            await connection.execute(
                'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = "PENDING"',
                [transaction.id]
            );
            await connection.commit();
            return res.status(400).json({
                status: 'error',
                message: `Payment ${response.data.data.status || 'failed'}`,
            });
        }

        const paystackAmount = response.data.data.amount / 100;
        if (Math.abs(paystackAmount - parseFloat(transaction.amount)) > 0.01) {
            await connection.execute(
                'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = "PENDING"',
                [transaction.id]
            );
            await connection.commit();
            return res.status(400).json({
                status: 'error',
                message: `Amount mismatch: expected ₦${transaction.amount}, got ₦${paystackAmount}`,
            });
        }

        await connection.execute(
            'UPDATE transactions SET status = "COMPLETED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.id]
        );

        await connection.execute(
            'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [transaction.amount, transaction.wallet_id]
        );

        await connection.commit();

        const [wallets] = await connection.execute(
            'SELECT balance FROM wallets WHERE id = ?',
            [transaction.wallet_id]
        );

        console.log(`✅ Payment verified: ${reference} - ₦${transaction.amount}`);

        res.json({
            status: 'success',
            message: 'Payment verified and wallet funded successfully',
            reference,
            amount: parseFloat(transaction.amount),
            newBalance: parseFloat(wallets[0].balance),
            status: 'COMPLETED',
        });
    } catch (error) {
        await connection.rollback();
        console.error('Payment verification error:', error);
        res.status(500).json({
            status: 'error',
            message: error.response?.data?.message || error.message || 'Payment verification failed',
        });
    } finally {
        connection.release();
    }
};

// Webhook handler for Paystack events
const handleWebhook = async (req, res) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
    }

    const event = req.body;
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        if (event.event === 'charge.success') {
            const { reference, amount } = event.data;

            const [transactions] = await connection.execute(
                'SELECT id, wallet_id, amount, status FROM transactions WHERE paystack_reference = ? AND category = "FUNDING"',
                [reference]
            );

            if (transactions.length === 0) {
                await connection.rollback();
                return res.status(404).json({ status: 'error', message: 'Transaction not found' });
            }

            const transaction = transactions[0];

            if (transaction.status === 'COMPLETED') {
                await connection.commit();
                return res.status(200).json({ status: 'success', message: 'Transaction already processed' });
            }

            const paystackAmount = amount / 100;
            if (Math.abs(paystackAmount - parseFloat(transaction.amount)) > 0.01) {
                await connection.execute(
                    'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [transaction.id]
                );
                await connection.commit();
                return res.status(400).json({ status: 'error', message: 'Amount mismatch' });
            }

            await connection.execute(
                'UPDATE transactions SET status = "COMPLETED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [transaction.id]
            );

            await connection.execute(
                'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [transaction.amount, transaction.wallet_id]
            );

            console.log(`✅ Webhook: Funding completed: ${reference} - ₦${transaction.amount}`);
        } else if (event.event === 'transfer.success') {
            const { reference } = event.data;

            const [transactions] = await connection.execute(
                'SELECT id, wallet_id FROM transactions WHERE reference = ? AND category = "WITHDRAWAL"',
                [reference]
            );

            if (transactions.length === 0) {
                await connection.rollback();
                return res.status(404).json({ status: 'error', message: 'Transaction not found' });
            }

            const transaction = transactions[0];

            await connection.execute(
                'UPDATE transactions SET status = "COMPLETED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [transaction.id]
            );

            console.log(`✅ Webhook: Withdrawal completed: ${reference}`);
        } else if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
            const { reference, amount } = event.data;

            const [transactions] = await connection.execute(
                'SELECT id, wallet_id, amount FROM transactions WHERE reference = ? AND category = "WITHDRAWAL"',
                [reference]
            );

            if (transactions.length === 0) {
                await connection.rollback();
                return res.status(404).json({ status: 'error', message: 'Transaction not found' });
            }

            const transaction = transactions[0];

            await connection.execute(
                'UPDATE transactions SET status = "FAILED", updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [transaction.id]
            );

            await connection.execute(
                'UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [transaction.amount, transaction.wallet_id]
            );

            console.log(`✅ Webhook: Withdrawal failed/reversed, refunded: ${reference} - ₦${transaction.amount}`);
        }

        await connection.commit();
        res.status(200).json({ status: 'success', message: 'Webhook processed' });
    } catch (error) {
        await connection.rollback();
        console.error('Webhook error:', error);
        res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
    } finally {
        connection.release();
    }
};

module.exports = {
    getWalletBalance,
    initializeFunding,
    transferMoney,
    withdrawMoney,
    getBanks,
    verifyAccountNumber,
    verifyPayment,
    handleWebhook,
};