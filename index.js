const express = require("express");
const bodyParser = require("body-parser");
const {utils, keyStores, connect, Contract} = require("near-api-js");
const {generateSeedPhrase} = require('near-seed-phrase');

const config = require("./config.js");

const getContractForKeyPair = async (secretKey = null) => {
    if (!secretKey) {
        const keys = generateSeedPhrase();
        secretKey = keys.secretKey;
    }

    const nearKeyPair = utils.KeyPair.fromString(secretKey);

    const keyStore = new keyStores.InMemoryKeyStore();
    await keyStore.setKey(config.networkId, config.accountId, nearKeyPair);

    const near = await connect({
        deps: {
            keyStore,
        },
        nodeUrl: config.gateway,
        networkId: config.networkId
    });

    const account = await near.account(config.accountId);

    return new Contract(
        account,
        config.addressReadWrite,
        config.contractMethods
    );
};

const getResponseErrorObj = (message) => {
    return {
        code: 500,
        message: "ERROR",
        result: JSON.stringify(message, null, 4),
    }
}


const app = express();

app.use(bodyParser.json());

app.post("/signTerms", async (req, res) => {
    const {action, params} = req.body;

    if (action !== "signTerms") {
        return res.json(getResponseErrorObj("Invalid action!"));
    } else if (!params) {
        return res.json(getResponseErrorObj("Missing params!"));
    }

    const {tosHash, pubKey, signature} = params;

    if (!tosHash || !pubKey || !signature) {
        return res.json(getResponseErrorObj("Missing params!"));
    }

    let responseObj = {
        code: 200,
        message: "success",
        action,
        params: {
            tosHash,
            pubKey,
            signature
        },
        result: {
            txReceipt: undefined,
        },
    }

    try {
        let contract = await getContractForKeyPair(config.privateKey);

        const contractResponse = await contract.account.functionCall({
            contractId: config.addressReadWrite,
            methodName: action,
            args: {
                signer_string: pubKey,
                signer_signature_string: signature,
                terms_hash_string: tosHash,
            },
            gas: undefined,
        });

        let txHash = contractResponse.transaction.hash;

        responseObj.result.txReceipt = await contract.account.connection.provider.txStatus(txHash, contract.account.accountId);

        res.json(responseObj);
    } catch (error) {
        responseObj.code = 500;
        responseObj.message = "ERROR";
        responseObj.result = JSON.stringify(error, null, 4);

        res.json(responseObj);
    }
});

app.get("/verifySignature", async (req, res) => {
    const {pubKey, tosHash} = req.query;

    if (!pubKey || !tosHash) {
        return res.json(getResponseErrorObj("Missing params!"));
    }

    let responseObj = {
        code: 200,
        message: "success",
        action: "verifySignature",
        params: {
            pubKey,
            tosHash,
        },
        result: {
            signee: "0",
            signeeSignature: "0",
            trailHash: "0",
            timestamp: 0,
            isValid: false
        },
    }

    try {
        let contract = await getContractForKeyPair();

        const contractResponse = await contract.validateSignature({
            signer_string: pubKey,
            terms_hash_string: tosHash
        });

        responseObj.result.signee = contractResponse[0];
        responseObj.result.signeeSignature = contractResponse[1];
        responseObj.result.trailHash = contractResponse[2];
        responseObj.result.timestamp = contractResponse[3] / 1000 / 1000;//nanoseconds to milliseconds
        responseObj.result.isValid = responseObj.result.signee !== "0";

        res.json(responseObj);
    } catch (error) {
        responseObj.code = 500;
        responseObj.message = "ERROR";
        responseObj.result = JSON.stringify(error, null, 4);

        res.json(responseObj);
    }
});

app.listen(4001, () => {
    console.log("Gravity relayer running on port 4001");
});
