const sdk = require('@defillama/sdk');
const http = require('../helper/http');
const BigNumber = require("bignumber.js");
const { unwrapUniswapLPs } = require("../helper/unwrapLPs");
const { getChainTransform } = require("../helper/portedTokens");
const getPairFactory = require('../helper/abis/getPair.json') 

const zeroAddress = '0x0000000000000000000000000000000000000000'
const BRIDGE_CONTROLLER = '0x0Dd4A86077dC53D5e4eAE6332CB3C5576Da51281';
const RESERVES = '0x78b939518f51b6da10afb3c3238Dd04014e00057';
const TOKEN = '0xC17c30e98541188614dF99239cABD40280810cA3';
const STAKE_HOLDING_API = 'https://app.everrise.com/bridge/api/v1/stats'
const EVEROWN_DAO_API = 'https://app.everrise.com/prod/api/v1/contracts/active'
const chainConfig = {
  ethereum: {
    chainId: '1',
    WCoin: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    lpFactory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    LPs: [
      {
        owner: "0x78ab99dae7302ea91e36962f4b23418a89d3a69d", // EverOwn DAO Locked LP
        pool: "0x7250f7e97a4338d2bd72abc4b010d7a8477dc1f9",
      }, // RISE-ETH
    ],
    reserveTokens: [
      "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
      TOKEN,
    ],
  },
  bsc: {
    chainId: '56',
    WCoin: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    lpFactory: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73',
    LPs: [
      {
        owner: "0x89dd305ffbd8e684c77758288c48cdf4f4abe0f4", // EverOwn DAO Locked LP
        pool: "0x10dA269F5808f934326D3Dd1E04B7E7Ca78bb804",
      }, // RISE-BNB
    ],
    reserveTokens: [
      "0x55d398326f99059fF775485246999027B3197955", // USDT
      "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
      "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
      TOKEN,
    ],
  },
  polygon: {
    chainId: '137',
    WCoin: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    lpFactory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32',
    LPs: [
      {
        owner: "0x7dd45e9be23219fd8ccfc584b652775aba62fdef", // EverOwn DAO Locked LP
        pool: "0xf3c62dbbfec92a2e73d676d62ebec06a6bc224e2",
      }, // RISE-MATIC
    ],
    reserveTokens: [
      "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC
      TOKEN,
    ],
  },
  avax: {
    chainId: '43114',
    WCoin: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
    lpFactory: '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10',
    LPs: [
      {
        owner: "0x22a8e3f957fcdd4883cfcbc67c5e14cf2bb6477d", // EverOwn DAO Locked LP
        pool: "0x5472e98d22b0fb7ec5c3e360788b8700419370b5",
      }, // RISE-AVAX
    ],
    reserveTokens: [
      "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", // USDT
      "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", // USDC
      TOKEN,
    ],
  },
  fantom: {
    chainId: '250',
    WCoin: '0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83',
    lpFactory: '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3',
    LPs: [
      {
        owner: "0x59503632ab8a093c266509c797c957e063f4d32b", // EverOwn DAO Locked LP
        pool: "0xde62a6cdd8d5a3988495317cffac9f3fed299383",
      }, // RISE-FTM
    ],
    reserveTokens: [
      "0x04068da6c83afcfa0e13ba15a6696662335d5b75", // USDC
      TOKEN,
    ],
  },
}

async function staking(timestamp, block, chainId, chain, token) {

  const stakedAmounts = await ((await fetch(STAKE_HOLDING_API)).json());

  let stakedAmount = 0;
  for (let i = 0, ul = stakedAmounts.length; i < ul; i++) {
    if (stakedAmounts[i].id === chainId) {
      stakedAmount = BigNumber(stakedAmounts[i].amount).multipliedBy(BigNumber(10).pow(18));
    }
  }

  return stakedAmount;
}

const chainExports = {}
let daoLockerClients = null

Object.keys(chainConfig).forEach(chain => {
  const chainData = chainConfig[chain]

  async function tvl(ts, _block, chainBlocks) {
    let balances = {}
    const block = chainBlocks[chain]
    const transformAddress = await getChainTransform(chain)

    const results = (await sdk.api.eth.getBalances({
      targets: [TOKEN, BRIDGE_CONTROLLER, RESERVES],
      chain, block
    }))

    for (const c of results.output)
      sdk.util.sumSingleBalance(balances, transformAddress(zeroAddress), c.balance)

    // Get reserve token balances
    let migrateBalances = (
      await sdk.api.abi.multiCall({
        calls: chainConfig[chain].reserveTokens.map((token) => ({
          target: token,
          params: RESERVES,
        })),
        abi: "erc20:balanceOf",
        block, chain,
      })
    ).output;

    migrateBalances.forEach((i) => {
      // Only include positive balances
      if (i.output > 0)
        balances[i.input.target] = i.output
    });

    await everOwnClients(balances, chain, block, transformAddress)

    return balances
  }

  async function everOwnClients(balances, chain, block, transformAddress) {
    daoLockerClients = daoLockerClients || await http.get(EVEROWN_DAO_API)
    
    let clients = daoLockerClients[chainData.chainId] || []
    // Don't include self as that's pool2
    clients = clients.filter(t => t.contractAddress.toLowerCase() !== TOKEN.toLowerCase())

    if (clients.length > 0) {
      const clientMapping = {}
      
      clients.forEach(client => {
        clientMapping[client.contractAddress.toLowerCase()] = client.everOwnLocker
      })

      const lPTokens = (
        await sdk.api.abi.multiCall({
          abi: getPairFactory,
          calls: clients.map((client) => ({
            target: chainData.lpFactory,
            params: [client.contractAddress, chainData.WCoin],
          })),
          chain: chain,
          block: block,
        })
      ).output

      let lpPositions = [];
      let lpBalances = (
        await sdk.api.abi.multiCall({
          calls: lPTokens.map((p) => ({
            target: p.output,
            params: clientMapping[p.input.params[0].toLowerCase()],
          })),
          abi: "erc20:balanceOf",
          block, chain,
        })
      ).output

      lpBalances.forEach((i) => {
        if (i.output > 0) {
          lpPositions.push({
            balance: i.output,
            token: i.input.target,
          });
        }
      })

      await unwrapUniswapLPs(balances, lpPositions, block, chain, transformAddress)
    }
  }

  async function pool2(ts, _block, chainBlocks) {
    let balances = {}
    const block = chainBlocks[chain]
    const transformAddress = await getChainTransform(chain)
    const { LPs } = chainConfig[chain]

    let lpPositions = [];
    let lpBalances = (
      await sdk.api.abi.multiCall({
        calls: LPs.map((p) => ({
          target: p.pool,
          params: p.owner,
        })),
        abi: "erc20:balanceOf",
        block, chain,
      })
    ).output;
    lpBalances.forEach((i) => {
      lpPositions.push({
        balance: i.output,
        token: i.input.target,
      });
    });
    await unwrapUniswapLPs(balances, lpPositions,  block, chain, transformAddress);
    return balances
  }

  async function staking() {
    const { chainId } = chainConfig[chain]
    const stakedAmounts = await http.get(STAKE_HOLDING_API)
    let stakedAmount = stakedAmounts.find(({ id }) => id === chainId)

    return {
      'everrise': stakedAmount ? stakedAmount.amount : 0
    }
  }

  chainExports[chain] = {
    tvl,
    pool2,
    staking,
  }
})

module.exports = {
  ...chainExports,
  timetravel: false,
  methodology: "TVL comes from the buyback reserves, other token migration vaults and cross-chain bridge vaults",
};