// Shared data: curated BSC tokens + known spenders.
// All addresses are public, well-known contract addresses on BSC (chain 56).
// No keys, no secrets, no user data in this file.

const TOKENS = [
  { symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 },
  { symbol: "USDT", name: "Tether USD", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
  { symbol: "BUSD", name: "Binance USD", address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18 },
  { symbol: "USDC", name: "USD Coin", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  { symbol: "CAKE", name: "PancakeSwap Token", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
  { symbol: "DAI", name: "Dai Stablecoin", address: "0x1AF3F329e8BE154074D8769D1aE23316A39c9d8E", decimals: 18 },
  { symbol: "ETH", name: "Ethereum (BSC-pegged)", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
  { symbol: "BTCB", name: "BTCB Token", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9", decimals: 18 },
];

// Known, reputable spenders on BSC. An allowance to one of these is normal
// (e.g. a DEX router needs it to swap for you) but an UNLIMITED allowance
// is still worth knowing about. Anything NOT on this list is "unknown".
const KNOWN_SPENDERS = [
  { name: "PancakeSwap V2 Router", address: "0x10ED43C718714eb63d5aA57B78B54704E256024E", kind: "DEX router" },
  { name: "PancakeSwap V3 Router", address: "0x13f4EA83D0bd40E75C8222255bcEa5CA2983aD", kind: "DEX router" },
  { name: "1inch Aggregation Router v5", address: "0x1111111254EEB25477B68fb85Ed929f73A960582", kind: "DEX aggregator" },
  { name: "OpenSea Seaport", address: "0x00000000006c3852cbEf3e08E8dF289169EdE5811", kind: "NFT marketplace" },
  { name: "PancakeSwap MasterChef", address: "0x73feaa1eE314F8c655E354234017bE2193C9E24E", kind: "CAKE staking / farming" },
  { name: "Permit2", address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", kind: "Token approval manager" },
];

const MAX_UINT256 = (1n << 256n) - 1n;

module.exports = { TOKENS, KNOWN_SPENDERS, MAX_UINT256 };
