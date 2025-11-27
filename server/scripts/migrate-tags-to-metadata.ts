/**
 * Migration Script: Populate tag_metadata table from TagsBrowser taxonomy definitions
 * 
 * This script extracts all tags from the frontend category definitions and inserts them
 * into the tag_metadata table with proper parent-child relationships (hierarchy).
 * 
 * Run with: npx tsx server/scripts/migrate-tags-to-metadata.ts
 */

import "dotenv/config";
import { db } from "../db";
import { tagMetadata } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// Define the taxonomy structure (extracted from TagsBrowser.tsx)
interface TagDefinition {
  key: string;
  name: string;
  tags?: string[];
  isParent?: boolean;
  children?: TagDefinition[];
}

interface MainCategory {
  key: string;
  name: string;
  displayName: string;
  subcategories: TagDefinition[];
}

// ============================================================================
// TAXONOMY DEFINITIONS (from TagsBrowser.tsx lines 209-1294)
// ============================================================================

const taxonomy: MainCategory[] = [
  {
    key: 'bitcoin',
    name: 'bitcoin',
    displayName: '🪙 Bitcoin',
    subcategories: [
      {
        key: '1.1',
        name: 'Bitcoin (BTC) - The Currency',
        tags: [
          'Bitcoin', 'BTC',
          'Genesis Block', 'Jan 3, 2009',
          'Bitcoin Whitepaper', 'Oct 31, 2008',
          'First Transaction', 'Pizza Day', 'Halvings', 'Halving Events',
          '25,000 BTC', '68,495 BTC', '30 mBTC', '0.01 BTC', 'digital money',
          '$60 billion', '100000', '2011',
          'HODL', '$7,000', '$7,450', '$8000', '$3,000', '24,000', '$2M', '$50 billion', '$139 billion', '$202 billion', '19 billion', '8 million', '27', '11', '14', '21', '0.99%', '£799bn', '$7,034.14', '1401'
        ]
      },
      {
        key: '1.2',
        name: 'Bitcoin Technology',
        isParent: true,
        children: [
          {
            key: '1.2.1',
            name: 'Core Implementations',
            tags: ['Bitcoin Core', 'Core', 'Bitcoin-Qt', 'Bitcoin Qt', 'Bitcoin Unlimited', 'BitcoinUnlimited', 'Bitcoin Classic', 'Bitcoin XT', 'btcd', 'Bcoin', 'Core v0.9.1', 'Bitcoin v0.3.8', 'v0.3.16', '0.8.0rc1', '0.8.0', '0.8.1', 'Bitcoin Core 0.20.0', 'v0.3.12', 'v0.3.11', '0.3.11', 'v0.3.0', 'v0.3.9', '0.3.6', 'Bitcoin v0.1.5', 'Bitcoin Core v0.12.1', '0.12.1', 'v0.12.0', 'v0.4.0', 'Bitcoin v0.3.4', '0.12.0', 'Core 0.10', 'v0.10.1', '0.10.1', 'v0.9.2', 'v1.1.0', 'btc1', 'BitcoinOS', 'Core V3', 'bitcoind', 'v2.15.3.0', 'v2.16.0.0', 'v0.11.2', '0.11.2', '0.2.6', 'v0.2.1', 'Geth', 'v0.4.1', 'v0.1.2', 'v0.3.1', 'v0.3.19', 'v0.3.21', 'v0.4.2', 'v1.1.1', '1.0.2', '1.2.4', 'full node', 'testnet', '0.13.0.knots20160814', 'checkpoint']
          },
          {
            key: '1.2.2',
            name: 'Major Upgrades',
            tags: ['SegWit', 'Segregated Witness', 'Taproot', 'SegWit2x', 'SegWit2x (Failed)']
          },
          {
            key: '1.2.3',
            name: 'Bitcoin Improvement Proposals (BIPs)',
            tags: [
              'BIP 148', 'BIP 148 (UASF)', 'BIP 91', 'BIP 141',
              'BIP 340', 'BIP340', 'BIP 341', 'BIP 342', 'BIP342', 'BIP 340-342', 'Taproot/Schnorr',
              'BIP 34', 'BIP 37', 'BIP-37', 'BIP 62', 'BIP 65', 'BIP65', 'BIP 100', 'BIP 101', 'BIP101', 'BIP 109', 'BIP109', 'BIP 119', 'BIP 174', 'BIP174',
              'BIP 341', 'BIP341',
              'BIP9', 'BIP 9', 'BIP8', 'BIP 8',
              'UASF', 'BIP148', 'BIP91', 'BIP141',
              'BUIP017', 'BUIP027',
              'BIP'
            ]
          },
          {
            key: '1.2.4',
            name: 'Transaction Features',
            tags: [
              'Schnorr Signatures', 'Schnorr', 'Schnorr digital signature scheme', 'Multisig', 'multi-signature',
              'Timelocks', 'CHECKLOCKTIMEVERIFY', 'CHECKSEQUENCEVERIFY',
              'Address Types', 'P2SH', 'Bech32', 'bech32m',
              'IsCanonicalScript', 'OP_EVAL', 'BRC20', 'BRC-20', 'Runes', 'Ordinals', 'Ordinal',
              'mempool limits', 'Dandelion',
              'Merkle tree', 'Merkle trees', 'P2P', 'P2P protocol',
              'Bitcoin network', 'sidechains', 'sidechain', 'hard fork', 'hard forks', 'libsecp256k1',
              'transaction malleability', 'atomic swap', 'Atomic Swaps', 'SigChecks',
              'SIGHASH_ALL', 'Chain split',
              'websocket', 'cbBTC',
              'batching',
              'P2P messaging', 'Swaps', 'opcodes', 'SigOps', 'wallets',
              'payjoin', 'coinjoin', 'CoinSwap', 'CashTokens',
              'OP_VAULT', 'OP_UNVAULT', 'OP_CAT'
            ]
          },
          {
            key: '1.2.5',
            name: 'Layer 2 & Scaling',
            tags: [
              'Lightning Network', 'Lightning', 'Lightning Labs',
              'Core Lightning', 'c-lightning', 'LND', 'lnd v0.2-alpha', 'ACINQ',
              'Liquid Sidechain', 'Liquid',
              'Rootstock', 'RSK',
              'Stacks', 'Utreexo', 'AI-enabled Layer-2', 'Base', 'Arbitrum', 'L2', 'Citrea',
              'Knots',
              'BitVM', 'BitMesh', 'btcmsg', 'Voltage',
              'Sidechain Elements', 'DLC', 'DLC.Link'
            ]
          },
          {
            key: '1.2.6',
            name: 'Mining & Consensus',
            tags: [
              'Proof of Work', 'PoW',
              'Halving Events', 'Halving', 'Halvings', 'halving event', 'Bitcoin Halving',
              'Difficulty Adjustment', 'Difficulty Adjustment Algorithm',
              'Difficulty Bomb',
              'ASIC Mining', 'ASIC', 'ASICs', 'ASIC miners', 'Antminers', 'GPU Mining', 'GPUs', 'FPGA', 'BTCFPGA',
              'multi-algorithm mining',
              'SHA-256', 'SHA256', 'Hashcash',
              'AsicBoost', 'BetterHash',
              '2MB block size', '2MB', '1MB block size limit', '1MB', '2 megabytes', '8MB', '20MB', '27 MB', '32 MB',
              'Equihash-BTG', 'miners',
              'Avalon V1', '28nm ASIC mining chips', 'Spondoolies-Tech', '66 GH/s',
              'multi-coin mining pool',
              'GPU', 'CPU', 'AMD', 'MinePeon', 'Halong Mining'
            ]
          }
        ]
      },
      {
        key: '1.3',
        name: 'Bitcoin Forks',
        tags: [
          'Bitcoin Cash', 'BCH', 'Bitcoin SV', 'BSV', 'Bitcoin Gold', 'BTG',
          'Bitcoin XT', 'Bitcoin Private', 'Bitcoin Diamond', 'Bitcoin Atom',
          'Bitcoin Vault', 'Bitcoin ABC', 'ABC', 'BCHABC', 'Namecoin', 'BCHN', 'eCash', 'Counterparty', 'BTU',
          'UST', 'BTCP'
        ]
      },
      {
        key: '1.4',
        name: 'Bitcoin Companies & Services',
        tags: [
          'AWS', '3iQ', 'bitp0p', 'Bitvestment LLC', 'Avocado Diva', 'NHS', 'CoinMKT', 'PwC',
          'Bit2Me', 'Vipps', 'PayByCoin', 'Vibanko.com', 'Financial Times', 'DeepBit.net',
          'EBank', 'Dashwhale', 'Needham & Co.', 'Bonafide', 'Fulfillment by Amazon',
          'Biteasy', 'E-Gold', 'ENS', 'CoinFest 2016', 'Cosmos Hub', 'FISA', 'Finance Committee', 'David Seaman'
        ]
      }
    ]
  },
  {
    key: 'money-economics',
    name: 'money-economics',
    displayName: '💰 Money & Economics',
    subcategories: [
      {
        key: '2.1',
        name: 'Other Cryptocurrencies',
        tags: [
          'Ethereum', 'ETH', 'Ethereum Classic', 'ETC', 'Litecoin', 'LTC', 'Dogecoin', 'DOGE',
          'Cardano', 'ADA', 'Solana', 'SOL', 'Polkadot', 'DOT', 'XRP', 'Ripple', 'Stellar', 'XLM',
          'Dash', 'Monero', 'XMR', 'Zcash', 'ZEC', 'Tezos', 'XTZ', 'Cosmos', 'Algorand', 'NEAR', 'NEAR Protocol',
          'Avalanche', 'VeChain', 'VET', 'Hedera', 'HBAR', 'IOTA', 'Filecoin', 'FIL', 'The Graph', 'GRT',
          'Tron', 'TRX', 'EOS', 'ZetaChain', 'Elrond', 'ETNs', 'COTI', 'Coinye', 'Vertcoin', 'EMC2',
          'ETFs', 'ETF', 'Exchange-Traded Funds', 'Bitcoin ETF', 'Bitcoin ETFs', 'spot Bitcoin ETF', 'Purpose Bitcoin ETF', 'ProShares Bitcoin Strategy ETF', 'GBTC', 'Grayscale Bitcoin Trust', 'IBIT', 'ETP', 'Exchange-Traded Products',
          'Emercoin', 'SolidCoin', 'XEM', 'frxETH', 'Kin', 'JTO', 'MNDE', 'Shelley',
          'Kusama', 'DigiByte', 'altcoins', 'Altcoin', 'Binance Coin', 'BNB',
          'Polygon', 'POL', 'Syscoin', 'XEC', '50 LTC', 'AltSeason',
          'LEO', 'LOOKS', 'PawnCoin', 'BALD', 'Ethos', 'GBL', 'Ezbl', 'HT', 'Huobi Token', 'betacoin',
          'NEM', 'Steem', 'Waves', 'CosbyCoin', 'NovaCoins', 'ZCL',
          'Qtum', 'DEMO Token', 'WCT', '888', 'PLC Ultima', 'PIBS',
          'FET', 'ByteCoin', 'HBTC', '$ME', 'emCash',
          'E-coin', 'Einsteinium', 'EOSIO', 'Zclassic', 'Plutons', 'NEO',
          'BNB Chain', 'WBTC', 'BITO', 'Winklevoss ETF',
          'coins', 'tokens', 'new tokens', 'token definitions', 'volatility', 'Digital Shekel',
          'Komodo', 'KMD', 'MATIC', 'digital assets', 'ETH/USD', 'Diamond Hands',
          'Obyte', 'GBYTE', 'Viction', 'Viacoin', 'BlackCoin', 'Goat Coin', 'DigitalBTC', 'MintChip'
        ]
      },
      {
        key: '2.2',
        name: 'Stablecoins',
        tags: ['USDT', 'Tether', 'USDC', 'DAI', 'GUSD', 'TUSD', 'Pax Dollar', 'USDP', 'stablecoins', 'stablecoin', 'global stablecoins', 'Stably USD', 'RAI', 'Libra', 'USDS', 'GHO', 'Realcoin', 'HUSD', 'JPM Coin', 'MUFG coin']
      },
      {
        key: '2.3',
        name: 'DeFi Tokens',
        tags: ['Uniswap', 'UNI', 'AAVE', 'Aave V3', 'MakerDAO', 'Maker DAO', 'MKR', 'YFI', 'SUSHI', 'CRV', 'Chainlink', 'LINK', 'Synthetix', 'Balancer', 'BAL', 'COMP', 'Compound V3', 'ethDYDX', 'stETH']
      },
      {
        key: '2.4',
        name: 'Metaverse & Gaming',
        tags: ['Decentraland', 'MANA', 'The Sandbox', 'SAND', 'Axie Infinity', 'AXS', 'Enjin', 'ENJ', 'Gala', 'Flow']
      },
      {
        key: '2.5',
        name: 'Fiat Currencies',
        tags: [
          'US Dollar', 'USD', 'U.S. dollar', 'dollar', 'US dollars', 'Euro', 'EUR', 'euros', 'British Pound', 'GBP', 'Japanese Yen', 'JPY', 'Yen',
          'Chinese Yuan', 'CNY', 'Yuan', 'Swiss Franc', 'CHF', 'Canadian Dollar', 'CAD', 'Australian Dollar', 'AUD',
          'Hong Kong Dollar', 'HKD', 'Singapore Dollar', 'SGD', 'Mexican Peso', 'MXN', 'Brazilian Real', 'BRL', 'reals',
          'Argentine Peso', 'ARS', 'Indian Rupee', 'INR', 'South Korean Won', 'KRW', 'Russian Ruble', 'RUB',
          'Turkish Lira', 'TRY', 'South African Rand', 'ZAR', 'Swedish Krona', 'SEK', 'Norwegian Krone', 'NOK',
          'Danish Krone', 'DKK', 'Polish Zloty', 'PLN', 'Czech Koruna', 'CZK', 'Hungarian Forint', 'HUF',
          'Romanian Leu', 'RON', 'Bulgarian Lev', 'BGN', 'Croatian Kuna', 'HRK', 'Taiwan Dollar', 'TWD',
          'Thai Baht', 'THB', 'Malaysian Ringgit', 'MYR', 'Indonesian Rupiah', 'IDR', 'Philippine Peso', 'PHP',
          'hryvnia', 'Ukrainian Hryvnia', 'UAH',
          'Vietnamese Dong', 'VND', 'Chilean Peso', 'CLP', 'Colombian Peso', 'COP', 'Peruvian Sol', 'PEN',
          'New Zealand Dollar', 'NZD',
          'fiat'
        ]
      },
      {
        key: '2.6',
        name: 'Commodities',
        tags: ['Gold', 'Silver', 'Platinum', 'Palladium', 'Copper', 'Bronze', 'Oil', 'gold-backed assets', 'climate fund', 'Inflation', 'volcano bonds']
      },
      {
        key: '2.7',
        name: 'Central Banks',
        tags: [
          'Federal Reserve', 'Fed', 'European Central Bank', 'ECB', "People's Bank of China", 'PBOC',
          'Bank of Japan', 'Bank of Canada', 'Reserve Bank of Australia',
          'Reserve Bank of India', 'RBI', 'Dutch Central Bank', 'DNB', "Banca d'Italia", 'Bankitalia',
          'Mint', 'US Mint', 'Bank of England'
        ]
      },
      {
        key: '2.8',
        name: 'Prices & Values',
        tags: ['$1330', '$902', '3 million wallets', '25 LTC', 'I Bonds', '125 million']
      }
    ]
  },
  {
    key: 'technology',
    name: 'technology',
    displayName: '⚡ Technology Concepts',
    subcategories: [
      {
        key: '3.1',
        name: 'Blockchain & Core Concepts',
        tags: [
          'Blockchain', 'blockchain technology', 'Distributed Ledger Technology', 'DLT',
          'Consensus Mechanisms', 'Proof of Work', 'Proof of Stake',
          'Smart Contracts', 'Smart Contract',
          'Mining', 'Nodes', 'Validators',
          'Hash Functions', 'Cryptography',
          'Public Key', 'Private Key', 'Public Key / Private Key', 'Digital Signatures',
          'Starknet', 'Graphene', 'mesh network', 'crypto', 'crypto assets',
          'Vasil',
          'Simplicity',
          'zkEVM', 'zkSync', 'Constantinople', 'on-chain data', 'AI mathematics', 'AI', 'PGP', 'Beacon Chain',
          'faucet', 'Ubiquity', 'Homestead', 'LHC', 'E3', 'E-Mode', 'BitHalo',
          'b-money', 'P2P technology', 'Web 3.0', 'Cloud management', 'ICP', 'EIP-', 'Goguen'
        ]
      },
      {
        key: '3.2',
        name: 'DeFi & Web3 Concepts',
        tags: [
          'DeFi', 'Decentralized Finance',
          'NFTs', 'NFT', 'Non-Fungible Tokens', 'CryptoPunks',
          'Decentralized Exchanges', 'DEX',
          'Staking', 'Yield Farming', 'Liquidity Pools',
          'AMM', 'Automated Market Maker',
          'The DAO', 'decentralized autonomous organization', 'DAO',
          'Dutch auction', 'StableSwap', 'Curve',
          'ICOs', 'ICO', 'Initial Coin Offerings',
          'Web3', 'Decentralized Applications', 'dApps',
          'DAOs', 'Decentralized Autonomous Organizations',
          'flash loans', 'flash swaps',
          'PoWswap',
          'token issuance',
          'DeFiChain', 'Community Points', 'MISO'
        ]
      },
      {
        key: '3.3',
        name: 'Security & Privacy',
        tags: [
          'Encryption', 'Cryptography', 'Chain Key cryptography',
          'Tor', 'Tor V3', 'VPN',
          'Privacy Technologies',
          'Quantum Computing',
          'zk-SNARK', 'zk-SNARKs', 'ring signatures',
          'Trojan', 'secure communications',
          'Security Best Practices', 'cryptosecurity',
          'Attack Vectors', '51% Attack', 'Double Spend', 'double-spend', 'double-spending', 'DDoS', 'DoS',
          'Phishing', 'Social Engineering', 'Tails', 'Antbleed', 'MITM'
        ]
      },
      {
        key: '3.4',
        name: 'Wallets & Storage',
        tags: [
          'Hardware Wallets', 'hardware wallet',
          'Hot Wallets', 'Cold Storage',
          'Multisig Wallets',
          'HD Wallets', 'Hierarchical Deterministic',
          'Seed Phrases', 'Private Keys',
          'Custody Solutions', 'Kryptokit', 'BitWallet', 'miniscript wallet', 'CoinWallet',
          'Argent', 'Samourai Wallet', 'Keystone', 'hot wallet',
          'Multibit', 'Coinkite', 'KeepKey', 'wallet.dat', 'Casa',
          'web-wallet', 'Eidoo', 'Nayuta', 'Dogewallet'
        ]
      },
      {
        key: '3.5',
        name: 'Technical Standards',
        tags: [
          'ERC-20', 'ERC-721',
          'BEP-2',
          'Web3 Standards',
          'P2P Networks',
          'IPv6', 'NFC', 'OpenSSL',
          'RPC', 'POS',
          'UPnP',
          'HTML5', 'QT', 'IoT', 'CIP',
          'Toshi API',
          'libleveldb.a',
          'CCIP', 'eASIC',
          'ATMs', 'ATM', 'MT5', 'AMQP', 'SHA1', 'Vim', 'Wi-Fi', 'Tumult Hype', 'Uzbl', 'IPC', 'macOS',
          'Go', 'Python', 'Gentoo', 'BYOD', 'JMPInline', '16NM'
        ]
      }
    ]
  },
  {
    key: 'organizations',
    name: 'organizations',
    displayName: '🏢 Organizations & Companies',
    subcategories: [
      {
        key: '4.1',
        name: 'Exchanges',
        isParent: true,
        children: [
          {
            key: '4.1.1',
            name: 'Major Centralized Exchanges',
            tags: [
              'Coinbase', 'Binance', 'Kraken', 'Bitfinex', 'Gemini',
              'Bitstamp', 'OKCoin', 'Huobi', 'KuCoin', 'Bithumb',
              'CEX.io', 'BTC-e', 'Crypto.com',
              'Bittrex', 'Poloniex', 'OKEx', 'OKX', 'Bybit',
              'BitMEX', 'Deribit', 'BitFlyer', 'Bitpanda',
              'Coincheck', 'Korbit', 'Upbit',
              'Gate.io', 'Gate', 'MEXC', 'WhiteBit', 'ProBit', 'Bitget',
              'Phemex', 'Bitrue', 'AscendEX', 'BitMart', 'LBank', 'itBit', 'BitX',
              'Coinmotion', 'Bitcoin Indonesia', 'CoinTrader.net',
              'Bakkt', 'Unocoin', 'Genesis', 'eToro', 'Cavirtex', 'Crypto Facilities',
              'LedgerX', 'EasyBit', 'TeraExchange', 'CoinLab', 'BTCChina', 'Swan Bitcoin',
              'Coinplug', 'Hodl Hodl', 'Binance US', 'Genesis Trading', 'Bitso', 'CoinX', 'Zaif', 'Cashila',
              'BW.com', 'Zebpay', 'Bitnomial', 'Bitbank', 'Binance.US', 'OKCoinBTC', 'Coinbit', 'Cobinhood', 'CoinDL', 'CoinSafe', 'CoinAd', 'Coinify',
              'Bitt', 'Bit4You', 'CCEDK', 'YouWin'
            ]
          },
          {
            key: '4.1.2',
            name: 'Decentralized Exchanges (DEX)',
            tags: ['Uniswap', 'SushiSwap', 'Curve Finance', 'ShapeShift', 'ShapeShift.io', 'CoinSwap', 'CoinSafe', 'CoinAd']
          },
          {
            key: '4.1.3',
            name: 'Defunct Exchanges',
            tags: ['Mt. Gox', 'Mt Gox', 'MtGox', 'FTX', 'QuadrigaCX', 'Bitcoinica', 'New Liberty Standard', 'BTER', 'Youbit', 'MyBitCoin', 'GLBSE BitCoin Market Watch', 'GLBSE', 'Igot', 'Btc.sx', 'TradeHill', 'BTCC', 'BTC China', 'Coinrail', 'CoinPip', 'Flexcoin', 'MyBitcoin.com', 'Coinsetter', 'Vaurum', 'MyCoin', 'Coinsecure', 'Bitsoko', 'Buttercoin', 'Bitcoin-24', 'Alpari', 'Moolah', 'BFX', 'BitoEx', 'Bitzlato', 'Inputs.io', 'Paymium', 'CHBTC', 'Cubits', 'Bitomat.pl', 'Bitomat', 'BTC-E.com', 'Coinzest', 'BitVC', 'Bitzon']
          }
        ]
      },
      {
        key: '4.2',
        name: 'Financial Institutions',
        isParent: true,
        children: [
          {
            key: '4.2.1',
            name: 'Investment Banks',
            tags: ['Goldman Sachs', 'JPMorgan', 'JPMorgan Chase', 'J.P. Morgan Chase', 'JP Morgan', 'Morgan Stanley', 'Bank of America', 'Citigroup', 'Citi', 'USAA', 'TD Ameritrade', 'Popular Inc', 'DTCC', 'Intercontinental Exchange', 'Mizuho Financial Group', 'RBS', 'Royal Bank of Scotland', 'Lloyds Banking Group', 'Bitwise Asset Management', 'DCG', 'Digital Currency Group', 'Freddie Mac', 'Fannie Mae', 'Index Ventures', 'Coinbase Ventures', 'Bitcoin Investment Trust', 'BitFury Capital', 'Tally Capital', 'Man Group', 'iFOREX', 'Coatue Management', "Moody's", 'Numis', 'financial firms', 'Investors', 'AIG', 'Castle Point Capital',
              'Polychain Capital', 'Boost VC', 'Sequoia China', 'Blackstone', 'a16z', 'Bain Capital', 'Atomico', 'Knight Capital', 'Capula']
          },
          {
            key: '4.2.2',
            name: 'Commercial Banks',
            tags: [
              'Wells Fargo', 'Barclays', 'Standard Chartered',
              'BNY Mellon', 'DBS Bank', 'Santander',
              'Silicon Valley Bank', 'Silvergate', 'Flushing Financial',
              'UBS', 'Deutsche Bank', 'Bank of Cyprus', 'U.S. Bancorp', 'HBOS', 'HSBC', 'FXCM', 'Evergrande', 'Falcon Bank',
              'CIBC', 'AIB', 'Allied Irish Bank', 'Citi Bank',
              'Icesave', 'SVB', 'Silicon Valley Bank', 'National Bank', 'Bank of Scotland', 'Bank of Jamaica', 'Mitsubishi UFJ Bank', 'Banco de Bogotá', 'Banco Azteca', 'Kabul Bank', 'Kaupthing', 'Bailed-out banks', 'SWIFT', 'SWIFT Institute',
              'MBNA', 'PNC Bank', 'MUFG Union Bank', 'bank', 'banking', 'EBA', 'Citibank'
            ]
          },
          {
            key: '4.2.3',
            name: 'Asset Managers',
            tags: [
              'BlackRock', 'Fidelity', 'Franklin Templeton',
              'Grayscale', 'Digital Currency Group',
              'Bitwise', 'CoinShares', 'Hashdex',
              'ProShares', 'VanEck', 'ARK Invest',
              'NYDIG', 'Pantera Capital', 'Vontobel', 'Jacobi Asset Management', 'Fidelity Digital Assets'
            ]
          },
          {
            key: '4.2.4',
            name: 'Stock Exchanges',
            tags: ['Nasdaq', 'CME Group', 'CME', 'NYSE', 'NYSE Euronext', 'Cboe', 'ICE', 'London Stock Exchange', 'Deutsche Boerse', 'Nasdaq-100', 'Dow Jones', 'Nasdaq Stockholm', 'S&P', 'S&P Dow Jones']
          }
        ]
      },
      {
        key: '4.3',
        name: 'Mining Operations',
        isParent: true,
        children: [
          {
            key: '4.3.1',
            name: 'Public Mining Companies',
            tags: [
              'Marathon Digital', 'CleanSpark', 'Core Scientific',
              'Riot Platforms', 'Riot', 'Bitfarms', 'Hut 8',
              'Argo Blockchain', 'Cipher Mining', 'TeraWulf',
              'Stronghold Digital', 'Ionic Digital', 'Cathedra Bitcoin', 'Iris Energy',
              'Miners Center Inc.', '360 Mining', 'Bitdeer', 'Marathon Patent Group', 'Marathon', 'Marathon Digital Holdings', 'Riot Blockchain', 'Riot',
              'Hut 8 Mining', 'Hut 8', 'Hut 8 Mining Corp', 'Bitcoin Group', 'Braiins', 'U.S. Bitcoin Corp', 'Discus Fish',
              'Bcause LLC', 'mining company', 'Compass Mining', 'Genesis Digital Assets', 'TAAL', 'MGT Capital Investments',
              'CoinGeek Mining', 'HashingSpace', 'ActiveMining', 'Cyclebit', 'DigitalBTC'
            ]
          },
          {
            key: '4.3.2',
            name: 'Mining Hardware Manufacturers',
            tags: [
              'Bitmain', 'Antminer', 'Bitmain S21', 'S21', 'BitFury',
              'Butterfly Labs', 'KnCMiner',
              'Avalon', 'ASICMiner',
              'Canaan', 'Canaan Inc', 'MicroBT', 'Hashflare', 'RainbowMiner', 'HashFast', 'Cointerra', 'S15', 'Avalon Clones'
            ]
          },
          {
            key: '4.3.3',
            name: 'Mining Pools',
            tags: ['F2Pool', 'Antpool', 'ViaBTC', 'Slush Pool', 'Slushpool', 'BTC.com', 'Poolin', 'p2pool', 'GHash', 'Ghash.io', 'BTC Guild', 'BTCGuild', 'BTC.top']
          }
        ]
      },
      {
        key: '4.4',
        name: 'Payment & Infrastructure',
        isParent: true,
        children: [
          {
            key: '4.4.1',
            name: 'Payment Processors',
            tags: ['BitPay', 'Strike', 'OpenNode', 'Braintree', 'Square/Block', 'Cash App', 'CashApp', 'Square', 'Flexepin', 'SnapCard', 'Bitspark', 'Lemon Cash', 'Paxum', 'Calypso Pay', 'QuickBT', 'BitPesa', 'Binance Pay', 'Shift Payments', 'Bitwage', 'LibertyX', 'Gyft', 'Bitcoin Suisse', 'Robocoin', 'Swan Bitcoin', 'Utrust', 'Coinzone', 'Lamassu', 'BitQuick', 'Abra', 'iPayYou', 'GoCoin', 'Venmo', 'Bitrefill', 'Bitspend', 'EgoPay', 'CoinGate', 'UATP', 'OKPay', 'BTCPoint', 'ChangeTip', 'Bitnet', 'Chivo', 'Simplecoin', 'Dwolla', 'Bylls', 'PayMaQ', 'Payment21', 'Kipochi', 'Poynt', 'Paymill', 'Coin Outlet', 'Bitwala']
          },
          {
            key: '4.4.2',
            name: 'Custody & Wallets',
            tags: ['BitGo', 'Xapo', 'Ledger', 'Trezor', 'Electrum', 'MetaMask', 'Trust Wallet', 'BitMesh', 'Locant', 'AMFeed', 'Zaimella', 'Wallet of Satoshi', 'Casa']
          },
          {
            key: '4.4.3',
            name: 'Blockchain Infrastructure',
            tags: ['Blockstream', 'Lightning Labs', 'Chainlink', 'Stacks', 'Rootstock', 'RSK', 'Infura', 'R3', 'StarkWare', 'ZeroSync Association', 'CENTRE Consortium', 'Blocktrail', 'Snapshot Labs', 'OpenCoin', 'Seetee AS', 'Sino-Global', 'Open Medicine Foundation', 'Pineapple Fund', 'ION', 'Maple', 'Chain.com', 'ConsenSys', 'Unstoppable Domains', 'BF Labs', 'Enfinium', 'bitbot', 'Chip Chap', 'Chainside']
          },
          {
            key: '4.4.4',
            name: 'Stablecoin Issuers',
            tags: ['Tether', 'Circle', 'USDC', 'Paxos', 'MakerDAO', 'DAI']
          }
        ]
      },
      {
        key: '4.5',
        name: 'DeFi Platforms',
        tags: ['Aave', 'Uniswap', 'Uniswap Labs', 'Uniswap Foundation', 'Curve Finance', 'Curve', 'MakerDAO', 'Yearn Finance', 'Compound', 'Balancer', 'Synthetix', 'Celsius', 'Terraform Labs', 'Sovryn', 'The Graph Network', 'Just-Dice', 'Satoshi Dice', 'SatoshiDice', 'PleasrDAO', 'BlockFi', 'Curve.fi', 'ICONOMI', 'Lido', '3Commas', 'BitLendingClub', 'Bitbond', 'CoinLoan', 'Status', 'Steemit', 'Alameda', 'B21', 'Money on Chain']
      },
      {
        key: '4.6',
        name: 'NFT Marketplaces',
        tags: ['OpenSea', 'Magic Eden', 'Blur', 'LooksRare']
      },
      {
        key: '4.7',
        name: 'Technology Companies',
        isParent: true,
        children: [
          {
            key: '4.7.1',
            name: 'Big Tech',
            tags: ['Microsoft', 'Google', 'Apple', 'Meta', 'Facebook', 'Amazon', 'IBM', 'Samsung', 'Intel', 'Verisign', 'Shape Security', 'Optiver', 'BuySellAds', 'Signal', 'Heml.is', 'OpenAI', 'Telefónica', 'McAfee', 'Zynga', 'Pizza Hut', 'Softbank', 'Deloitte', 'American Express', 'Amex', 'Overstock.com', 'Dish Network', 'Android', 'Linux', 'Ubuntu Lucid', 'GM', 'Baidu', 'Rakuten', 'Brave', 'iOS', '21 Inc', '21 Inc.', '21', 'Google Cloud', 'Google App Engine', 'Shopify', "McDonald's", 'KFC', 'Dell', 'HTC', 'Symantec', 'Expedia', 'Chrysler', 'SourceForge.net', 'Bladetec', 'Lumina', 'Skype', 'MongoDB', 'Link Global Technologies', 'Code Canvas', 'Avalonic', 'Kapiton.se', 'Midas', 'Bitfin', 'Steam', 'QuickBooks Online', 'Intuit', 'Nokia', 'Playboy', 'Clipse', 'BP', 'AT&T', 'GE', 'Siemens', 'Mega', 'HP', 'Sony', 'Nintendo', 'Unity', 'PlayStation 3', 'Valve', 'Alcoa', 'Infusionsoft', 'Fetch.ai',
              'DuckDuckGo', 'NVIDIA', 'Boeing', 'Bing', 'Linode', 'Namecheap', 'Hedgeable', 'Bitplaza Inc', 'Jito', 'Allianz', 'Newegg', '7-Eleven', 'Man United', 't3n', 'Dewlance', 'Apollo', 'WEconomy', 'me.ga', 'HMV', 'T15', 'Evil-Knievel', 'Waltonchain', 'Newnote Financial', 'EY', 'BitMonet']
          },
          {
            key: '4.7.2',
            name: 'Social Media & Communication',
            tags: ['Twitter', 'X', 'Reddit', 'Telegram', 'YouTube', 'Kik']
          },
          {
            key: '4.7.3',
            name: 'Fintech & Payments',
            tags: ['PayPal', 'Visa', 'Stripe', 'Mastercard', 'Robinhood', 'Bitfy', 'BitClave', 'POSaBIT', 'Avnet', 'Mobile Vikings', 'CoinConnect', 'CoinFac', 'TBD', 'NACHA', 'Swipe', 'FinTech', 'Fintech Week']
          },
          {
            key: '4.7.4',
            name: 'E-commerce & Retail',
            tags: ['Overstock', 'O.co', 'Walmart', 'Starbucks', 'eBay', 'Pick n Pay', 'WinADay Casino', 'GameStop', "Mac's Convenience", 'HSN', 'casinos', 'MintDice', 'Poketoshi', 'DiabloD3', 'gaming company', 'Fulfillment-by-Amazon', 'NFL']
          },
          {
            key: '4.7.5',
            name: 'Corporate Bitcoin Holders',
            tags: ['MicroStrategy', 'Tesla', 'Block', 'Square', 'Metaplanet', 'Semler Scientific']
          }
        ]
      },
      {
        key: '4.8',
        name: 'Media & Analytics',
        tags: ['CoinDesk', 'Bitcoin.com', 'Bitcoin Magazine', 'CoinGecko', 'CoinMarketCap', 'Bloomberg', 'The Bitcoin Show', 'Newsweek', 'BBC Radio 4', 'BBC News', 'Chainalysis', 'BitcoinAdvertising.com', 'BitBoy Crypto', 'Bitboy', 'Yahoo Finance', 'The Economist', 'CoinGeek.com', 'Coin Bureau', 'Bitcointalk.org', 'Bitcoin.org', 'Blockchain.info', 'Blockchain.com', 'Wikipedia', 'Glassnode', 'Chicago Sun-Times', 'CryptoCompare', 'ZeroBlock', 'InformationWeek', 'You, Me, and BTC', 'The Washington Post', 'Washington Times', 'SiliconANGLE', 'TechCabal', 'AwesomeFinTech Blog', 'SINCats.com', 'BTC Media', 'BTC Media LLC', 'Wikimedia Commons', 'Wikimedia Foundation', 'Unchained', 'StadiumDB.com', 'Mokuhankan', 'Cointalks', 'Coinpal', 'Time Inc.', 'HBO', 'SKY', 'Ghana Dot Com', 'Zapchain',
          'Digg', 'NBC', 'The Good Wife', 'DIYWEEK.net', 'ABC IT']
      },
      {
        key: '4.9',
        name: 'Development & Research',
        tags: ['Bitcoin Foundation', 'Foundation', 'Bitcoin Core', 'MIT Digital Currency Initiative', 'Chaincode Labs', 'Brink', 'Satoshi Nakamoto Institute', 'Bitcoin Optech', 'Optech', 'Scaling Bitcoin', 'MIT Coop', 'Public Citizen', 'UNICEF', 'BIS Innovation Hub', 'HEAL alliance', 'Watsi', 'Bitkub Academy', 'Gates Foundation', 'DynaFed', 'Handel', 'CSA', 'GEM', 'Solana Foundation', 'COPA', 'EFF']
      },
      {
        key: '4.10',
        name: 'Other Organizations',
        tags: ['NGOs', 'Global Witness', 'SNP', 'UNICEF', 'PDVSA', "Sean's Outpost", 'AIG', 'Mega', 'Saudi Maaden', 'Chinalco', 'Dunamu', 'Elliptic', 'Genesis Global Capital']
      }
    ]
  },
  {
    key: 'people',
    name: 'people',
    displayName: '👥 People',
    subcategories: [
      {
        key: '5.1',
        name: 'Crypto & Tech Figures',
        tags: [
          'Satoshi Nakamoto', 'Satoshi', 'Hal Finney', 'Gavin Andresen', 'Adam Back', 'Nick Szabo', 'Wei Dai',
          'Peter Todd', 'Gregory Maxwell', 'Wladimir van der Laan', 'Jeff Garzik', 'Mike Hearn', 'Luke-Jr', 'Pieter Wuille',
          'Vitalik Buterin', 'Vitalik', 'Charlie Lee', 'Brad Garlinghouse',
          'Brian Armstrong', 'Changpeng Zhao', 'CZ', 'Jesse Powell',
          'Michael Saylor', 'Jack Dorsey', 'Elon Musk',
          'Zuckerberg', 'Mark Zuckerberg', 'Chris Larsen',
          'Roger Ver', 'Mark Karpeles', 'Martti Malmi', 'Anthony Di Iorio', 'David Kleiman', 'Dave Kleiman',
          'Winklevoss twins', 'Winklevoss', 'Laszlo Hanyecz', 'Amber Baldet', 'Dan Held', 'Max Keiser', 'Blythe Masters',
          'Olivier Janssens', 'Samson Mow', 'Chef Nomi', 'Michael Ford', 'Michael Jackson', 'Jihan Wu',
          'Mathias Sundin', 'Domo', 'Kohn',
          'Sonny Singh', 'Shinichi Mochizuki', 'Joe Wilson',
          'Jackybetman',
          'Micky Malka', 'Yifu Guo', 'Nobuaki Kobayashi', 'andytoshi', 'Shoichi Nakagawa', 'Calvin Kim', 'David Laws', 'Vijay', 'Nick Neuman', 'Tim Byun', 'Steve Huffman',
          'Lisa Newman', 'Sean Quinn',
          'Elizabeth Ploshay', 'Ian Black', "NEM's CEO", 'Jon Matonis',
          'Bobby Lee', 'Gavin Wood', 'Kleiman', 'Senen Pousa', 'Justin Sun', 'Changpeng CZ Zhao', 'TheBlueMatt', 'Jimmy', 'Kent', 'Jack Liao', 'Janssens', 'Austin Hill', 'Chang', 'Sam Altman', 'Lesley Howell', 'Hodlonaut',
          'Coblee', 'Ed Felten', 'Neal King', 'Tony Vaughn', 'Jeong Ki Joon', 'Jay', 'Mohammed Al Fayed'
        ]
      },
      {
        key: '5.2',
        name: 'Government Officials',
        tags: [
          'Barack Obama', 'Obama', 'Donald Trump', 'Joe Biden',
          'Steve Bannon', 'Queen Elizabeth II', 'Abe',
          'Elizabeth Warren', 'Bernie Sanders', 'Ted Cruz', 'Senator Lummis', 'Lummis', 'Rand Paul', 'Ron Paul', 'Nancy Pelosi', 'Barney Frank',
          'Nayib Bukele', 'Javier Milei', 'Boris Johnson', 'George Osborne', 'David Cameron',
          'Jerome Powell', 'Ben Bernanke', 'Janet Yellen', 'Christine Lagarde',
          'Ursula von der Leyen', 'Jean-Claude Juncker', 'Gillard', 'Draghi', 'Robert Zoellick', 'Zoellick',
          'Viktor Orban', 'Mark Carney', 'Governor Brainard', 'Lael Brainard',
          'Ed Balls', 'Kenneth Lewis', 'Sam Adams',
          'Mitt Romney', 'Gordon Brown', 'Sarkozy', 'Nicolas Sarkozy',
          'Senator Schumer', 'Jair Bolsonaro', 'Indira Kempis', 'Thirachai Phuvanatnaranubala',
          'Arthur Levitt', 'Hu Jintao', 'NY Attorney General',
          'Judge Beth Bloom', 'Mel Martinez', 'Hank Paulson', 'Robert F. Kennedy Jr.', 'John Delaney',
          'Judge',
          'Alexandre Tombini', 'Senator Dodd', 'Wang Qishan', 'Powell', 'Fed Chair',
          'Jacob Lew',
          'Lawrence Summers', 'Timothy Geithner', 'Geithner', 'Merkel',
          'Wen Jiabao', 'Chancellor Darling', 'Bernanke', 'Ben Bernanke',
          'Ed Miliband', 'Putin', 'Vladimir Putin',
          'Mervyn King', 'Osborne', 'George Osborne', 'Cameron', 'David Cameron', 'Clegg', 'Nick Clegg', 'Richard Cordray',
          'Jens Weidmann', 'Jeremy Corbyn', 'Thomas Daschle', 'Jay Rockefeller', 'Rick Caruso', 'Hastings Masters', 'council bosses', 'Giuliani', 'Rudy Giuliani',
          'Andy Haldane', 'Biden', 'Jay Clayton', 'Joe Manchin', 'Gaddafi',
          'McConnell', 'Steve Stockman', 'Joseph Mitchell', 'Manchin', 'Hollande', 'Yellen', 'Bukele', 'Santos', 'John Kasich', 'Assad', 'Naoto Kan', 'Bill Clinton', 'Pope Benedict',
          'Vince Cable', 'Lula', 'Menkeu', 'CEO', 'PM'
        ]
      },
      {
        key: '5.3',
        name: 'Investors & Analysts',
        tags: [
          'Warren Buffett', 'Peter Schiff', 'Tim Draper', 'Barry Silbert', 'Cathie Wood',
          'George Soros', 'Jamie Dimon', 'Larry Fink', 'Anthony Pompliano', 'PlanB',
          'Balaji Srinivasan', 'Stephen Hester', 'Todd Combs', 'Vili Lehdonvirta',
          'Chamath Palihapitiya', 'Nouriel Roubini', 'Steve Keen', 'Rogoff', 'Kenneth Rogoff',
          'Richard Branson', 'Jim Cramer',
          'Matt Taibbi', 'Bill Gates', 'Lee Ka-shing', 'Tom Lee', 'David Andolfatto', 'Guy Hands', 'Buffett', 'James A. Johnson'
        ]
      },
      {
        key: '5.4',
        name: 'Controversial & Famous Figures',
        tags: [
          'Craig Wright', 'Sam Bankman-Fried', 'Ross Ulbricht',
          'Do Kwon', 'Alexander Vinnik', 'Charlie Shrem', 'Trendon Shavers',
          'Heather Morgan', 'Ilya Lichtenstein', 'James Zhong',
          'Mike Tyson', 'Floyd Mayweather', 'Logan Paul', 'Kim Dotcom',
          'Martin Shkreli', 'Bill Cosby', 'WikiLeaks',
          'John McAfee',
          'Isaac Newton',
          'Jon Lovitz', 'Conan',
          'Neil Heywood', 'Judge Judy', 'Nelson Mandela', 'Lanny Wadkins', 'Colin Howell', 'Jon Fitch', 'Zainab al-Hilli', 'Kanye West', 'Bin Laden', 'Douglas', 'comedians', 'The Weeknd', 'Pope Benedict'
        ]
      }
    ]
  },
  {
    key: 'regulation-law',
    name: 'regulation-law',
    displayName: '⚖️ Regulation & Government',
    subcategories: [
      {
        key: '6.1',
        name: 'Regulatory Bodies',
        tags: [
          'SEC', 'Federal Reserve', 'IRS', 'FinCEN', 'CFTC', 'FBI', 'Treasury', 'DOJ', 'DEA', 'CIA',
          'Pentagon', 'Department of Defense', 'DOD',
          'IMF', 'World Bank', 'Bank for International Settlements', 'BIS',
          'G20', 'G7', 'G8', 'EU', 'European Parliament', 'European Commission',
          'FCA', 'FSA', 'FINMA', 'MAS', 'RBI', 'OFT',
          'US Congress', 'US Senate', 'House of Representatives', 'Supreme Court',
          'Australian Federal Police', 'GAO', 'CFPB', 'financial authorities', 'local authorities', 'Regulator', 'Kremlin',
          'FDIC', 'Bank of China', 'European Court of Justice', 'Ministry of Finance',
          'Central Narcotics Bureau', 'FDA', 'Treasury Committee', 'House Financial Services Committee',
          'NYDFS', 'Financial Conduct Authority', 'FCA', 'Congress', 'Senate', 'Government', 'Central Bank',
          'World Economic Forum', 'UN', 'FASB', 'TARP', 'Regulators',
          'Basel Committee', 'Justice Department', 'DOJ', 'Consumer Financial Protection Bureau', 'CFPB', 'Australian Crime Commission',
          'White House', 'G-20', 'G20', 'Dutch Central Bank', 'VAT', 'Law Commission',
          'BaFin', 'OCC', 'Office of the Comptroller of the Currency', 'OFT', 'CCCS', 'Independent Commission on Banking', 'MEPs', 'House', 'Council', 'Office of Management and Budget',
          'EBA', 'BKA', 'Met police', 'police', 'CBCF', 'ADCCA'
        ]
      },
      {
        key: '6.2',
        name: 'Laws & Frameworks',
        tags: [
          'BitLicense', 'MiCA', 'EU Markets in Crypto-Assets',
          'Legal Tender Laws',
          'KYC/AML Regulations',
          'Securities Laws',
          'Tax Regulations',
          'IRS Notice 2014-2', 'Payment Services Act', 'BitLicenses', 'AB-129', 'Fianna Fail'
        ]
      },
      {
        key: '6.3',
        name: 'Government Initiatives',
        tags: [
          'Central Bank Digital Currencies', 'CBDCs', 'Central Bank Digital Currency',
          'Crypto Bans',
          'Regulatory Sandboxes',
          'Government Blockchain Projects',
          'parliamentary inquiry',
          'deficit commission', 'G8 Summit', 'House Bill 289'
        ]
      }
    ]
  },
  {
    key: 'markets-geography',
    name: 'markets-geography',
    displayName: '🌍 Geography & Markets',
    subcategories: [
      {
        key: '7.1',
        name: 'Countries & Regions',
        tags: [
          'United States', 'US', 'U.S.', 'Canada', 'Mexico',
          'New York', 'Texas', 'California', 'Florida', 'Colorado', 'Wyoming', 'Nevada', 'New Hampshire', 'New Jersey', 'NJ', 'Ohio', 'Wisconsin', 'Arizona', 'North Carolina', 'Georgia', 'Utah', 'Montana', 'Virginia', 'Pennsylvania', 'Massachusetts', 'Tennessee', 'Hawaii', 'Delaware', 'Indiana', 'Arkansas', 'Missouri', 'Alaska', 'Maine', 'South Carolina', 'Kansas',
          'China', 'Japan', 'South Korea', 'Korea', 'India', 'Singapore', 'Australia', 'Hong Kong', 'Taiwan', 'Thailand', 'Philippines', 'Vietnam', 'Indonesia', 'Malaysia', 'Pakistan', 'Bangladesh', 'Nepal', 'Sri Lanka',
          'United Kingdom', 'U.K.', 'UK', 'Britain', 'England', 'Scotland', 'Germany', 'France', 'Switzerland', 'Netherlands', 'Sweden', 'Italy', 'Spain', 'Russia', 'Greece', 'Ukraine', 'EU', 'Eurozone', 'Europe', 'Norway', 'Iceland', 'Cyprus', 'Ireland', 'Austria', 'Belgium', 'Portugal', 'Poland', 'Luxembourg', 'Estonia', 'Czech Republic', 'Denmark', 'Romania', 'Bulgaria', 'Slovenia', 'Malta', 'Belarus',
          'Middle East',
          'Gulf states',
          'Dominica',
          'El Salvador', 'Brazil', 'Argentina', 'Venezuela', 'Colombia', 'Paraguay', 'Uruguay', 'Peru', 'Bolivia', 'Ecuador', 'Chile', 'Honduras', 'Cuba',
          'UAE', 'Dubai', 'Israel', 'Iran', 'Turkey', 'Saudi Arabia', 'Saudi', 'Bahrain', 'Qatar', 'Lebanon', 'Kenya', 'South Africa', 'Nigeria', 'Ghana', 'Zimbabwe', 'Egypt', 'Uganda', 'Tanzania', 'Cameroon', 'Sierra Leone', 'Tunisia', 'Sudan', 'Gaza', 'West Bank', 'Palestinian', 'Palestine', 'Gabon', 'DR Congo', 'Mauritania',
          'Jamaica', 'Cayman Islands', 'North Africa', 'Ontario', 'Gibraltar', 'Central African Republic',
          'B.C.', 'British Columbia', 'Gulf',
          'Kazakhstan', 'Libya', 'Asia', 'Isle of Man', 'Afghanistan',
          'Bhutan', 'Quebec', 'Haiti', 'Vatican', 'ASEAN', 'Loyalty Islands', 'St Kitts', 'St. Kitts and Nevis', 'Washington State', 'Saskatchewan', 'Channel Islands', 'GCC', 'Skandinavien', 'Dutch Sandwich',
          'Yukon', 'APAC', 'Mid-Atlantic'
        ]
      },
      {
        key: '7.2',
        name: 'Cities & Special Locations',
        tags: [
          'London', 'New York City', 'Miami', 'Miami-Dade', 'Singapore', 'Hong Kong', 'Tokyo', 'Dubai', 'Amsterdam', 'Brussels', 'Las Vegas', 'San Francisco', 'Los Angeles', 'Berlin', 'Geneva', 'Vancouver', 'Beijing', 'Shanghai', 'Saigon', 'Seoul', 'Sydney', 'Melbourne', 'Mumbai', 'Nairobi', 'São Paulo', 'Buenos Aires',
          'Salt Lake City', 'Rio de Janeiro', 'Marmaris', 'Prague', 'Ahmedabad', 'East Belfast', 'Wynwood',
          'Houston', 'Ho Chi Minh City',
          'Twin Cities', 'Tehran', 'Detroit', 'Ciudad Juarez', 'Pontinha', 'Regina', 'Guernsey',
          'Washington', 'Zug', 'Arnhem', 'Atlanta', 'Abu Dhabi', 'East Midlands Airport',
          'Wall Street', 'Silicon Valley', 'Crypto Valley (Zug)', 'Bitcoin Beach (El Salvador)', 'Xinjiang (China)', 'Davos', 'Staples Center',
          'City of London', 'St. Helens Saints',
          'Danube plant',
          'Nice', 'Saskatoon', 'San Diego', 'Cleveland', 'Whyalla',
          'BTC City', 'Wilkins Ice Shelf',
          'Pensacola', 'Fukushima', 'St. Kitts and Nevis',
          'Ang Mo Kio', 'Atlantis', 'Neptune', 'Moyu', 'Loka', 'Quebec', 'Houston', 'Ho Chi Minh City',
          'Lugano', 'Ghent', 'Devon', 'Manhattan', 'Ottawa', 'Odessa', 'Thai8acu', 'Quiznos'
        ]
      }
    ]
  },
  {
    key: 'education-community',
    name: 'education-community',
    displayName: '🎓 Education & Community',
    subcategories: [
      {
        key: '8.1',
        name: 'Development Organizations',
        tags: [
          'Bitcoin Foundation', 'Bitcoin Core Development Team', 'Core team',
          'MIT Digital Currency Initiative', 'Digital Currency Initiative',
          'Chaincode Labs', 'Brink',
          'Satoshi Nakamoto Institute',
          'Ethereum Foundation', 'Web3 Foundation', 'Bitcoin Alliance India',
          'BTCPay Foundation', 'Oklo', 'Ark 21Shares',
          'Bitcoin Association', 'BitGive Foundation', 'BitAngels',
          'Chamber of Digital Commerce', 'Bitcoin Optech', 'Optech', 'Scaling Bitcoin', 'MOOC'
        ]
      },
      {
        key: '8.2',
        name: 'Community Forums & Platforms',
        tags: [
          'BitcoinTalk', 'BitcoinTalk (Original forum)', 'Bitcointalk.org',
          'Reddit', 'r/Bitcoin',
          'Hacker News',
          'GitHub', 'GitHub (Code repositories)',
          'Twitter', 'X', 'Twitter/X', 'Twitter/X (Crypto Twitter)',
          'Telegram Groups', 'Bitcoin Dev List', 'Bitcoin community', 'crypto community', 'community', 'Taringa',
          'Miami Hackathon', 'suicide helpline',
          'Bitfilm Festival', 'CeBIT',
          'Occupy movement', 'women', 'eco', 'Hunting', 'Couple', 'Kekanto', 'Bohemian_Lady', 'Jilaku', 'topic', 'bit', 'emoji', 'Dagong', 'Weownomy', 'ITOM', 'Huecco', 'Q2', 'CEO', 'PM', 'banking', 'bit', '27 MB', '8MB',
          '#boycottnovell'
        ]
      },
      {
        key: '8.3',
        name: 'Research & Academia',
        tags: [
          'MIT', 'Stanford',
          'University College London', 'UCL', 'University College Dublin',
          'Simon Fraser University',
          'Various Blockchain Research Centers', 'Bitkub Academy'
        ]
      }
    ]
  },
  {
    key: 'crime-security',
    name: 'crime-security',
    displayName: '🔒 Crime & Security',
    subcategories: [
      {
        key: '9.1',
        name: 'Dark Web & Criminal Marketplaces',
        tags: ['Silk Road', 'Silk Road (Original)', 'Silk Road 2.0', 'AlphaBay', 'Other Dark Markets', 'ISIS', 'ISIL', 'Taliban']
      },
      {
        key: '9.2',
        name: 'Major Crimes & Scams',
        isParent: true,
        children: [
          {
            key: '9.2.1',
            name: 'Ponzi Schemes',
            tags: ['Bitcoin Savings & Trust', 'Bitcoin Savings and Trust', 'Trendon Shavers', 'OneCoin', 'BitConnect', 'Madoff', 'Bernie Madoff']
          },
          {
            key: '9.2.2',
            name: 'Major Hacks',
            tags: ['Mt. Gox Hack', 'Mt. Gox', 'Mt Gox', 'Bitfinex Hack', 'Various Exchange Hacks', 'Exchange Hacks', 'Lulzsec', 'Taliban']
          },
          {
            key: '9.2.3',
            name: 'Fraud Cases',
            tags: ['FTX', 'Sam Bankman-Fried', 'Terra', 'Luna', 'Terra/Luna', 'Do Kwon', 'BitInstant', 'Charlie Shrem', 'Semion Mogilevich']
          }
        ]
      },
      {
        key: '9.3',
        name: 'Law Enforcement Actions',
        tags: [
          'Silk Road Takedown', 'Ross Ulbricht', 'BTC-e Shutdown', 'Alexander Vinnik',
          'DOJ Actions', 'FBI Investigations', 'International Cooperation'
        ]
      },
      {
        key: '9.4',
        name: 'Security Concepts',
        tags: [
          'Hacks & Exploits',
          'Phishing Attacks', 'Social Engineering',
          'Kelihos',
          'Rug Pulls',
          'Smart Contract Vulnerabilities',
          '51% Attacks', 'Double Spending', 'double-spend', 'double-spending',
          'CVE-2015-3641', 'DD4BC',
          'Antbleed', 'thief', 'mafia'
        ]
      }
    ]
  }
];

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

