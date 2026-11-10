import { ethers } from "ethers";

export const ADDRESSES = {
  TrustRegistry:      "0x0A4502802C243e7C6f464BFDf1D967ec5Ad042d2",
  AuditLog:           "0x6784193B5FF7C8f2733Ee80C4c1bE22B4bF49B85",
  DIDRegistry:        "0x3559e6f0D6721eA20De0cD5B9cbA7929838aAe24",
  CredentialRegistry: "0x635d0cA791d1BEA4471FDd10F276693fC1c8EF6f",
  ProductTransfer:    "0x6d1b146f301bc83E1362d29797b8b1c396132Ca1",
};

export const ABIS = {
  TrustRegistry: [
    "function authorizeIssuer(address issuer, string name) external",
    "function revokeIssuer(address issuer) external",
    "function isAuthorizedIssuer(address issuer) view returns (bool)",
  ],
  DIDRegistry: [
    "function registerDID(string name) external",
    "function getDID(address addr) view returns (string)",
  ],
  CredentialRegistry: [
    "function issueCredential(address holder, string credType, uint256 validDays) external returns (bytes32)",
    "function verifyCredential(bytes32 credId, address holder, string credType, uint256 productId) view returns (bool, string)",
    "event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed holder, string credentialType)",
  ],
  ProductTransfer: [
    "function createProduct(string name, bytes32 mfCredId) external returns (uint256)",
    "function commitTransfer(uint256 productId, bytes32 secretHash, address recipient, bytes32 transferCredId) external",
    "function claimTransfer(uint256 productId, string secret) external",
    "function getProduct(uint256 productId) view returns (tuple(uint256 id, string name, address manufacturer, address currentHolder, uint8 status, uint256 createdAt, bytes32 manufacturingCredId, bytes32 secretHash, address pendingRecipient, bytes32 transferCredId))",
    "function getTransferHistory(uint256 productId) view returns (tuple(address from, address to, uint256 timestamp, string action)[])",
    "function totalProducts() view returns (uint256)",
    "event ProductCreated(uint256 indexed productId, address indexed manufacturer, string name)",
  ],
};

export const BESU_NETWORK = {
  chainId: "0x3da55",
  chainName: "DIDLab Besu",
  rpcUrls: ["https://eth.didlab.org"],
  nativeCurrency: { name: "TRUST", symbol: "TRUST", decimals: 18 },
};

export function getContract(name, signer) {
  return new ethers.Contract(ADDRESSES[name], ABIS[name], signer);
}
