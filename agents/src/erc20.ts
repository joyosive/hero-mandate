// Minimal ERC20 helpers (ethers v6) plus a deployable fixed-supply demo
// token for the real settlement demo. No solc lives in this repo, so the
// token is precompiled and its creation bytecode embedded below, with the
// full source in the comment so the deployment stays auditable.

import { Contract, ContractRunner, InterfaceAbi, MaxUint256, Wallet } from "ethers";

// ---------------------------------------------------------------- helpers

export const ERC20_ABI: InterfaceAbi = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

export function erc20(address: string, runner: ContractRunner): Contract {
  return new Contract(address, ERC20_ABI, runner);
}

export async function balanceOf(token: string, holder: string, runner: ContractRunner): Promise<bigint> {
  return BigInt(await erc20(token, runner).getFunction("balanceOf")(holder));
}

export async function decimals(token: string, runner: ContractRunner): Promise<number> {
  return Number(await erc20(token, runner).getFunction("decimals")());
}

export async function allowance(token: string, owner: string, spender: string, runner: ContractRunner): Promise<bigint> {
  return BigInt(await erc20(token, runner).getFunction("allowance")(owner, spender));
}

/** Max approval from `wallet` to `spender`. Returns the tx hash. */
export async function approveMax(token: string, spender: string, wallet: Wallet): Promise<string> {
  const tx = await erc20(token, wallet).getFunction("approve")(spender, MaxUint256);
  await tx.wait();
  return String(tx.hash);
}

/** Plain transfer from `wallet` to `to`. Returns the tx hash. */
export async function transfer(token: string, to: string, amount: bigint, wallet: Wallet): Promise<string> {
  const tx = await erc20(token, wallet).getFunction("transfer")(to, amount);
  await tx.wait();
  return String(tx.hash);
}

// ---------------------------------------------------------------- demo token

// HeroDemoUSD: name "Hero Demo USD", symbol "hUSD", 6 decimals, fixed supply
// of 1,000,000 hUSD minted to the deployer at construction. Compiled with
// solc 0.8.24, optimizer 200 runs, metadata hash stripped (bytecode_hash =
// "none", cbor_metadata = false) so the bytecode below is reproducible.
//
// Source, verbatim:
//
//   // SPDX-License-Identifier: MIT
//   pragma solidity 0.8.24;
//
//   contract HeroDemoUSD {
//       string public constant name = "Hero Demo USD";
//       string public constant symbol = "hUSD";
//       uint8 public constant decimals = 6;
//       uint256 public constant totalSupply = 1_000_000 * 10 ** 6;
//
//       mapping(address => uint256) public balanceOf;
//       mapping(address => mapping(address => uint256)) public allowance;
//
//       event Transfer(address indexed from, address indexed to, uint256 value);
//       event Approval(address indexed owner, address indexed spender, uint256 value);
//
//       constructor() {
//           balanceOf[msg.sender] = totalSupply;
//           emit Transfer(address(0), msg.sender, totalSupply);
//       }
//
//       function transfer(address to, uint256 value) external returns (bool) {
//           return _move(msg.sender, to, value);
//       }
//
//       function approve(address spender, uint256 value) external returns (bool) {
//           allowance[msg.sender][spender] = value;
//           emit Approval(msg.sender, spender, value);
//           return true;
//       }
//
//       function transferFrom(address from, address to, uint256 value) external returns (bool) {
//           uint256 allowed = allowance[from][msg.sender];
//           if (allowed != type(uint256).max) {
//               require(allowed >= value, "allowance");
//               allowance[from][msg.sender] = allowed - value;
//           }
//           return _move(from, to, value);
//       }
//
//       function _move(address from, address to, uint256 value) internal returns (bool) {
//           require(balanceOf[from] >= value, "balance");
//           balanceOf[from] -= value;
//           balanceOf[to] += value;
//           emit Transfer(from, to, value);
//           return true;
//       }
//   }

export const HERO_DEMO_USD = {
  name: "Hero Demo USD",
  symbol: "hUSD",
  decimals: 6,
  totalSupply: 1_000_000_000_000n, // 1,000,000 hUSD at 6 decimals
} as const;

export const HERO_DEMO_USD_BYTECODE =
  "0x608060405234801561000f575f80fd5b50335f8181526020818152604080832064e8d4a510009081905590519081527fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef910160405180910390a361053a806100665f395ff3fe608060405234801561000f575f80fd5b5060043610610090575f3560e01c8063313ce56711610063578063313ce5671461012657806370a082311461014057806395d89b411461015f578063a9059cbb14610182578063dd62ed3e14610195575f80fd5b806306fdde0314610094578063095ea7b3146100d657806318160ddd146100f957806323b872dd14610113575b5f80fd5b6100c06040518060400160405280600d81526020016c12195c9bc811195b5bc81554d1609a1b81525081565b6040516100cd91906103ee565b60405180910390f35b6100e96100e4366004610455565b6101bf565b60405190151581526020016100cd565b61010564e8d4a5100081565b6040519081526020016100cd565b6100e961012136600461047d565b61022b565b61012e600681565b60405160ff90911681526020016100cd565b61010561014e3660046104b6565b5f6020819052908152604090205481565b6100c0604051806040016040528060048152602001631a1554d160e21b81525081565b6100e9610190366004610455565b6102d9565b6101056101a33660046104cf565b600160209081525f928352604080842090915290825290205481565b335f8181526001602090815260408083206001600160a01b038716808552925280832085905551919290917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925906102199086815260200190565b60405180910390a35060015b92915050565b6001600160a01b0383165f9081526001602090815260408083203384529091528120545f1981146102c557828110156102975760405162461bcd60e51b8152602060048201526009602482015268616c6c6f77616e636560b81b60448201526064015b60405180910390fd5b6102a18382610514565b6001600160a01b0386165f9081526001602090815260408083203384529091529020555b6102d08585856102ec565b95945050505050565b5f6102e53384846102ec565b9392505050565b6001600160a01b0383165f9081526020819052604081205482111561033d5760405162461bcd60e51b815260206004820152600760248201526662616c616e636560c81b604482015260640161028e565b6001600160a01b0384165f9081526020819052604081208054849290610364908490610514565b90915550506001600160a01b0383165f9081526020819052604081208054849290610390908490610527565b92505081905550826001600160a01b0316846001600160a01b03167fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef846040516103dc91815260200190565b60405180910390a35060019392505050565b5f602080835283518060208501525f5b8181101561041a578581018301518582016040015282016103fe565b505f604082860101526040601f19601f8301168501019250505092915050565b80356001600160a01b0381168114610450575f80fd5b919050565b5f8060408385031215610466575f80fd5b61046f8361043a565b946020939093013593505050565b5f805f6060848603121561048f575f80fd5b6104988461043a565b92506104a66020850161043a565b9150604084013590509250925092565b5f602082840312156104c6575f80fd5b6102e58261043a565b5f80604083850312156104e0575f80fd5b6104e98361043a565b91506104f76020840161043a565b90509250929050565b634e487b7160e01b5f52601160045260245ffd5b8181038181111561022557610225610500565b808201808211156102255761022561050056";

/** Deploy HeroDemoUSD; the full fixed supply lands on the deployer. */
export async function deployHeroDemoUSD(deployer: Wallet): Promise<{ address: string; txHash: string }> {
  const tx = await deployer.sendTransaction({ data: HERO_DEMO_USD_BYTECODE });
  const receipt = await tx.wait();
  if (!receipt?.contractAddress) throw new Error("hUSD deployment returned no contract address");
  return { address: receipt.contractAddress, txHash: tx.hash };
}