async function clearExistingData() {
  console.log('🗑️  Clearing existing tag_metadata...');
  await db.delete(tagMetadata);
  console.log('✅ Cleared existing data');
}

async function insertMainCategory(category: MainCategory): Promise<string> {
  const [result] = await db.insert(tagMetadata)
    .values({
      name: category.displayName,
      category: category.key,
      normalizedName: category.name.toLowerCase(),
      parentTagId: null,
    })
    .returning();
  
  console.log(`📁 Created main category: ${category.displayName} (${result.id})`);
  return result.id;
}

async function insertSubcategory(
  subcat: TagDefinition, 
  parentId: string, 
  mainCategoryKey: string
): Promise<string> {
  const [result] = await db.insert(tagMetadata)
    .values({
      name: subcat.name,
      category: mainCategoryKey,
      normalizedName: subcat.name.toLowerCase(),
      parentTagId: parentId,
    })
    .returning();
  
  console.log(`  📂 Created subcategory: ${subcat.name} (${result.id})`);
  return result.id;
}

async function insertTag(
  tagName: string, 
  parentId: string, 
  mainCategoryKey: string
): Promise<void> {
  // Check if tag already exists with same name and category
  const existing = await db.select()
    .from(tagMetadata)
    .where(
      and(
        eq(tagMetadata.name, tagName),
        eq(tagMetadata.category, mainCategoryKey)
      )
    )
    .limit(1);
  
  if (existing.length > 0) {
    // Update parent if different
    if (existing[0].parentTagId !== parentId) {
      await db.update(tagMetadata)
        .set({ parentTagId: parentId })
        .where(eq(tagMetadata.id, existing[0].id));
    }
    return;
  }
  
  await db.insert(tagMetadata)
    .values({
      name: tagName,
      category: mainCategoryKey,
      normalizedName: tagName.toLowerCase().trim(),
      parentTagId: parentId,
    });
}

