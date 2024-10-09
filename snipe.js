const fs = require('fs'); 
const {
  ComputeBudgetProgram,
  Keypair,
  Connection,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  MessageV0,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  SystemProgram,
} = require('@solana/web3.js');

const {
  getOrCreateAssociatedTokenAccount,
  createInitializeAccountInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE, // Import ACCOUNT_SIZE constant
} = require('@solana/spl-token');

const {
  Liquidity,
  LiquidityPoolKeys,
  jsonInfo2PoolKeys,
  LiquidityPoolJsonInfo,
  TokenAccount,
  Token,
  TokenAmount,
  /*TOKEN_PROGRAM_ID,*/
  Percent,
  SPL_ACCOUNT_LAYOUT,
  MAINNET_PROGRAM_ID,
  LIQUIDITY_STATE_LAYOUT_V4,
  MARKET_STATE_LAYOUT_V3,
  Market,
} = require('@raydium-io/raydium-sdk');

const JSONStream = require('JSONStream'); 
const express = require('express');
const { json } = require('body-parser');
const axios = require('axios');
const bs58 = require('bs58').default;
require('dotenv').config(); // Load environment variables
const BN = require('bn.js'); // BigNumber library for handling large integers

const PORT = process.env.PORT || 3000;
const JITO_ENDPOINT = "ntp.dallas.jito.wtf";
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY; // Base58 encoded
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
if (!PRIVATE_KEY) {
  throw new Error('PRIVATE_KEY is not set in environment variables');
}

const secretKey = bs58.decode(PRIVATE_KEY);
const wallet = Keypair.fromSecretKey(secretKey);
const connection = new Connection(RPC_URL, 'confirmed');
const RAYDIUM_AMM_PROGRAM_ID = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
const LIQUIDITY_PROGRAM_ID_V4 = new PublicKey('5quB2RnXqpVpDwFETegxYGrvp3pCHNRtT5Rt6r5wNKS');
const RAYDIUM_SWAP_PROGRAM = '5quB2RnXqpVpDwFETegxYGrvp3pCHNRtT5Rt6r5wNKS';
let tokenBought = false;

async function getTokenMetadata(mintAddress) {
  const heliusUrl = `https://api.helius.xyz/v0/tokens/metadata?api-key=${process.env.HELIUS_API_KEY}`;  // API URL with your Helius API key

  try {
    // Prepare the request payload
    const data = {
      mintAccounts: [mintAddress]
    };

    // Make the API call to Helius
    const response = await axios.post(heliusUrl, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    // Check if the response contains data
    if (response.data && response.data.length > 0) {
      console.log("token data", response.data);
      console.log("Onchain data", response.data[0].onChainData);
      return response.data[0]; // Return the metadata for the token
    } else {
      console.error('No metadata found for the given mint address.');
      return {};
    }

  } catch (error) {
    console.error('Error fetching token metadata from Helius API:', error.message);
    return {}; // Return empty object on failure
  }
}

async function getOwnerTokenAccounts() {
  const walletTokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    programId: TOKEN_PROGRAM_ID,
  });

  return walletTokenAccounts.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
}

