#!/usr/bin/env bash
# Build and deploy the Merchants of NEAR contract to NEAR testnet.
#
# Prerequisites:
#   - Rust + wasm32 target:  rustup target add wasm32-unknown-unknown
#   - cargo-near:            cargo install cargo-near   (needs libudev-dev on Linux)
#   - near-cli-rs:           npm i -g near-cli-rs   (or see https://github.com/near/near-cli-rs)
#   - A testnet account for the contract, e.g. created with:
#       near account create-account sponsor-by-faucet-service mon-game.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
#   - GAME_AUTHORITY_PUBLIC_KEY from `npm run keygen`
#
# Usage: GAME_AUTHORITY_PUBLIC_KEY=ed25519:... scripts/deploy-contract.sh mon-game.testnet [owner.testnet]
set -euo pipefail
CONTRACT="${1:?contract account id required}"
OWNER="${2:-$1}"
: "${GAME_AUTHORITY_PUBLIC_KEY:?set GAME_AUTHORITY_PUBLIC_KEY (from npm run keygen)}"

cd "$(dirname "$0")/../contract"
cargo near build non-reproducible-wasm

near contract deploy "$CONTRACT" \
  use-file target/near/merchants_of_near.wasm \
  with-init-call new json-args "{\"owner_id\":\"$OWNER\",\"game_authority\":\"$GAME_AUTHORITY_PUBLIC_KEY\"}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send

echo
echo "Deployed. Set NEAR_CONTRACT_ID=$CONTRACT in the server .env and restart."
echo "Verify: near contract call-function as-read-only $CONTRACT get_config json-args '{}' network-config testnet now"
