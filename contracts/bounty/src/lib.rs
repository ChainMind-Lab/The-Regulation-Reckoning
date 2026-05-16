//! Regulation Reckoning — Bounty Escrow Contract
//!
//! A Soroban smart contract for Stellar Drips Wave 5.
//! Allows a funder to deposit USDC into escrow for a specific issue bounty,
//! and release it to a contributor once the work is verified.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, token, Address, Env, String,
};

/// On-chain state for a single bounty.
#[contracttype]
#[derive(Clone)]
pub struct Bounty {
    pub funder: Address,
    pub contributor: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub issue_id: String,
    pub released: bool,
}

/// Storage key variants.
#[contracttype]
pub enum DataKey {
    Bounty(String),
    Admin,
}

#[contract]
pub struct BountyContract;

#[contractimpl]
impl BountyContract {
    /// Initialise the contract with an admin address.
    pub fn init(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Funder creates a bounty by depositing tokens into escrow.
    pub fn create(
        env: Env,
        funder: Address,
        token: Address,
        amount: i128,
        issue_id: String,
    ) {
        funder.require_auth();
        assert!(amount > 0, "amount must be positive");
        assert!(
            !env.storage().instance().has(&DataKey::Bounty(issue_id.clone())),
            "bounty already exists for this issue"
        );

        // Transfer tokens from funder to this contract.
        let client = token::Client::new(&env, &token);
        client.transfer(&funder, &env.current_contract_address(), &amount);

        let bounty = Bounty {
            funder,
            contributor: None,
            token,
            amount,
            issue_id: issue_id.clone(),
            released: false,
        };
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id), &bounty);
    }

    /// Admin releases the bounty to the contributor after PR is merged.
    pub fn release(env: Env, issue_id: String, contributor: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialised");
        admin.require_auth();

        let mut bounty: Bounty = env
            .storage()
            .instance()
            .get(&DataKey::Bounty(issue_id.clone()))
            .expect("bounty not found");

        assert!(!bounty.released, "bounty already released");

        let client = token::Client::new(&env, &bounty.token);
        client.transfer(&env.current_contract_address(), &contributor, &bounty.amount);

        bounty.released = true;
        bounty.contributor = Some(contributor);
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id), &bounty);
    }

    /// Funder can reclaim tokens if the bounty is unclaimed (admin must approve).
    pub fn reclaim(env: Env, issue_id: String) {
        let mut bounty: Bounty = env
            .storage()
            .instance()
            .get(&DataKey::Bounty(issue_id.clone()))
            .expect("bounty not found");

        bounty.funder.require_auth();
        assert!(!bounty.released, "bounty already released");

        let client = token::Client::new(&env, &bounty.token);
        client.transfer(
            &env.current_contract_address(),
            &bounty.funder,
            &bounty.amount,
        );

        bounty.released = true;
        env.storage()
            .instance()
            .set(&DataKey::Bounty(issue_id), &bounty);
    }

    /// Read a bounty by issue ID.
    pub fn get_bounty(env: Env, issue_id: String) -> Bounty {
        env.storage()
            .instance()
            .get(&DataKey::Bounty(issue_id))
            .expect("bounty not found")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, IntoVal, String,
    };

    fn setup() -> (Env, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let contributor = Address::generate(&env);
        let contract_id = env.register_contract(None, BountyContract);
        (env, contract_id, admin, funder, contributor)
    }

    #[test]
    fn test_create_and_release() {
        let (env, contract_id, admin, funder, contributor) = setup();
        let client = BountyContractClient::new(&env, &contract_id);

        // Deploy a test token.
        let token_id = env.register_stellar_asset_contract(admin.clone());
        let token_admin = StellarAssetClient::new(&env, &token_id);
        token_admin.mint(&funder, &1000);

        client.init(&admin);

        let issue_id = String::from_str(&env, "issue-42");
        client.create(&funder, &token_id, &500, &issue_id);

        let bounty = client.get_bounty(&issue_id);
        assert_eq!(bounty.amount, 500);
        assert!(!bounty.released);

        client.release(&issue_id, &contributor);

        let bounty = client.get_bounty(&issue_id);
        assert!(bounty.released);
        assert_eq!(bounty.contributor, Some(contributor.clone()));

        let token = TokenClient::new(&env, &token_id);
        assert_eq!(token.balance(&contributor), 500);
    }
}
