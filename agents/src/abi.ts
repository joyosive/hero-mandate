// HeroMandate contract interface. Keep in lockstep with the Stylus contract.

export const HERO_MANDATE_ABI = [
  "function createMandate(address agent, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash) payable returns (uint256)",
  "function delegate(uint256 parentId, address agent, uint256 amount, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash) returns (uint256)",
  "function execute(uint256 id, bytes32 instrument, uint256 amount, bytes32[][] proofs) returns (bool)",
  "function getMandate(uint256 id) view returns (uint256 parentId, address agent, uint256 remaining, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash, bytes32 receiptHead, uint64 breaches)",
  "function mandateCount() view returns (uint256)",
  "event MandateCreated(uint256 indexed id, address indexed agent, uint256 capacity, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash)",
  "event Delegated(uint256 indexed parentId, uint256 indexed childId, address indexed agent, uint256 amount, uint64 expiry, bytes32 scopeRoot, bytes32 modelHash)",
  "event Executed(uint256 indexed id, bytes32 indexed instrument, uint256 amount, bytes32 newHead, uint64 timestamp)",
  "event Breach(uint256 indexed id, uint8 code, bytes32 instrument, uint256 amount)",
] as const;
