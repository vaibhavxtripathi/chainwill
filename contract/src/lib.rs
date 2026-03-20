#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, String, token,
};

// Owner locks XLM and designates a beneficiary.
// Owner must "ping" (check-in) at least once every check_interval ledgers.
// If the owner fails to ping in time, the beneficiary can claim the entire balance.
// Owner can always withdraw their own funds while active.
// Multiple wills per contract, each with independent timers.

const MIN_BALANCE:      i128 = 10_000_000;  // 1 XLM min
const MIN_INTERVAL:     u32  = 17_280;      // min ~1 day
const MAX_TITLE:        u32  = 60;
const MAX_NOTE:         u32  = 200;

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum WillStatus {
    Active,     // owner still pinging, beneficiary cannot claim
    Triggered,  // owner missed check-in, beneficiary can claim
    Claimed,    // beneficiary claimed the funds
    Revoked,    // owner withdrew and cancelled
}

#[contracttype]
#[derive(Clone)]
pub struct Will {
    pub id:               u64,
    pub owner:            Address,
    pub beneficiary:      Address,
    pub title:            String,
    pub note:             String,   // message to beneficiary
    pub balance:          i128,
    pub check_interval:   u32,      // ledgers between required pings
    pub last_ping:        u32,      // ledger of last owner check-in
    pub deadline:         u32,      // last_ping + check_interval
    pub status:           WillStatus,
    pub created_at:       u32,
    pub ping_count:       u32,
}

#[contracttype]
pub enum DataKey {
    Will(u64),
    Count,
    OwnerWills(Address),
    BeneficiaryWills(Address),
}

#[contract]
pub struct ChainWillContract;

#[contractimpl]
impl ChainWillContract {
    /// Owner creates a will — deposits XLM, sets beneficiary and check-in interval
    pub fn create_will(
        env: Env,
        owner: Address,
        beneficiary: Address,
        title: String,
        note: String,
        amount: i128,
        check_interval: u32,
        xlm_token: Address,
    ) -> u64 {
        owner.require_auth();
        assert!(owner != beneficiary, "Owner cannot be beneficiary");
        assert!(amount >= MIN_BALANCE, "Min 1 XLM");
        assert!(title.len() > 0 && title.len() <= MAX_TITLE, "Title required");
        assert!(note.len() <= MAX_NOTE, "Note max 200 chars");
        assert!(check_interval >= MIN_INTERVAL, "Min interval 17280 ledgers (~1 day)");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        let count: u64 = env.storage().instance()
            .get(&DataKey::Count).unwrap_or(0u64);
        let id = count + 1;
        let current = env.ledger().sequence();

        let will = Will {
            id,
            owner: owner.clone(),
            beneficiary: beneficiary.clone(),
            title,
            note,
            balance: amount,
            check_interval,
            last_ping: current,
            deadline: current + check_interval,
            status: WillStatus::Active,
            created_at: current,
            ping_count: 0,
        };

        env.storage().persistent().set(&DataKey::Will(id), &will);
        env.storage().instance().set(&DataKey::Count, &id);

        let mut o_wills: soroban_sdk::Vec<u64> = env.storage().persistent()
            .get(&DataKey::OwnerWills(owner.clone())).unwrap_or(soroban_sdk::Vec::new(&env));
        o_wills.push_back(id);
        env.storage().persistent().set(&DataKey::OwnerWills(owner.clone()), &o_wills);

        let mut b_wills: soroban_sdk::Vec<u64> = env.storage().persistent()
            .get(&DataKey::BeneficiaryWills(beneficiary.clone())).unwrap_or(soroban_sdk::Vec::new(&env));
        b_wills.push_back(id);
        env.storage().persistent().set(&DataKey::BeneficiaryWills(beneficiary.clone()), &b_wills);

        env.events().publish((symbol_short!("created"),), (id, owner, beneficiary, amount));
        id
    }

