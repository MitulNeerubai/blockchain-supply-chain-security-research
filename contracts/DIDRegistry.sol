// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DIDRegistry {
struct DIDDocument {
address owner;
string publicKey;
uint256 created;
uint256 updated;
bool active;
}

mapping(string => DIDDocument) private didDocuments;
mapping(address => string) private ownerToDID;

event DIDRegistered(string indexed did, address indexed owner);
event DIDUpdated(string indexed did);
event DIDDeactivated(string indexed did);

function registerDID(string memory did, string memory publicKey) external {
require(bytes(did).length > 0, "DID cannot be empty");
require(didDocuments[did].owner == address(0), "DID already registered");
didDocuments[did] = DIDDocument({
owner: msg.sender,
publicKey: publicKey,
created: block.timestamp,
updated: block.timestamp,
active: true
});
ownerToDID[msg.sender] = did;
emit DIDRegistered(did, msg.sender);
}

function resolveDID(string memory did) external view returns (address owner, string memory publicKey, bool active) {
DIDDocument memory doc = didDocuments[did];
require(doc.owner != address(0), "DID not found");
return (doc.owner, doc.publicKey, doc.active);
}

function updatepublicKey(string memory did, string memory newpublicKey) external {
require(didDocuments[did].owner == msg.sender, "Not DID owner");
require(didDocuments[did].active, "DID is deactivated");
didDocuments[did].publicKey = newpublicKey;
didDocuments[did].updated = block.timestamp;
emit DIDUpdated(did);
}

function deactivateDID(string memory did) external {
require(didDocuments[did].owner == msg.sender, "Not DID owner");
didDocuments[did].active = false;
emit DIDDeactivated(did);
}

function isActiveDID(string memory did) external view returns (bool) {
return didDocuments[did].active;
}

function getDIDByOwner(address owner) external view returns (string memory) {
return ownerToDID[owner];
}
}