async function processSubcategory(
  subcat: TagDefinition, 
  parentId: string, 
  mainCategoryKey: string
): Promise<void> {
  const subcatId = await insertSubcategory(subcat, parentId, mainCategoryKey);
  
  // If this subcategory has children (nested subcategories)
  if (subcat.isParent && subcat.children) {
    for (const child of subcat.children) {
      await processSubcategory(child, subcatId, mainCategoryKey);
    }
  }
  
  // Insert tags for this subcategory
  if (subcat.tags) {
    for (const tag of subcat.tags) {
      await insertTag(tag, subcatId, mainCategoryKey);
    }
  }
}

async function migrate() {
  console.log('🚀 Starting tag_metadata migration...\n');
  
  try {
    // Clear existing data
    await clearExistingData();
    
    let totalTags = 0;
    let totalSubcategories = 0;
    
    // Process each main category
    for (const category of taxonomy) {
      const mainCatId = await insertMainCategory(category);
      
      // Process subcategories
      for (const subcat of category.subcategories) {
        await processSubcategory(subcat, mainCatId, category.key);
        totalSubcategories++;
        
        // Count tags
        const countTags = (def: TagDefinition): number => {
          let count = def.tags?.length || 0;
          if (def.children) {
            count += def.children.reduce((sum, child) => sum + countTags(child), 0);
          }
          return count;
        };
        totalTags += countTags(subcat);
      }
      
      console.log('');
    }
    
    // Get final count
    const finalCount = await db.select().from(tagMetadata);
    
    console.log('\n✅ Migration complete!');
    console.log(`📊 Statistics:`);
    console.log(`   - Main categories: ${taxonomy.length}`);
    console.log(`   - Subcategories processed: ${totalSubcategories}`);
    console.log(`   - Total records in tag_metadata: ${finalCount.length}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration
migrate()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