    /// Owner pings to reset the countdown — proves they are alive
    pub fn ping(env: Env, owner: Address, will_id: u64) {
        owner.require_auth();

        let mut will: Will = env.storage().persistent()
            .get(&DataKey::Will(will_id)).expect("Not found");

        assert!(will.owner == owner, "Not the owner");
        assert!(will.status == WillStatus::Active, "Will not active");

        let current = env.ledger().sequence();
        will.last_ping  = current;
        will.deadline   = current + will.check_interval;
        will.ping_count += 1;

        env.storage().persistent().set(&DataKey::Will(will_id), &will);
        env.events().publish((symbol_short!("ping"),), (will_id, owner, will.deadline));
    }

    /// Owner tops up the balance
    pub fn top_up(env: Env, owner: Address, will_id: u64, amount: i128, xlm_token: Address) {
        owner.require_auth();

        let mut will: Will = env.storage().persistent()
            .get(&DataKey::Will(will_id)).expect("Not found");

        assert!(will.owner == owner, "Not the owner");
        assert!(will.status == WillStatus::Active, "Not active");
        assert!(amount > 0, "Amount must be positive");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        will.balance += amount;
        env.storage().persistent().set(&DataKey::Will(will_id), &will);
    }

    /// Owner revokes will — withdraws all funds
    pub fn revoke(env: Env, owner: Address, will_id: u64, xlm_token: Address) {
        owner.require_auth();

        let mut will: Will = env.storage().persistent()
            .get(&DataKey::Will(will_id)).expect("Not found");

        assert!(will.owner == owner, "Not the owner");
        assert!(will.status == WillStatus::Active, "Not active");

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &owner, &will.balance);

        will.status  = WillStatus::Revoked;
        will.balance = 0;
        env.storage().persistent().set(&DataKey::Will(will_id), &will);
        env.events().publish((symbol_short!("revoked"),), (will_id,));
    }

    /// Beneficiary claims after the owner missed their check-in deadline
    pub fn claim(env: Env, beneficiary: Address, will_id: u64, xlm_token: Address) {
        beneficiary.require_auth();

        let mut will: Will = env.storage().persistent()
            .get(&DataKey::Will(will_id)).expect("Not found");

        assert!(will.beneficiary == beneficiary, "Not the beneficiary");
        assert!(
            will.status == WillStatus::Active || will.status == WillStatus::Triggered,
            "Not claimable"
        );
        assert!(
            env.ledger().sequence() > will.deadline,
            "Owner's check-in deadline has not passed yet"
        );

        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(&env.current_contract_address(), &beneficiary, &will.balance);

        will.status  = WillStatus::Claimed;
        will.balance = 0;
        env.storage().persistent().set(&DataKey::Will(will_id), &will);
        env.events().publish((symbol_short!("claimed"),), (will_id, beneficiary, will.balance));
    }

    // ── Reads ──────────────────────────────────────────────────────────────
    pub fn get_will(env: Env, will_id: u64) -> Will {
        env.storage().persistent().get(&DataKey::Will(will_id)).expect("Not found")
    }

    pub fn get_owner_wills(env: Env, owner: Address) -> soroban_sdk::Vec<u64> {
        env.storage().persistent()
            .get(&DataKey::OwnerWills(owner))
            .unwrap_or(soroban_sdk::Vec::new(&env))
    }

    pub fn get_beneficiary_wills(env: Env, beneficiary: Address) -> soroban_sdk::Vec<u64> {
        env.storage().persistent()
            .get(&DataKey::BeneficiaryWills(beneficiary))
            .unwrap_or(soroban_sdk::Vec::new(&env))
    }

    pub fn count(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// Ledgers until claim becomes available (0 = claimable now)
    pub fn time_until_claimable(env: Env, will_id: u64) -> u32 {
        let will: Will = env.storage().persistent()
            .get(&DataKey::Will(will_id)).expect("Not found");
        let current = env.ledger().sequence();
        if current > will.deadline { 0 } else { will.deadline - current }
    }
}
