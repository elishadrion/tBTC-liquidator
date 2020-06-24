const config = require('./config.json');
const got = require('got');
const cheerio = require('cheerio');

async function getGasPrice() {
    var response;
    var price = config.defaultGasPrice;
    try {
        response = await got('https://ethgasstation.info');
        const $ = cheerio.load(response.body);
        price = parseInt($('.count.fast').text()); //price in Gwei
        price = price * 1000000000; //convert to wei
    } catch (error) {
        return price;
    }
    return price;
}

module.exports = {
    getGasPrice
}
