# OctoRail API Reference

## Overview

OctoRail is a marketplace for paid APIs. You pay per call using USDC on Base Sepolia via the x402 payment protocol. Payments are gasless permit signatures — no ETH needed.

## Commands

### list

Browse available APIs.

```bash
./scripts/octorail.sh list
./scripts/octorail.sh list --search "image"
./scripts/octorail.sh list --category "ai"
```

**Output:** Name, owner/slug handle, price per call, usage stats, and description for each API.

### get

Get full details about an API, including its **inputSchema** (the parameters it expects).

```bash
./scripts/octorail.sh get <owner> <slug>
```

**Example:**
```bash
./scripts/octorail.sh get octorail web-search
```

**Output:** Name, price, category, HTTP method, description, and a list of input parameters with types, required/optional status, and descriptions.

**Important:** Always run `get` before `call` to know what parameters to send. Sending wrong parameters wastes money.

### approve

Add an API to the allowlist so it can be called.

```bash
./scripts/octorail.sh approve <owner> <slug> --max-price <price>
```

**Example:**
```bash
./scripts/octorail.sh approve octorail url-shortener --max-price 0.01
```

- `--max-price` sets the maximum USDC you're willing to pay per call (default: 0.01)
- Only approved APIs can be called with `call`

### call

Call a paid API. **This costs real USDC.**

```bash
./scripts/octorail.sh call <owner> <slug> --body '{"key":"value"}'
```

**Example:**
```bash
./scripts/octorail.sh call mormonnegro create-image --body '{"prompt":"a cat in space"}'
```

- The API must be approved first (use `approve`)
- `--body` is a JSON string matching the API's inputSchema
- The response is printed as JSON to stdout

### revoke

Remove an API from the allowlist.

```bash
./scripts/octorail.sh revoke <owner> <slug>
```

### approved

List all APIs currently in the allowlist.

```bash
./scripts/octorail.sh approved
```

**Output:** Each approved API with its max price and approval date.

### history

View spending history and totals.

```bash
./scripts/octorail.sh history
./scripts/octorail.sh history --limit 50
```

**Output:** Total USDC spent, breakdown by API, and a table of recent calls with prices, status, and dates.

### wallet

Show your wallet address.

```bash
./scripts/octorail.sh wallet
```

**Output:** Your wallet address on Base Sepolia and instructions for funding.

## Payment Flow

1. On first run, a wallet is created at `~/.octorail/wallet.json`
2. Fund the wallet address with USDC on **Base Sepolia** (testnet)
3. When you call an API, the CLI signs an ERC-2612 permit (gasless, no ETH)
4. The OctoRail backend verifies payment and forwards to the upstream API
5. The call is logged locally in `~/.octorail/call-history.json`

## Local Files

All data is stored in `~/.octorail/`:

| File | Purpose |
|------|---------|
| `wallet.json` | Private key and address (permissions: 0600) |
| `allowed-apis.json` | Approved APIs with max prices |
| `call-history.json` | Log of all API calls with costs |
| `node_modules/` | Auto-installed dependencies |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OCTORAIL_URL` | `http://localhost:3000` | OctoRail backend URL |

## Troubleshooting

### "BLOCKED: ... is not in your allowlist"
Run `approve` first:
```bash
./scripts/octorail.sh approve <owner> <slug> --max-price 0.01
```

### API call fails with payment error
Your wallet may not have enough USDC. Check your balance on Base Sepolia at:
`https://sepolia.basescan.org/address/<your-wallet-address>`

### Getting USDC on Base Sepolia
1. Get testnet ETH from a Base Sepolia faucet
2. Use a USDC testnet faucet or bridge to get USDC on Base Sepolia
3. Send USDC to your wallet address (shown by `./scripts/octorail.sh wallet`)

### Dependencies fail to install
Delete `~/.octorail/node_modules` and run any command again to reinstall:
```bash
rm -rf ~/.octorail/node_modules
./scripts/octorail.sh list
```
