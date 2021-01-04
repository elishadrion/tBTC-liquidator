// Dependencies
require('dotenv').config();
const Web3 = require("web3");
const DepositJSON = require("@keep-network/tbtc/artifacts/Deposit.json");
const TBTCSystemJSON = require("@keep-network/tbtc/artifacts/TBTCSystem.json");
const Pino = require("pino");

//internal files
const config = require('./config.json');
const {getGasPrice} = require('./gas-price.js');

const Logger = Pino({
    level: config.logLevel || 'info',
    prettyPrint: {
        colorize: true,
        ignore: "pid,hostname",
        levelFirst: true,
        suppressFlushSyncWarning: true,
        translateTime: "yyyy-mm-dd HH:MM:ss.l"
    }
});

// Web3 related constants
const web3 = new Web3(new Web3.providers.WebsocketProvider(`wss://${config.network}.infura.io/ws/v3/${config.infura}`));
const TBTCSystemAddress = config.TBTCAddress;
const TBTCSystemContract = new web3.eth.Contract(TBTCSystemJSON.abi, TBTCSystemAddress);

// Integer constants
const COURTESY_TIMEOUT = config.courtesyTimeout * 1000
const SIGNATURE_TIMEOUT = config.signatureTimeout * 1000;
const PROOF_TIMEOUT = config.proofTimeout * 1000;
const DEFAULT_GAS_PRICE = config.DEFAULT_GAS_PRICE;


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
        const account = await web3.eth.accounts.privateKeyToAccount(process.env.TBTC_PKEY);
        await web3.eth.accounts.wallet.add(account);
        web3.eth.defaultAccount = account.address;
	Logger.info("Starting hitchhike.js ...");
        processPastCourtesies();
        processPastSignatures();
        processPastProofs();
        // Handles the latest courtesyCalls
        TBTCSystemContract.events.CourtesyCalled(function(error, result){
                if (error) {
                        Logger.error(error);
                } else {
                        var depositAddress = depositEvent.returnValues._depositContractAddress;
                        Logger.info(`Courtesy call on ${depositAddress}`);
                        callCourtesyTimeout(depositAddress, result.blockNumber);
                }
	});
        TBTCSystemContract.events.RedemptionRequested(function(error, result){
                if (error) {
                        Logger.error(error);
                } else {
                        var depositAddress = depositEvent.returnValues._depositContractAddress;
                        Logger.info(`RedemptionRequested on ${depositAddress}`);
                        callSignatureTimeout(depositAddress, result.blockNumber);
                }
	});
        TBTCSystemContract.events.GotRedemptionSignature(function(error, result){
                if (error) {
                        Logger.error(error);
                } else {
                        var depositAddress = depositEvent.returnValues._depositContractAddress;
                        Logger.info(`GotRedemptionSignature on ${depositAddress}`);
                        callProofTimeout(depositAddress, result.blockNumber);
                }
	});
}


/**
 * processPastCourtesies
 *
 * Processes past courtesy calls.
 * Handles them as if they were current.
 * @return {}
 */
async function processPastCourtesies() {
	Logger.info("Processing past courtesy calls...");
        //Retrieves the "past" courtesy calls (before the latest block)
        var depositCourtesyCalled = await TBTCSystemContract.getPastEvents("CourtesyCalled", {
                fromBlock:config.deploymentBlock
        }, (error, result) => {
                if (error) {
                        Logger.error("Couldn't get previously courtesy called deposits.");
                }
        });

        // We treat every "past" courtesyCall as if they are current
        depositCourtesyCalled.map(function(e) {
                var depositAddress = e.returnValues._depositContractAddress;
                Logger.info(`Courtesy call on ${depositAddress}`);
                callCourtesyTimeout(depositAddress, e.blockNumber);
        });
}


/**
 * processPastSignatures
 *
 * Processes past RedemptionRequested.
 * Handles them as if they were current.
 * @return {}
 */
async function processPastSignatures() {
	Logger.info("Processing past signatures...");
        var depositSignaturesRequested = await TBTCSystemContract.getPastEvents("RedemptionRequested", {
                fromBlock:config.deploymentBlock
        }, (error, result) => {
                if (error) {
                        Logger.error("Couldn't get previously Deposits with a redemption request.");
                }
        });

        // We treat every "past" courtesyCall as if they are current
        depositSignaturesRequested.map(function(e) {
                var depositAddress = e.returnValues._depositContractAddress;
                Logger.info(`RedemptionRequested on ${depositAddress}`);
                callSignatureTimeout(depositAddress, e.blockNumber);
        });
}

/**
 * processPastProofs
 *
 * Processes past GotRedemptionSignature.
 * Handles them as if they were current.
 * @return {}
 */
