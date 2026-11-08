//! # Merchants of NEAR — on-chain ownership & settlement
//!
//! Routine simulation (prices, production, merchant AI) runs off-chain on the game
//! server. This contract holds the things that must be *owned* and *verifiable*:
//!
//! * **Business deeds** — a player who owns a business in-game can claim a deed
//!   for it. The claim carries an ed25519 certificate signed by the game server's
//!   authority key, so a deed can only be minted for a business the player really
//!   owns. The player signs and pays for the transaction with their own wallet;
//!   the server never holds user keys.
//! * **Deed marketplace** — deeds are listed and bought for NEAR. Settlement is
//!   atomic on-chain: the buyer's deposit pays the seller and ownership moves in
//!   the same receipt. The game server follows on-chain ownership, so buying a
//!   deed transfers the business inside the game.
//! * **Soulbound achievements** — server-certified, non-transferable badges.
//!
//! Every state change emits a NEP-297 event (`EVENT_JSON:`) for indexers.

use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

/// Fee kept by the contract treasury on deed sales (basis points).
const SALE_FEE_BPS: u128 = 250;
/// Minimum deposit to cover storage when minting a deed or badge.
const MINT_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_PAGE: u32 = 100;

#[derive(BorshStorageKey, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Deeds,
    Nonces,
    Badges,
    BadgeIndex,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Deed {
    pub token_id: String,
    pub owner_id: AccountId,
    pub kind: String,
    pub business_id: String,
    pub level: u8,
    pub minted_at_ms: u64,
    pub listed_price: Option<U128>,
    pub sales: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Badge {
    pub achievement_id: String,
    pub awarded_at_ms: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub game_authority: String,
    pub sale_fee_bps: u32,
    pub deeds: u32,
    pub treasury: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    /// Raw 32-byte ed25519 public key of the game server's certificate authority.
    game_authority: [u8; 32],
    deeds: IterableMap<String, Deed>,
    used_nonces: LookupSet<String>,
    badges: LookupMap<AccountId, Vec<Badge>>,
    badge_index: LookupSet<String>,
    treasury: u128,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "merchants_of_near", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

/// Parse "ed25519:<base58>" or bare base58 into 32 raw bytes.
fn parse_ed25519(key: &str) -> [u8; 32] {
    let b58 = key.strip_prefix("ed25519:").unwrap_or(key);
    let bytes = near_sdk::bs58::decode(b58).into_vec().unwrap_or_else(|_| env::panic_str("Invalid base58 key"));
    bytes.try_into().unwrap_or_else(|_| env::panic_str("Key must be 32 bytes"))
}

fn decode_sig(sig_b64: &str) -> [u8; 64] {
    use near_sdk::base64::Engine;
    let bytes = near_sdk::base64::engine::general_purpose::STANDARD
        .decode(sig_b64)
        .unwrap_or_else(|_| env::panic_str("Invalid base64 signature"));
    bytes.try_into().unwrap_or_else(|_| env::panic_str("Signature must be 64 bytes"))
}

/// Canonical message the game server signs for a deed certificate.
pub fn deed_message(account: &str, token_id: &str, kind: &str, business_id: &str, level: u8, nonce: &str, expires_at_ms: u64) -> String {
    format!("merchants-of-near:deed:v1|{account}|{token_id}|{kind}|{business_id}|{level}|{nonce}|{expires_at_ms}")
}

/// Canonical message the game server signs for an achievement certificate.
pub fn badge_message(account: &str, achievement_id: &str, nonce: &str, expires_at_ms: u64) -> String {
    format!("merchants-of-near:badge:v1|{account}|{achievement_id}|{nonce}|{expires_at_ms}")
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, game_authority: String) -> Self {
        Self {
            owner_id,
            game_authority: parse_ed25519(&game_authority),
            deeds: IterableMap::new(StorageKey::Deeds),
            used_nonces: LookupSet::new(StorageKey::Nonces),
            badges: LookupMap::new(StorageKey::Badges),
            badge_index: LookupSet::new(StorageKey::BadgeIndex),
            treasury: 0,
        }
    }

    fn verify_certificate(&mut self, message: &str, nonce: &str, expires_at_ms: u64, signature: &str) {
        require!(env::block_timestamp_ms() <= expires_at_ms, "Certificate expired");
        require!(!self.used_nonces.contains(nonce), "Certificate already used");
        let sig = decode_sig(signature);
        require!(env::ed25519_verify(&sig, message.as_bytes(), &self.game_authority), "Invalid game certificate");
        self.used_nonces.insert(nonce.to_string());
    }

    /// Mint (or upgrade) the deed for a business, using a certificate from the game server.
    #[payable]
    pub fn claim_deed(
        &mut self,
        token_id: String,
        kind: String,
        business_id: String,
        level: u8,
        nonce: String,
        expires_at_ms: u64,
        signature: String,
    ) -> Deed {
        let account = env::predecessor_account_id();
        require!(env::attached_deposit() >= MINT_DEPOSIT, "Attach at least 0.01 NEAR for storage");
        require!(token_id.len() <= 64 && kind.len() <= 32 && business_id.len() <= 64, "Field too long");
        let msg = deed_message(account.as_str(), &token_id, &kind, &business_id, level, &nonce, expires_at_ms);
        self.verify_certificate(&msg, &nonce, expires_at_ms, &signature);

        let deed = match self.deeds.get(&token_id) {
            Some(existing) => {
                require!(existing.owner_id == account, "Deed is owned by another account");
                Deed { level, ..existing.clone() }
            }
            None => Deed {
                token_id: token_id.clone(),
                owner_id: account.clone(),
                kind,
                business_id,
                level,
                minted_at_ms: env::block_timestamp_ms(),
                listed_price: None,
                sales: 0,
            },
        };
        self.deeds.insert(token_id.clone(), deed.clone());
        emit("deed_claimed", json!({ "token_id": token_id, "owner_id": account, "kind": deed.kind, "level": deed.level }));
        deed
    }

    /// List a deed for sale at `price` yoctoNEAR.
    pub fn list_deed(&mut self, token_id: String, price: U128) {
        let account = env::predecessor_account_id();
        require!(price.0 > 0, "Price must be positive");
        let deed = self.deeds.get_mut(&token_id).unwrap_or_else(|| env::panic_str("Deed not found"));
        require!(deed.owner_id == account, "Only the owner can list this deed");
        deed.listed_price = Some(price);
        emit("deed_listed", json!({ "token_id": token_id, "owner_id": account, "price": price }));
    }

    pub fn delist_deed(&mut self, token_id: String) {
        let account = env::predecessor_account_id();
        let deed = self.deeds.get_mut(&token_id).unwrap_or_else(|| env::panic_str("Deed not found"));
        require!(deed.owner_id == account, "Only the owner can delist this deed");
        deed.listed_price = None;
        emit("deed_delisted", json!({ "token_id": token_id }));
    }

    /// Buy a listed deed. The seller is paid and ownership moves atomically; excess deposit is refunded.
    #[payable]
    pub fn buy_deed(&mut self, token_id: String) -> Deed {
        let buyer = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        let deed = self.deeds.get_mut(&token_id).unwrap_or_else(|| env::panic_str("Deed not found"));
        let price = deed.listed_price.unwrap_or_else(|| env::panic_str("Deed is not for sale")).0;
        require!(deed.owner_id != buyer, "You already own this deed");
        require!(deposit >= price, "Attached deposit is below the asking price");
        let seller = deed.owner_id.clone();
        let fee = price * SALE_FEE_BPS / 10_000;
        deed.owner_id = buyer.clone();
        deed.listed_price = None;
        deed.sales += 1;
        let result = deed.clone();
        self.treasury += fee;
        Promise::new(seller.clone()).transfer(NearToken::from_yoctonear(price - fee)).detach();
        if deposit > price {
            Promise::new(buyer.clone()).transfer(NearToken::from_yoctonear(deposit - price)).detach();
        }
        emit("deed_sold", json!({ "token_id": token_id, "seller_id": seller, "buyer_id": buyer, "price": U128(price), "fee": U128(fee) }));
        result
    }

    /// Gift or move a deed to another account (requires 1 yoctoNEAR for wallet confirmation).
    #[payable]
    pub fn transfer_deed(&mut self, token_id: String, receiver_id: AccountId) {
        near_sdk::assert_one_yocto();
        let account = env::predecessor_account_id();
        let deed = self.deeds.get_mut(&token_id).unwrap_or_else(|| env::panic_str("Deed not found"));
        require!(deed.owner_id == account, "Only the owner can transfer this deed");
        deed.owner_id = receiver_id.clone();
        deed.listed_price = None;
        emit("deed_transferred", json!({ "token_id": token_id, "from": account, "to": receiver_id }));
    }

    /// Record a soulbound achievement badge using a game-server certificate.
    #[payable]
    pub fn record_achievement(&mut self, achievement_id: String, nonce: String, expires_at_ms: u64, signature: String) -> Badge {
        let account = env::predecessor_account_id();
        require!(env::attached_deposit() >= MINT_DEPOSIT, "Attach at least 0.01 NEAR for storage");
        require!(achievement_id.len() <= 48, "Field too long");
        let key = format!("{}#{}", account, achievement_id);
        require!(!self.badge_index.contains(&key), "Achievement already recorded");
        let msg = badge_message(account.as_str(), &achievement_id, &nonce, expires_at_ms);
        self.verify_certificate(&msg, &nonce, expires_at_ms, &signature);
        let badge = Badge { achievement_id: achievement_id.clone(), awarded_at_ms: env::block_timestamp_ms() };
        let mut list = self.badges.get(&account).cloned().unwrap_or_default();
        list.push(badge.clone());
        self.badges.insert(account.clone(), list);
        self.badge_index.insert(key);
        emit("achievement_recorded", json!({ "account_id": account, "achievement_id": achievement_id }));
        badge
    }

    /// Owner: rotate the game authority key (e.g. after a server key compromise).
    pub fn set_game_authority(&mut self, game_authority: String) {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        self.game_authority = parse_ed25519(&game_authority);
    }

    /// Owner: withdraw accumulated marketplace fees.
    pub fn withdraw_treasury(&mut self, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.owner_id, "Owner only");
        require!(amount.0 <= self.treasury, "Insufficient treasury");
        self.treasury -= amount.0;
        Promise::new(self.owner_id.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ------------------------------------------------------------- views ---

    pub fn get_deed(&self, token_id: String) -> Option<Deed> {
        self.deeds.get(&token_id).cloned()
    }

    pub fn deeds_of(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Deed> {
        let limit = limit.unwrap_or(50).min(MAX_PAGE) as usize;
        self.deeds
            .values()
            .filter(|d| d.owner_id == account_id)
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn listed_deeds(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Deed> {
        let limit = limit.unwrap_or(50).min(MAX_PAGE) as usize;
        self.deeds
            .values()
            .filter(|d| d.listed_price.is_some())
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit)
            .cloned()
            .collect()
    }

    pub fn all_deeds(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Deed> {
        let limit = limit.unwrap_or(50).min(MAX_PAGE) as usize;
        self.deeds.values().skip(from_index.unwrap_or(0) as usize).take(limit).cloned().collect()
    }

    pub fn achievements_of(&self, account_id: AccountId) -> Vec<Badge> {
        self.badges.get(&account_id).cloned().unwrap_or_default()
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            game_authority: format!("ed25519:{}", near_sdk::bs58::encode(self.game_authority).into_string()),
            sale_fee_bps: SALE_FEE_BPS as u32,
            deeds: self.deeds.len(),
            treasury: U128(self.treasury),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    fn key() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }
    fn authority() -> String {
        format!("ed25519:{}", near_sdk::bs58::encode(key().verifying_key().to_bytes()).into_string())
    }
    fn sign(msg: &str) -> String {
        use near_sdk::base64::Engine;
        near_sdk::base64::engine::general_purpose::STANDARD.encode(key().sign(msg.as_bytes()).to_bytes())
    }
    fn ctx(who: &str, deposit: NearToken) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(who.parse().unwrap()).attached_deposit(deposit).block_timestamp(1_000_000_000_000);
        testing_env!(b.build());
    }
    fn setup() -> Contract {
        ctx("owner.testnet", NearToken::from_yoctonear(0));
        Contract::new("owner.testnet".parse().unwrap(), authority())
    }
    fn claim(c: &mut Contract, who: &str, token: &str, nonce: &str) -> Deed {
        ctx(who, MINT_DEPOSIT);
        let exp = 2_000_000;
        let sig = sign(&deed_message(who, token, "farm", "biz_1", 1, nonce, exp));
        c.claim_deed(token.into(), "farm".into(), "biz_1".into(), 1, nonce.into(), exp, sig)
    }

    #[test]
    fn claims_deed_with_valid_certificate() {
        let mut c = setup();
        let d = claim(&mut c, "alice.testnet", "deed-1", "n1");
        assert_eq!(d.owner_id.as_str(), "alice.testnet");
        assert_eq!(c.deeds_of("alice.testnet".parse().unwrap(), None, None).len(), 1);
        assert!(get_logs()[0].starts_with("EVENT_JSON:"));
    }

    #[test]
    #[should_panic(expected = "Invalid game certificate")]
    fn rejects_forged_certificate() {
        let mut c = setup();
        ctx("mallory.testnet", MINT_DEPOSIT);
        // Signed for alice, submitted by mallory.
        let sig = sign(&deed_message("alice.testnet", "deed-1", "farm", "biz_1", 1, "n1", 2_000_000));
        c.claim_deed("deed-1".into(), "farm".into(), "biz_1".into(), 1, "n1".into(), 2_000_000, sig);
    }

    #[test]
    #[should_panic(expected = "Certificate already used")]
    fn rejects_replayed_nonce() {
        let mut c = setup();
        claim(&mut c, "alice.testnet", "deed-1", "n1");
        claim(&mut c, "alice.testnet", "deed-2", "n1");
    }

    #[test]
    #[should_panic(expected = "Certificate expired")]
    fn rejects_expired_certificate() {
        let mut c = setup();
        ctx("alice.testnet", MINT_DEPOSIT);
        let sig = sign(&deed_message("alice.testnet", "deed-1", "farm", "biz_1", 1, "n1", 10));
        c.claim_deed("deed-1".into(), "farm".into(), "biz_1".into(), 1, "n1".into(), 10, sig);
    }

    #[test]
    fn marketplace_settles_ownership_and_fee() {
        let mut c = setup();
        claim(&mut c, "alice.testnet", "deed-1", "n1");
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        c.list_deed("deed-1".into(), U128(1_000_000));
        assert_eq!(c.listed_deeds(None, None).len(), 1);
        ctx("bob.testnet", NearToken::from_yoctonear(1_200_000));
        let d = c.buy_deed("deed-1".into());
        assert_eq!(d.owner_id.as_str(), "bob.testnet");
        assert_eq!(d.sales, 1);
        assert_eq!(c.get_config().treasury.0, 25_000);
        assert!(c.listed_deeds(None, None).is_empty());
    }

    #[test]
    #[should_panic(expected = "below the asking price")]
    fn rejects_underpayment() {
        let mut c = setup();
        claim(&mut c, "alice.testnet", "deed-1", "n1");
        ctx("alice.testnet", NearToken::from_yoctonear(0));
        c.list_deed("deed-1".into(), U128(1_000_000));
        ctx("bob.testnet", NearToken::from_yoctonear(10));
        c.buy_deed("deed-1".into());
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn only_owner_can_list() {
        let mut c = setup();
        claim(&mut c, "alice.testnet", "deed-1", "n1");
        ctx("bob.testnet", NearToken::from_yoctonear(0));
        c.list_deed("deed-1".into(), U128(5));
    }

    #[test]
    fn achievements_are_soulbound_and_unique() {
        let mut c = setup();
        ctx("alice.testnet", MINT_DEPOSIT);
        let sig = sign(&badge_message("alice.testnet", "landowner", "b1", 2_000_000));
        c.record_achievement("landowner".into(), "b1".into(), 2_000_000, sig);
        assert_eq!(c.achievements_of("alice.testnet".parse().unwrap()).len(), 1);
    }

    #[test]
    #[should_panic(expected = "Achievement already recorded")]
    fn achievement_cannot_be_recorded_twice() {
        let mut c = setup();
        for n in ["b1", "b2"] {
            ctx("alice.testnet", MINT_DEPOSIT);
            let sig = sign(&badge_message("alice.testnet", "landowner", n, 2_000_000));
            c.record_achievement("landowner".into(), n.into(), 2_000_000, sig);
        }
    }
}
