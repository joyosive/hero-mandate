// VENDORED REFERENCE from the Hero fleet demo (primitive 1, Arbitrum Sepolia).
// This is the working Fhenix CoFHE integration: authority enforced on ENCRYPTED
// values via homomorphic comparison, branchless FHE.select budget updates, and
// public proof anchoring through HeroProofAnchor.
//
// STATUS IN HERO MANDATE: reference and roadmap. The Stylus mandate contract
// uses merkle scope commitments today; encrypted numeric limits land when the
// CoFHE coprocessor is available on the target chains. Nothing in this file is
// deployed from this repo.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {FHE, euint32, ebool, InEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {HeroProofAnchor} from "./HeroProofAnchor.sol";

/// @title ConfidentialAuthority
/// @notice Hero L3+ : enforce an autonomous agent's authority on ENCRYPTED data and
///         anchor a public proof-of-action — without revealing the authority or the
///         action. Verifiable (anchored on Arbitrum, via HeroProofAnchor) AND
///         confidential (enforced on ciphertext via Fhenix CoFHE).
/// @dev    The "within authority" check is a homomorphic comparison that returns an
///         encrypted boolean; it never branches and never reverts. The remaining
///         authority is updated branchlessly with FHE.select, so an over-authority
///         action is a silent no-op on the budget and leaks nothing. The public
///         record (the anchored proof root) proves an action happened; the authority
///         and the action magnitude stay encrypted.
///
///         Authorization: each agent is keyed by keccak256(operator, agentId), so an
///         agent belongs to the operator that granted it. Only that operator can
///         `act` or `revoke` for it (the key derives from msg.sender), and two
///         operators cannot collide on the same agentId. This closes the "anyone can
///         act for any agent" and "agent-id squatting" holes. A separate delegated
///         agent key (machine acts on the operator's behalf) is a natural next step.
contract ConfidentialAuthority {
    /// @notice The neutral, public anchor this contract records proofs through.
    HeroProofAnchor public immutable anchor;

    struct Agent {
        address operator;   // who granted the authority (0 == unregistered)
        euint32 remaining;  // ENCRYPTED remaining authority / budget
        uint64  actionCount;
    }

    mapping(bytes32 => Agent) private _agents;          // key = _key(operator, agentId)
    mapping(bytes32 => ebool) private _withinAuthority; // proofRoot -> encrypted compliance flag

    event AuthorityGranted(bytes32 indexed agentId, address indexed operator);
    event AuthorityRevoked(bytes32 indexed agentId, address indexed operator);
    event ActionAnchored(bytes32 indexed agentId, bytes32 indexed proofRoot, uint64 sequence, uint64 timestamp);

    error AgentExists(bytes32 agentId);
    error AgentUnknown(bytes32 agentId);

    constructor(HeroProofAnchor anchor_) {
        anchor = anchor_;
    }

    /// @dev An agent belongs to (operator, agentId). Deriving the storage key from the
    ///      caller is what enforces authorization on state-changing calls.
    function _key(address operator, bytes32 agentId) internal pure returns (bytes32) {
        return keccak256(abi.encode(operator, agentId));
    }

    /// @notice Register an agent with an ENCRYPTED authority (e.g. a spend/quota limit).
    ///         The agent is scoped to msg.sender (the operator); other operators can use
    ///         the same agentId label without collision.
    /// @param agentId  Operator-scoped identifier for the autonomous agent/machine.
    /// @param encLimit Proof-backed encrypted limit submitted by the operator.
    function grantAuthority(bytes32 agentId, InEuint32 calldata encLimit) external {
        bytes32 k = _key(msg.sender, agentId);
        if (_agents[k].operator != address(0)) revert AgentExists(agentId);

        euint32 limit = FHE.asEuint32(encLimit);
        FHE.allowThis(limit);        // persist this contract's access to the ciphertext
        FHE.allowSender(limit);      // operator can decrypt/audit off-chain via permit

        _agents[k] = Agent({operator: msg.sender, remaining: limit, actionCount: 0});
        emit AuthorityGranted(agentId, msg.sender);
    }

    /// @notice The operator's agent acts. Prove the action is within its ENCRYPTED
    ///         authority on ciphertext, decrement the encrypted remaining, and anchor a
    ///         public proof. Only the operator that granted the agent can call this —
    ///         the (operator, agentId) key derives from msg.sender.
    /// @param agentId   The acting agent (operator-scoped).
    /// @param encAmount Proof-backed encrypted magnitude of the action (e.g. spend).
    /// @param proofRoot Public hash committing to the off-chain action record (L1 root).
    function act(bytes32 agentId, InEuint32 calldata encAmount, bytes32 proofRoot) external {
        bytes32 k = _key(msg.sender, agentId);
        Agent storage a = _agents[k];
        if (a.operator == address(0)) revert AgentUnknown(agentId);

        euint32 amount = FHE.asEuint32(encAmount);
        euint32 rem = a.remaining;

        ebool within = FHE.lte(amount, rem);                          // encrypted compare
        euint32 newRem = FHE.select(within, FHE.sub(rem, amount), rem); // branchless update
        a.remaining = newRem;

        FHE.allowThis(newRem);          // REQUIRED after every mutation (new handle)
        FHE.allow(newRem, a.operator);  // operator can read remaining off-chain

        FHE.allowThis(within);
        FHE.allow(within, a.operator);  // operator can audit pass/fail
        FHE.allowSender(within);        // acting operator can read its own pass/fail
        _withinAuthority[proofRoot] = within;

        uint64 seq = a.actionCount;
        a.actionCount = seq + 1;

        // Anchor the public proof. If the root was already anchored (e.g. an
        // attacker pre-anchored it to try to block this action), swallow the
        // revert: the confidential decrement + attestation above still stand and
        // the root is on-chain regardless. Prevents a permissionless-anchor DoS.
        try anchor.anchor(proofRoot) {} catch {}
        emit ActionAnchored(agentId, proofRoot, seq, uint64(block.timestamp));
    }

    /// @notice Revoke an agent's authority by zeroing its encrypted remaining. Only the
    ///         operator that granted it can revoke (the key derives from msg.sender).
    function revokeAuthority(bytes32 agentId) external {
        bytes32 k = _key(msg.sender, agentId);
        Agent storage a = _agents[k];
        if (a.operator == address(0)) revert AgentUnknown(agentId);

        euint32 zero = FHE.asEuint32(uint256(0));
        FHE.allowThis(zero);
        FHE.allow(zero, a.operator);
        a.remaining = zero;
        emit AuthorityRevoked(agentId, msg.sender);
    }

    // --------------------------------------------------------------------- views

    /// @notice Public, neutral check that an action's proof was anchored on Arbitrum.
    function verifyAction(bytes32 proofRoot)
        external
        view
        returns (bool anchored, uint64 timestamp, address submitter)
    {
        return anchor.verify(proofRoot);
    }

    /// @notice ENCRYPTED remaining authority for (operator, agentId). Decrypt off-chain via permit.
    function remainingAuthority(address operator, bytes32 agentId) external view returns (euint32) {
        return _agents[_key(operator, agentId)].remaining;
    }

    /// @notice ENCRYPTED compliance flag for an anchored action. Operator can unseal it.
    function wasWithinAuthority(bytes32 proofRoot) external view returns (ebool) {
        return _withinAuthority[proofRoot];
    }

    /// @notice Public metadata for an agent (no secrets).
    function agentInfo(address operator, bytes32 agentId) external view returns (address op, uint64 actionCount) {
        Agent storage a = _agents[_key(operator, agentId)];
        return (a.operator, a.actionCount);
    }
}