async function mainMenu() {
  const { select, input, Separator } = await import('@inquirer/prompts');
  
  const answer = await select({
    message: 'Main Menu',
    choices: [
      new Separator(),
      {
        name: 'Buy Token',
        value: 'buy_token',
        description: 'Buy a token from Raydium or Pump Fun',
      },
      {
        name: 'Sell Token',
        value: 'sell_token',
        description: 'Sell a token from Raydium or Pump Fun',
      },
      {
        name: 'Start Sniper',
        value: 'start_sniper',
        description: 'Start Pumping!',
      },
      {
        name: 'Get Token Metadata',
        value: 'token_metadata',
        description: 'Get token information',
      },
      {
        name: 'Exit',
        value: 'exit'
      },
      new Separator(),
    ],
  });

  if (answer === 'buy_token') {

    // Ask the user for the token address
    const tokenMint = await input({
      message: 'Please enter the token address (mint):',
      validate(value) {
        const valid = value.length === 44 || value.length === 43;
        return valid || 'Please enter a valid Solana token address.';
      }
    });

    const mintAddress = new PublicKey(tokenMint);
    const tokenMetadata = await getTokenMetadata(tokenMint);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mintAddress,
      wallet.publicKey
    );
    
    // Retrieve and display token info
    if (tokenAccount && tokenMetadata && mintAddress) {
      console.log(`Token Name: ${tokenMetadata.onChainData.data.name}`);
      console.log(`Symbol: ${tokenMetadata.onChainData.data.symbol}`);
      console.log(`Is Frozen: `, tokenAccount.isFrozen);
      console.log(`Mint Address: ${mintAddress.toBase58()}`);
    } else {
      console.error('Could not fetch token data.');
      await mainMenu(); // Return to menu if no metadata found
      return;
    }

    // Ask for the amount of SOL to spend for the token
    const transferAmount = await input({
      message: 'Please enter the amount of SOL to spend on the token:',
      validate(value) {
        const valid = !isNaN(value) && parseFloat(value) > 0;
        return valid || 'Please enter a valid amount of SOL.';
      }
    });

    // Initiate the swap (buy)
    await mainMenu(); // Re-run menu after buyin

  } else if (answer === 'sell_token') {
    // Ask the user for the token address
    const tokenMint = await input({
      message: 'Please enter the token address (mint):',
      validate(value) {
        const valid = value.length === 44 || value.length === 43;
        return valid || 'Please enter a valid Solana token address.';
      }
    });

    // Retrieve and display token info
    const tokenMetadata = await getTokenMetadata(tokenMint);
    const mintAddress = new PublicKey(tokenMint);
    const tokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet,
      mintAddress,
      wallet.publicKey
    );
  
    if (tokenMetadata && tokenAccount && mintAddress) {
      console.log(`Token Name: ${tokenMetadata.onChainData.data.name}`);
      console.log(`Symbol: ${tokenMetadata.onChainData.data.symbol}`);
      console.log(`Is Frozen: `, tokenAccount.isFrozen);
      console.log(`Mint Address: ${mintAddress.toBase58()}`);
    } else {
      console.error('Could not fetch token data.');
      await mainMenu(); // Return to menu if no metadata found
      return;
    }

    // Ask for the amount of tokens to sell
    const transferAmount = await input({
      message: 'Please enter the number of tokens to sell:',
      validate(value) {
        const valid = !isNaN(value) && parseFloat(value) > 0;
        return valid || 'Please enter a valid number of tokens.';
      }
    });

    // Initiate the swap (sell)
    await mainMenu(); // Re-run menu after selling

  } else if (answer === 'start_sniper') {
    await startSniper(); // Start the sniper process

  } else if (answer === 'token_metadata') {
    const tokenMint = await input({
      message: 'Please enter the token address (mint) to fetch metadata:',
      validate(value) {
        const valid = value.length === 44 || value.length === 43;
        return valid || 'Please enter a valid Solana token address.';
      }
    });

    const metadata = await getTokenMetadata(tokenMint);
    console.log(metadata);

    await mainMenu(); // Re-run menu after metadata fetch

  } else if (answer === 'exit') {
    console.log('Exiting...');
    process.exit(0);
  }
}

function isValidPublicKeyData(data) {
  return data instanceof PublicKey && data.toBase58() !== '11111111111111111111111111111111';
}

