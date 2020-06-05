// Dependencies
const Web3 = require("web3");
const DepositJSON = require("@keep-network/tbtc/artifacts/Deposit.json");
const TBTCSystemJSON = require("@keep-network/tbtc/artifacts/TBTCSystem.json");

//internal files
const config = require('./config.json');
const {getGasPrice} = require('./gas-price.js');

// Web3 related constants
const web3 = new Web3(new Web3.providers.WebsocketProvider(`wss://${config.network}.infura.io/ws/v3/${config.infura}`));
const TBTCSystemAddress = config.TBTCAddress;
const TBTCSystemContract = new web3.eth.Contract(TBTCSystemJSON.abi, TBTCSystemAddress);

const NAP_TIME = config.hunterNapTime * 1000;


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    var deposits = [];
    const account = await web3.eth.accounts.privateKeyToAccount(process.env.TBTC_PKEY);
    web3.eth.accounts.wallet.add(account);
    web3.eth.defaultAccount = account.address;
    // Fetch all the created Deposits since the beginning
    var depositsCreated = await TBTCSystemContract.getPastEvents("Created", {
        fromBlock:config.deploymentBlock
    }, (error, result) => {
        if (error) console.log("Couldn't get previously created Deposits.");
    });

    // We treat every "past" courtesyCall as if they are current
    // We build an array of active Deposits
    for (var i = 0; i < depositsCreated.length; i++) {
        const depositAddress = depositsCreated[i].returnValues._depositContractAddress;
        const deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
        // State of Deposit should be ACTIVE
        var result = await deposit.methods.getCurrentState().call();
        if (result == 4 || result == 8) deposits.push(deposit);
    }


    //Listens for future contract creations
    TBTCSystemContract.events.Created(function(error, result){
        if (error) {
            console.log(error);
        } else {
            const depositAddress = result.returnValues._depositContractAddress;
            const deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
            deposits.push(deposit);
        }
    });

    while (1) {
        attemptLiquidationOnAll(deposits);
        await sleep(NAP_TIME);
    }
}

async function attemptLiquidationOnAll(deposits) {
    deposits.forEach(async (deposit, index, deposits) => {
        const depositAddress = deposit._address;
        const collateralizationPercentage = await deposit.methods.getCollateralizationPercentage()
            .call((error, result) => {
                if (error) {
                    console.log(`Error when calling getCollateralizationPercentage() of ${depositAddress} : ${error.message}`);
                    return;
                }
            });
            const severeThreshold = await deposit.methods.getSeverelyUndercollateralizedThresholdPercent()
            .call((error, result) => {
                if (error) {
                    console.log(`Error when calling getSeverelyUndercollateralizedThresholdPercent() of ${depositAddress} : ${error.message}`);
                    return;
                }
            });
            const price = await getGasPrice();
            if (severeThreshold > collateralizationPercentage) {
                deposit.methods.notifyUndercollateralizedLiquidation().send({gasPrice:price, gas:400000})
                .on('receipt', function(receipt) {
                    console.log(`notifyUndercollateralizedLiquidation on Deposit ${depositAddress} was successfull.`);
                    deposits.splice(index, 1);
                }).on('error', function(error, receipt) {
                    console.log(`notifyUndercollateralizedLiquidation on Deposit ${depositAddress} failed. Error : ${error.message}`);
                });
            }
    });
}


main();
