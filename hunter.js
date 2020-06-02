// Dependencies
const request = require('request');
const Web3 = require("web3");
const DepositJSON = require("@keep-network/tbtc/artifacts/Deposit.json");
const TBTCSystemJSON = require("@keep-network/tbtc/artifacts/TBTCSystem.json");

//internal files
const config = require('./config.json');
const {getGasPrice} = require('./gas-price.js');

// Web3 related constants
const web3 = new Web3(new Web3.providers.WebsocketProvider(`wss://mainnet.infura.io/ws/v3/${config.infura}`));
const TBTCSystemAddress = config.TBTCAddress;
const TBTCSystemContract = new web3.eth.Contract(TBTCSystemJSON.abi, TBTCSystemAddress);

const NAP_TIME = config.hunterNapTime * 1000;


const account = await web3.eth.accounts.privateKeyToAccount(process.env.TBTC_PKEY);
web3.eth.accounts.wallet.add(account);
web3.eth.defaultAccount = account.address;

var deposits = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
        // Fetch all the created Deposits since the beginning
        var depositsCreated = await TBTCSystemContract.getPastEvents("Created", {
                fromBlock:config.deploymentBlock
        }, (error, result) => {
                if (error) {
                        console.log("Couldn't get previously created Deposits.");
                }
        });

        // We treat every "past" courtesyCall as if they are current
        // We build an array of active Deposits
        deposits = depositsCreated.map(function(e) {
                const depositAddress = e.returnValues._depositContractAddress;
                var deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
                // State of Deposit should be ACTIVE
                deposit.methods.getCurrentState().call((error, result) => {
                        if (error) {
                                // do nothing
                        } else {
                                if (result == 4 || result == 8) {
                                        return deposit;
                                }
                        }
                });
        });

        while (1) {
                attemptLiquidationOnAll();
                await sleep(NAP_TIME);
        }
}

async function attemptLiquidationOnAll() {
        for (var i = 0; i < deposits.length; i++) {
                var deposit = deposits[i];
                const collateralizationPercentage = await deposit.methods.getCollateralizationPercentage()
                .call((error, result) => {
                        if (error)
                                continue;
                });
                const severeThreshold = await deposit.methods.getSeverelyUndercollateralizedThresholdPercent()
                .call((error, result) => {
                        if (error)
                                continue;
                });
                const price = await getGasPrice();
                const depositAddress = deposit.options.address;
                if (severeThreshold > collateralizationPercentage) {
                        deposit.methods.notifyUndercollateralizedLiquidation().send({gasPrice:price, gas:400000})
                        .on('receipt', function(receipt) {
                                console.log(`notifyUndercollateralizedLiquidation on Deposit ${depositAddress} was successfull.`)
                        }).on('error', function(error, receipt) {
                                console.log(`notifyUndercollateralizedLiquidation on Deposit ${depositAddress} failed.`)
                        });
                }

        }
}

main();
