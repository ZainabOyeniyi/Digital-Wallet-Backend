// src/services/paystackService.js
const { paystackClient } = require('../config/paystack');

class PaystackService {

    // Initialize payment for wallet funding
    static async initializePayment({ email, amount, reference, metadata = {} }) {
        try {
            const response = await paystackClient.post('/transaction/initialize', {
                email,
                amount: Math.round(amount * 100), // Convert to kobo
                reference,
                callback_url: `${process.env.FRONTEND_URL}/wallet/funding-success`,
                metadata: {
                    custom_fields: [
                        {
                            display_name: "Purpose",
                            variable_name: "purpose",
                            value: "Wallet Funding"
                        },
                        ...Object.entries(metadata).map(([key, value]) => ({
                            display_name: key,
                            variable_name: key.toLowerCase().replace(' ', '_'),
                            value: value.toString()
                        }))
                    ]
                }
            });

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack initialize payment error:', error);
            throw new Error(error.response?.data?.message || 'Payment initialization failed');
        }
    }

    // Verify payment transaction
    static async verifyPayment(reference) {
        try {
            const response = await paystackClient.get(`/transaction/verify/${reference}`);

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack verify payment error:', error);
            throw new Error(error.response?.data?.message || 'Payment verification failed');
        }
    }

    // Get list of banks
    static async getBanks() {
        try {
            const response = await paystackClient.get('/bank?currency=NGN');

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack get banks error:', error);
            throw new Error(error.response?.data?.message || 'Failed to fetch banks');
        }
    }

    // Resolve account number
    static async resolveAccountNumber(accountNumber, bankCode) {
        try {
            const response = await paystackClient.get(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack resolve account error:', error);
            throw new Error(error.response?.data?.message || 'Account resolution failed');
        }
    }

    // Create transfer recipient
    static async createTransferRecipient({ name, accountNumber, bankCode }) {
        try {
            const response = await paystackClient.post('/transferrecipient', {
                type: 'nuban',
                name,
                account_number: accountNumber,
                bank_code: bankCode,
                currency: 'NGN'
            });

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack create recipient error:', error);
            throw new Error(error.response?.data?.message || 'Failed to create transfer recipient');
        }
    }

    // Initiate transfer
    static async initiateTransfer({ source = 'balance', amount, recipientCode, reference, reason }) {
        try {
            const response = await paystackClient.post('/transfer', {
                source,
                amount: Math.round(amount * 100), // Convert to kobo
                recipient: recipientCode,
                reference,
                reason: reason || 'Wallet withdrawal'
            });

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack initiate transfer error:', error);
            throw new Error(error.response?.data?.message || 'Transfer initiation failed');
        }
    }

    // Check transfer status
    static async checkTransferStatus(transferCode) {
        try {
            const response = await paystackClient.get(`/transfer/${transferCode}`);
            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack check transfer status error:', error);
            throw new Error(error.response?.data?.message || 'Failed to check transfer status');
        }
    }

    // Get account balance
    static async getBalance() {
        try {
            const response = await paystackClient.get('/balance');

            return {
                success: response.data.status,
                data: response.data.data,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack get balance error:', error);
            throw new Error(error.response?.data?.message || 'Failed to fetch balance');
        }
    }

    // List transactions
    static async listTransactions({ page = 1, perPage = 50, status, from, to }) {
        try {
            let url = `/transaction?page=${page}&perpage=${perPage}`;

            if (status) url += `&status=${status}`;
            if (from) url += `&from=${from}`;
            if (to) url += `&to=${to}`;

            const response = await paystackClient.get(url);

            return {
                success: response.data.status,
                data: response.data.data,
                meta: response.data.meta,
                message: response.data.message
            };
        } catch (error) {
            console.error('Paystack list transactions error:', error);
            throw new Error(error.response?.data?.message || 'Failed to fetch transactions');
        }
    }
}

module.exports = PaystackService;