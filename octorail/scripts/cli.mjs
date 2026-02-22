#!/usr/bin/env node

import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

// ── Config ──────────────────────────────────────────────────────────────────

const OCTORAIL_DIR = join(homedir(), ".octorail");
const WALLET_PATH = join(OCTORAIL_DIR, "wallet.json");
const ALLOWLIST_PATH = join(OCTORAIL_DIR, "allowed-apis.json");
const HISTORY_PATH = join(OCTORAIL_DIR, "call-history.json");

// ── Wallet ──────────────────────────────────────────────────────────────────

async function loadOrCreateWallet() {
  try {
    const data = JSON.parse(await readFile(WALLET_PATH, "utf-8"));
    if (data.privateKey && data.address) return data;
  } catch {
    // No existing wallet
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const wallet = { privateKey, address: account.address };

  await mkdir(OCTORAIL_DIR, { recursive: true });
  await writeFile(WALLET_PATH, JSON.stringify(wallet, null, 2));
  await chmod(WALLET_PATH, 0o600);

  return wallet;
}

// ── Allowlist ───────────────────────────────────────────────────────────────

async function loadAllowlist() {
  try {
    return JSON.parse(await readFile(ALLOWLIST_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function saveAllowlist(data) {
  await mkdir(OCTORAIL_DIR, { recursive: true });
  await writeFile(ALLOWLIST_PATH, JSON.stringify(data, null, 2));
}

async function isApproved(owner, slug) {
  const data = await loadAllowlist();
  return data[`${owner}/${slug}`] || null;
}

async function approveApi(owner, slug, maxPrice) {
  const data = await loadAllowlist();
  data[`${owner}/${slug}`] = {
    maxPrice,
    approvedAt: new Date().toISOString(),
  };
  await saveAllowlist(data);
}

async function revokeApi(owner, slug) {
  const data = await loadAllowlist();
  delete data[`${owner}/${slug}`];
  await saveAllowlist(data);
}

async function listApprovedApis() {
  return loadAllowlist();
}

// ── Call History ─────────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

async function saveHistory(data) {
  await mkdir(OCTORAIL_DIR, { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(data, null, 2));
}

async function logCall({ owner, slug, price, callId, status }) {
  const data = await loadHistory();
  data.push({ owner, slug, price, callId, status, timestamp: new Date().toISOString() });
  await saveHistory(data);
}

async function getHistory(limit = 20) {
  const data = await loadHistory();
  return data.slice(-limit).reverse();
}

async function getSpendingSummary() {
  const data = await loadHistory();
  let total = 0;
  const byApi = {};

  for (const call of data) {
    const amount = parseFloat(call.price) || 0;
    total += amount;
    const key = `${call.owner}/${call.slug}`;
    if (!byApi[key]) byApi[key] = { calls: 0, spent: 0 };
    byApi[key].calls++;
    byApi[key].spent += amount;
  }

  return { total: total.toFixed(2), byApi };
}

// ── API Client ──────────────────────────────────────────────────────────────

function createClient(privateKey) {
  const baseUrl = process.env.OCTORAIL_URL || "http://localhost:3000";

  const signer = privateKeyToAccount(privateKey);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  async function getWalletHeaders() {
    const ts = String(Date.now());
    const message = `octorail:${ts}`;
    const signature = await signer.signMessage({ message });
    return {
      "x-wallet": signer.address,
      "x-wallet-sig": signature,
      "x-wallet-ts": ts,
    };
  }

  async function request(path, options = {}) {
    const url = `${baseUrl}${path}`;
    const walletHeaders = await getWalletHeaders();
    const res = await fetchWithPayment(url, {
      headers: { "Content-Type": "application/json", ...walletHeaders, ...options.headers },
      ...options,
    });

    if (!res.ok && res.status !== 402) {
      const text = await res.text().catch(() => "");
      throw new Error(`${res.status} ${res.statusText}: ${text}`);
    }

    return res.json();
  }

  return {
    listApis({ search, category } = {}) {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      const qs = params.toString();
      return request(`/apis${qs ? `?${qs}` : ""}`);
    },
    getApi(owner, slug) {
      return request(`/apis/${owner}/${slug}`);
    },
    callApi(owner, slug, body = {}) {
      return request(`/v1/apis/${owner}/${slug}/call`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || "help";
  const positional = [];
  const flags = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(args[i]);
    }
  }

  return { command, positional, flags };
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  const wallet = await loadOrCreateWallet();
  const client = createClient(wallet.privateKey);

  switch (command) {
    case "list": {
      const data = await client.listApis({ search: flags.search, category: flags.category });
      const apis = data.apis || [];
      if (apis.length === 0) {
        console.log("No APIs found.");
        break;
      }
      console.log(`Found ${apis.length} API(s):\n`);
      for (const api of apis) {
        const handle = api.ownerHandle || api.owner?.handle;
        const meta = [api.price];
        if (api.stats?.totalCalls > 0) meta.push(`${api.stats.totalCalls} calls`);
        if (api.stats?.avgResponseTime > 0) meta.push(`~${api.stats.avgResponseTime}ms`);
        console.log(`- ${api.name} (${handle}/${api.slug}) — ${meta.join(" · ")}`);
        console.log(`  ${api.description || "No description"}\n`);
      }
      break;
    }

    case "get": {
      const [owner, slug] = positional;
      if (!owner || !slug) {
        console.error("Usage: octorail get <owner> <slug>");
        process.exit(1);
      }
      const api = await client.getApi(owner, slug);
      console.log(`${api.name} (${api.ownerHandle}/${api.slug})`);
      console.log(`Price: ${api.price}`);
      console.log(`Category: ${api.category}`);
      console.log(`Method: ${api.upstreamMethod}`);
      console.log(`Description: ${api.description || "None"}`);

      if (api.inputSchema?.properties) {
        const required = api.inputSchema.required || [];
        console.log("\nInput parameters:");
        for (const [name, field] of Object.entries(api.inputSchema.properties)) {
          const req = required.includes(name) ? " (required)" : " (optional)";
          console.log(`  - ${name} (${field.type})${req}: ${field.description || "No description"}`);
        }
      } else {
        console.log("\nNo input schema defined. Send a JSON body or no body.");
      }
      break;
    }

    case "call": {
      const [owner, slug] = positional;
      if (!owner || !slug) {
        console.error("Usage: octorail call <owner> <slug> [--body '{}']");
        process.exit(1);
      }

      const entry = await isApproved(owner, slug);
      if (!entry) {
        console.error(`BLOCKED: ${owner}/${slug} is not in your allowlist.`);
        console.error("Approve it first: octorail approve " + owner + " " + slug + " --max-price <price>");
        process.exit(1);
      }

      const body = flags.body ? JSON.parse(flags.body) : {};
      const result = await client.callApi(owner, slug, body);

      await logCall({
        owner,
        slug,
        price: entry.maxPrice,
        callId: result.callId || null,
        status: result.status || "success",
      });

      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case "approve": {
      const [owner, slug] = positional;
      if (!owner || !slug) {
        console.error("Usage: octorail approve <owner> <slug> [--max-price 0.01]");
        process.exit(1);
      }
      const maxPrice = flags["max-price"] || "0.01";
      await approveApi(owner, slug, maxPrice);
      console.log(`Approved ${owner}/${slug} (max ${maxPrice} USDC per call).`);
      break;
    }

    case "revoke": {
      const [owner, slug] = positional;
      if (!owner || !slug) {
        console.error("Usage: octorail revoke <owner> <slug>");
        process.exit(1);
      }
      await revokeApi(owner, slug);
      console.log(`Revoked ${owner}/${slug}. This API can no longer be called.`);
      break;
    }

    case "approved": {
      const approved = await listApprovedApis();
      const entries = Object.entries(approved);
      if (entries.length === 0) {
        console.log("No APIs approved yet.");
        break;
      }
      console.log("Approved APIs:\n");
      for (const [key, val] of entries) {
        console.log(`- ${key} — max ${val.maxPrice} USDC (approved ${val.approvedAt})`);
      }
      break;
    }

    case "history": {
      const limit = flags.limit ? parseInt(flags.limit) : 20;
      const [history, summary] = await Promise.all([
        getHistory(limit),
        getSpendingSummary(),
      ]);

      if (history.length === 0) {
        console.log("No API calls yet.");
        break;
      }

      console.log(`Total spent: $${summary.total} USDC\n`);

      const apiEntries = Object.entries(summary.byApi);
      if (apiEntries.length > 0) {
        console.log("By API:");
        for (const [key, val] of apiEntries) {
          console.log(`  - ${key}: ${val.calls} call(s), $${val.spent.toFixed(2)} USDC`);
        }
        console.log();
      }

      console.log(`Recent calls (last ${history.length}):\n`);
      console.log("| # | API | Price | Status | Date |");
      console.log("|---|-----|-------|--------|------|");
      history.forEach((call, i) => {
        const date = new Date(call.timestamp).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        });
        console.log(`| ${i + 1} | ${call.owner}/${call.slug} | $${call.price} | ${call.status} | ${date} |`);
      });
      break;
    }

    case "wallet": {
      console.log(`Wallet address: ${wallet.address}`);
      console.log();
      console.log("To use paid APIs, send USDC to this address on Base Sepolia.");
      console.log("Payments are gasless ERC-2612 permit signatures — you only need USDC, not ETH.");
      break;
    }

    default:
      console.log("OctoRail CLI — API Marketplace\n");
      console.log("Commands:");
      console.log("  list [--search X]                Browse APIs");
      console.log("  get <owner> <slug>               Get API details and inputSchema");
      console.log("  approve <owner> <slug>           Approve an API (--max-price 0.01)");
      console.log("  call <owner> <slug>              Call a paid API (--body '{}')");
      console.log("  revoke <owner> <slug>            Revoke API approval");
      console.log("  approved                         List approved APIs");
      console.log("  history                          Spending history");
      console.log("  wallet                           Show wallet address");
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