async function calcAmountOut(poolKeys, rawAmountIn, slippage = 1, swapInDirection = true) {
  const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });

  let currencyInMint = poolKeys.baseMint;
  let currencyInDecimals = poolInfo.baseDecimals;
  let currencyOutMint = poolKeys.quoteMint;
  let currencyOutDecimals = poolInfo.quoteDecimals;

  if (!swapInDirection) {
    currencyInMint = poolKeys.quoteMint;
    currencyInDecimals = poolInfo.quoteDecimals;
    currencyOutMint = poolKeys.baseMint;
    currencyOutDecimals = poolInfo.baseDecimals;
  }

  const currencyIn = new Token(TOKEN_PROGRAM_ID, currencyInMint, currencyInDecimals);
  const amountIn = new TokenAmount(currencyIn, rawAmountIn.toFixed(currencyInDecimals), false);
  const currencyOut = new Token(TOKEN_PROGRAM_ID, currencyOutMint, currencyOutDecimals);
  const slippagePercent = new Percent(slippage, 100); // e.g., 1% slippage

  const { amountOut, minAmountOut } = Liquidity.computeAmountOut({
    poolKeys,
    poolInfo,
    amountIn,
    currencyOut,
    slippage: slippagePercent,
  });

  return {
    amountIn,
    amountOut,
    minAmountOut,
  };
}

async function sendBundleToJito(transactions) {
  try {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [transactions]
    };

    const response = await axios.post(JITO_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log('Bundle submitted to Jito: ', response.data);
  } catch (error) {
    console.error('Error submitting bundle to Jito: ', error.message);
  }
}

function addTipInstruction(transaction) {
  const tipAccount = new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'); // Random tip account
  const tipAmountLamports = 1000; // Minimum required tip (adjust as needed)

  const tipInstruction = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: tipAccount,
    lamports: tipAmountLamports,
  });

  transaction.add(tipInstruction);
}

