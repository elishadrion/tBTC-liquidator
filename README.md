# A tBTC liquidator bot

This is a bot to execute the different types of liquidation possible on tBTC.

What it does :

```
✅ Listens for courtesy calls and liquidate when timeout
✅ Listens for redemption requests awaiting a signature and liquidate when timeout
✅ Listens for expectation of redemption proofs and liquidate when timeout
✅ Liquidates when severely undercollateralized
```

What it doesn't do :
```
📌 Liquidate in case of ECDSA fraud (yet)
```

## Configuration

The configuration is quite rudimentary (for now). It's split between a json config file and one environment variable `TBTC_PKEY` which holds your private key.

Copy sample.config.json to config.json and make your edits there.

```javascript
{
        "infura": your infura access key,
        "network": ropsten or mainnet,
        "TBTCAddress": address of the tBTCSystem contract,
        "courtesyTimeout":21600, // 6 hours of delay before we can liquidate
        "signatureTimeout":7200, // 2 hours of delay
        "proofTimeout":21600, // 6 hours of delay
        "defaultGasPrice":20000000000,
        "deploymentBlock":10071347, //deployment block of the tBTCSystem contract
        "hunterNapTime":900 //Sleep time before checking all Deposits for severe undercollateralization
}
```


Copy .env.example to .env and add a private key. It should have the "0x" prefix.

## hitchhike.js

The script does exactly what its name sounds like. For all three following events, it passively waits for emission, processes it and wait for the corresponding delay to be over before calling the corresponding timeout function.
```
🥇 CourtesyCalled
🥈 RedemptionRequested
🥉 GotRedemptionSignature
```

## hunter.js

The script actively scans all Deposit contracts with an active or courtesy state and verify if they are severely undercollateralized, in such case it will attempt to liquidate it.
