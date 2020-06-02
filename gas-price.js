const config = require('./config.json');
const got = require('got');

async function getGasPrice() {
        var response;
        var price = config.defaultGasPrice;
        try {
                response = await got('https://ethgasstation.info/api/ethgasAPI.json').json();
        } catch (error) {
                return price;
        }
        const fast = response.fast;
        if (!fast) {
                return price;
        }
        price = Math.round((Number(fast) * 100000000));
        return price;
}

module.exports = {
    getGasPrice
}