async function startSniper() {
  try {

    console.log("");
    const app = express();
    app.use(json());

    app.listen(PORT, async () => {
      console.log(`Firing up on port ${PORT}...`);
    });

    app.post('/', async (req, res) => {  
      console.log("TESTER TESTING");
      res.status(200).send('Received');
    });

    app.post('/ray', async (req, res) => {
      try {

        console.log("Webhook received");
        const data = req.body[0];
    
        if (data.source === 'RAYDIUM') {
          console.log('RAYDIUM LIQUIDITY POOL CREATED');

          const tokenTransfers = data.tokenTransfers;
          const accountData = data.accountData;
          let newTokenMint = tokenTransfers[0]?.mint;
    
          // Adjust for SOL being the first token
          if (newTokenMint === "So11111111111111111111111111111111111111112") {
            newTokenMint = tokenTransfers[1]?.mint;
          }
    
          const targetBalanceChange = 6124800;
          const poolID = accountData.find(
            (item) => item.nativeBalanceChange === targetBalanceChange
          )?.account;
    
          if (!poolID) {
            console.error('poolID is undefined.');
            res.status(500).send('Error');
            return;
          }

          console.log("Pool ID:", poolID);
          console.log("New Token Mint:", newTokenMint);
    
          const tokenKey = new PublicKey(newTokenMint);
          const poolPubKey = new PublicKey(poolID);
          const poolAccountInfo = await connection.getAccountInfo(poolPubKey);
          const poolData = LIQUIDITY_STATE_LAYOUT_V4.decode(poolAccountInfo.data);
          const marketAccount = await connection.getAccountInfo(poolData.marketId);
          const marketProgramId = marketAccount.owner;
          const marketState = MARKET_STATE_LAYOUT_V3.decode(marketAccount.data);

          if (poolData && marketState) {

            console.log("Getting market authority...");
            const marketAuthority1 = PublicKey.createProgramAddressSync(
              [
                marketState.ownAddress.toBuffer(),
                marketState.vaultSignerNonce.toArrayLike(Buffer, "le", 8),
              ],
              MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
            );
            
            console.log("Getting associated authority...");

            const authority = Liquidity.getAssociatedAuthority({
              programId: new PublicKey(RAYDIUM_AMM_PROGRAM_ID),
            }).publicKey;

            /*
            console.log("Getting market authority 2...");
            const marketAuthority2= Market.getAssociatedAuthority({
              programId: marketProgramId,
              marketId: marketState.ownAddress,
            }).publicKey;   
            */         

            console.log("Building pool keys...");    
            const poolKeys = {
              id: poolPubKey,
              baseMint: new PublicKey('So11111111111111111111111111111111111111112'),
              quoteMint: tokenKey,
              lpMint: poolData.lpMint,
              baseDecimals: Number.parseInt(poolData.baseDecimal.toString()),
              quoteDecimals: Number.parseInt(poolData.quoteDecimal.toString()),
              lpDecimals: Number.parseInt(poolData.baseDecimal.toString()),
              version: 4,
              programId: new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'),
              authority: authority,
              openOrders: poolData.openOrders,
              targetOrders: poolData.targetOrders,
              baseVault: poolData.baseVault,
              quoteVault: poolData.quoteVault,
              withdrawQueue: poolData.withdrawQueue,      
              lpVault: poolData.lpVault,
              marketVersion: 4,
              marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET,
              marketId: poolData.marketId, 
              marketAuthority: marketAuthority1,            
              marketBaseVault: marketState.baseVault,
              marketQuoteVault: marketState.quoteVault,
              marketBids: marketState.bids,
              marketAsks: marketState.asks,
              marketEventQueue: marketState.eventQueue,
              lookupTableAccount: PublicKey.default
            };

            console.log('Pool Keys RAW:', {
              id: poolID,
              baseMint: 'So11111111111111111111111111111111111111112',
              quoteMint: newTokenMint,
              lpMint: poolData.lpMint.toBase58(),
              baseDecimals: Number.parseInt(poolData.baseDecimal.toString()),
              quoteDecimals: Number.parseInt(poolData.quoteDecimal.toString()),
              lpDecimals: Number.parseInt(poolData.baseDecimal.toString()),
              version: 4,
              programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
              authority: authority.toBase58(),
              openOrders: poolData.openOrders.toBase58(),
              targetOrders: poolData.targetOrders.toBase58(),
              baseVault: poolData.baseVault.toBase58(),
              quoteVault: poolData.quoteVault.toBase58(),
              withdrawQueue: poolData.withdrawQueue.toBase58(),      
              lpVault: poolData.lpVault.toBase58(),
              marketVersion: 4,
              marketProgramId: MAINNET_PROGRAM_ID.OPENBOOK_MARKET.toBase58(),
              marketId: poolData.marketId.toBase58(), 
              marketAuthority: marketAuthority1.toBase58(),            
              marketBaseVault: marketState.baseVault.toBase58(),
              marketQuoteVault: marketState.quoteVault.toBase58(),
              marketBids: marketState.bids.toBase58(),
              marketAsks: marketState.asks.toBase58(),
              marketEventQueue: marketState.eventQueue.toBase58(),
              lookupTableAccount: PublicKey.default.toBase58()
            });
    
            if (!tokenBought && poolKeys) {

              const transferAmount = 0.01; // Amount of SOL to spend
              const swapInDirection = poolKeys.baseMint.equals(WSOL_MINT);
              const wrappedSolAccount = Keypair.generate();
              const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);
              const amountInLamports = transferAmount * LAMPORTS_PER_SOL;
              const lamportsForWSOL = amountInLamports + rentExemptLamports;
              const priorityMicroLamports = 5000; // Priority fee
              const decimals = 9; // SOL has 9 decimals
              
              const {
                amountIn,
                amountOut,
                minAmountOut,
              } = await calcAmountOut(poolKeys, transferAmount, 1, swapInDirection);

              // Create TokenAmount for amountIn
              const currencyIn = new Token(TOKEN_PROGRAM_ID, WSOL_MINT, decimals);
              
              console.log("Getting pool info with pool keys...");
              const poolInfo = await Liquidity.fetchInfo({ connection, poolKeys });
              
              
              console.log("Getting token ouput info...");
              const tokenOutMint = new PublicKey(newTokenMint);
              const mintInfo = await connection.getParsedAccountInfo(tokenOutMint);
            
    
              // Create priority fee instruction
              console.log("Computing priority fee")
              const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: priorityMicroLamports,
              });
    
              console.log("Building Pre-Instructions");
              const preInstructions = [
                priorityFeeInstruction, // Add priority fee instruction first
                SystemProgram.createAccount({
                  fromPubkey: wallet.publicKey,
                  newAccountPubkey: wrappedSolAccount.publicKey,
                  lamports: lamportsForWSOL,
                  space: ACCOUNT_SIZE,
                  programId: TOKEN_PROGRAM_ID,
                }),
                createInitializeAccountInstruction(wrappedSolAccount.publicKey, WSOL_MINT, wallet.publicKey),
              ];
    
              console.log("Building Post-Instructions");
              const postInstructions = [
                createCloseAccountInstruction(wrappedSolAccount.publicKey, wallet.publicKey, wallet.publicKey),
              ];
    
              console.log("Creating swap instruction");
              const userTokenAccounts = await getOwnerTokenAccounts();

              // Prepare the swap transaction
              console.log("Creating swap instruction");
              const swapTransaction = await Liquidity.makeSwapInstructionSimple({
                connection,
                poolKeys,
                userKeys: {
                  tokenAccounts: userTokenAccounts,
                  owner: wallet.publicKey,
                },
                amountIn: amountIn,
                amountOut: minAmountOut,
                fixedSide: 'in',
                config: {
                  bypassAssociatedCheck: false,
                },
                computeBudgetConfig: {
                  microLamports: priorityMicroLamports,
                },
              });
              
              // Extract the instructions from the swap transaction
              const instructions = swapTransaction.innerTransactions[0].instructions.filter(Boolean);
                              
              console.log("Combining instructions");
              const allInstructions = [...preInstructions, ...instructions, ...postInstructions];
              
              const { blockhash } = await connection.getLatestBlockhash('confirmed');
              
              const messageV0 = new TransactionMessage({
                payerKey: wallet.publicKey,
                recentBlockhash: blockhash,
                instructions: allInstructions,
              }).compileToV0Message();
              
              const transaction = new VersionedTransaction(messageV0);
              const signers = [wallet, wrappedSolAccount];
              transaction.sign(signers);
    
              const serializedTransaction = transaction.serialize();
              const base64EncodedTransaction = serializedTransaction.toString('base64');

              console.log("Sending transaction to Jito");
              await sendBundleToJito([base64EncodedTransaction]);
    
              // Set tokenBought to true after purchasing to prevent repeated buys
              tokenBought = true;

            }
    
          } else {
            console.error('poolAccountInfo is undefined.');
          }
        }
    
        res.status(200).send('Received');
      } catch (error) {
        console.error('Error processing /ray webhook:', error.message);
        res.status(500).send('Error');
      }
    });


    app.post('/pumpkins', async (req, res) => {
      try {

        let initialSol = 0;
        let initialTokens = 0;
        
        const data = req.body[0];
        const tokenMint = data.tokenTransfers[0].mint;

        console.log(data);
        console.log('PUMP FUN POOL CREATED');
        console.log('Token Mint: ', tokenMint);

        data.nativeTransfers.forEach((transfer) => {
          if (transfer.amount > initialSol) {
            initialSol = transfer.amount / LAMPORTS_PER_SOL;
          }
        });

        data.tokenTransfers.forEach((transfer) => {
          if (transfer.tokenAmount > initialTokens) {
            initialTokens = transfer.tokenAmount;
          }
        });

        console.log('Initial SOL Liquidity: ', initialSol);
        console.log('Initial Tokens Liquidity: ', initialTokens);

        res.status(200).send('Received');
        
      } catch (error) {
        console.error('Error processing /pumpkins webhook:', error.message);
        res.status(500).send('Error');
      }
    });

  } catch (error) {
    console.error('Error starting sniper:', error.message);
  }
}

(async () => {
  try {

    console.log(`\nUsing RPC URL:\n${RPC_URL}`);
    console.log(`\nPumping with: \n${PRIVATE_KEY}\n\n`);
    await mainMenu();

  } catch (error) {
    console.error('Error:', error.message);
  }
})();
