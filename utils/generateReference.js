const crypto = require('crypto');

const generateReference = (prefix = 'TXN') => {
    const timestamp = Date.now();
    const uuid = crypto.randomUUID().replace(/-/g, '');
    return `${prefix}_${timestamp}_${uuid}`;
};

const generateTransferReference = () => generateReference('TRF');
const generateFundingReference = () => generateReference('FND');
const generateWithdrawalReference = () => generateReference('WTH');

module.exports = {
    generateReference,
    generateTransferReference,
    generateFundingReference,
    generateWithdrawalReference
};