async function processPastProofs() {
	Logger.info("Processing past proofs...");
        var depositProofRequested = await TBTCSystemContract.getPastEvents("GotRedemptionSignature", {
                fromBlock:config.deploymentBlock
        }, (error, result) => {
                if (error) {
                        Logger.error("Couldn't get previously Deposits awaiting a redemption proof.");
                }
        });

        // We treat every "past" courtesyCall as if they are current
        depositProofRequested.map(function(e) {
                var depositAddress = e.returnValues._depositContractAddress;
                Logger.info(`GotRedemptionSignature on ${depositAddress}`);
                callProofTimeout(depositAddress, e.blockNumber);
        });
}



/**
 * getDelay - Compute the delay before we can all notifyCourtesyTimeout
 *
 * @param  {integer} blockNumber        number of the block of emitted event
 * @param  {integer} defaultDuration    delay of the appropriate event in ms
 * @return {integer}                    duration of sleep
 */
async function getDelay(blockNumber, defaultDuration) {
        var delay = defaultDuration;
        try {
                const now = Math.floor(Date.now());
                const block = await web3.eth.getBlock(blockNumber);
                const expiration = block.timestamp*1000 + defaultDuration;
                delay = expiration - now;
        } catch (error) {
                Logger.error("Error when fetching block's timestamp.");
        }
        return delay;
}

/**
 * callCourtesyTimeout - Calls the courtesyTimeout function of the Deposit
 *                       liquidating the funds
 *
 * @param  {string} depositAddress address of the deposit to watch
 * @return {}
 */
async function callCourtesyTimeout(depositAddress, blockNumber) {
        var delay = await getDelay(blockNumber, COURTESY_TIMEOUT);
        //Sleeps for the entire duration of the delay, before we can liquidate
        await sleep(delay);
        const price = await getGasPrice();
        var deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
        //Verifies the Deposit contract is in the right state
        deposit.methods.getCurrentState().call((error, result) => {
                if (error) {
                        Logger.error(`Cannot get the state of Deposit ${depositAddress}.\nAborting liquidation.`)
                        return;
                } else {
                        if (result != 8) {
                                Logger.info(`Deposit ${depositAddress} isn't in a courtest call state.\nAborting liquidation.`)
                                return;
                        }
                }
        });
        //if in the courtesy call state, we liquidate it
        deposit.methods.notifyCourtesyTimeout().send({
                from:web3.eth.defaultAccount,
                gasPrice:price,
                gas:400000})
        .on('receipt', function(receipt) {
                Logger.info(`notifyCourtesyTimeout on Deposit ${depositAddress} was successfull.`)
        }).on('error', function(error, receipt) {
                Logger.error(error.message);
                Logger.error(`notifyCourtesyTimeout on Deposit ${depositAddress} failed.`)
        });

}

async function callSignatureTimeout(depositAddress, blockNumber) {
        var delay = await getDelay(blockNumber, SIGNATURE_TIMEOUT);
        //Sleeps for the entire duration of the delay, before we can liquidate
        await sleep(delay);
        const price = await getGasPrice();
        var deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
        //Verifies the Deposit contract is in the right state
        deposit.methods.getCurrentState().call((error, result) => {
                if (error) {
                        Logger.error(`Cannot get the state of Deposit ${depositAddress}.\nAborting liquidation.`)
                        return;
                } else {
                        if (result != 5) {
                                Logger.info(`Deposit ${depositAddress} isn't awaiting for a redemption signature.\nAborting liquidation.`)
                                return;
                        }
                }
        });
        deposit.methods.notifySignatureTimeout().send({
                from:web3.eth.defaultAccount,
                gasPrice:price,
                gas:400000})
        .on('receipt', function(receipt) {
                Logger.info(`notifySignatureTimeout on Deposit ${depositAddress} was successfull.`)
        }).on('error', function(error, receipt) {
                Logger.error(error.message);
                Logger.error(`notifySignatureTimeout on Deposit ${depositAddress} failed.`)
        });
}

async function callProofTimeout(depositAddress, blockNumber) {
        var delay = await getDelay(blockNumber, PROOF_TIMEOUT);
        //Sleeps for the entire duration of the delay, before we can liquidate
        await sleep(delay);
        const price = await getGasPrice();
        var deposit = new web3.eth.Contract(DepositJSON.abi, depositAddress);
        //Verifies the Deposit contract is in the right state
        deposit.methods.getCurrentState().call((error, result) => {
                if (error) {
                        Logger.error(`Cannot get the state of Deposit ${depositAddress}.\nAborting liquidation.`)
                        return;
                } else {
                        if (result != 6) {
                                Logger.info(`Deposit ${depositAddress} isn't awaiting for a signature proof.\nAborting liquidation.`)
                                return;
                        }
                }
        });
        deposit.methods.notifyRedemptionProofTimeout().send({
                from:web3.eth.defaultAccount,
                gasPrice:price,
                gas:400000})
        .on('receipt', function(receipt) {
                Logger.info(`notifyRedemptionProofTimeout on Deposit ${depositAddress} was successfull.`)
        }).on('error', function(error, receipt) {
                Logger.error(error.message);
                Logger.error(`notifyRedemptionProofTimeout on Deposit ${depositAddress} failed.`)
        });
}

main();
