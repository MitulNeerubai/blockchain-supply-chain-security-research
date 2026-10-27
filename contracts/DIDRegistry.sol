// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TrustRegistry.sol";
import "./AuditLog.sol";

contract DIDRegistry {
    TrustRegistry public immutable trustRegistry;
    AuditLog      public immutable auditLog;

    struct DIDDocument {
        string  did;
        string  role;
        address controller;
        uint256 createdAt;
        bool    active;
    }

    mapping(address => DIDDocument) public didDocuments;
    mapping(string => address) public didToAddress;

    event DIDRegistered(address indexed controller, string did, string role, uint256 timestamp);
    event DIDDeactivated(address indexed controller, string did, uint256 timestamp);

    constructor(address _trustRegistry, address _auditLog) {
        trustRegistry = TrustRegistry(_trustRegistry);
        auditLog      = AuditLog(_auditLog);
    }

    function registerDID(string calldata role) external {
        require(bytes(didDocuments[msg.sender].did).length == 0, "DIDRegistry: already registered");
        string memory did = _buildDID(msg.sender);
        didDocuments[msg.sender] = DIDDocument({ did: did, role: role, controller: msg.sender, createdAt: block.timestamp, active: true });
        didToAddress[did] = msg.sender;
        auditLog.logAction(msg.sender, "DID_REGISTERED", string(abi.encodePacked("role=", role)));
        emit DIDRegistered(msg.sender, did, role, block.timestamp);
   }

    function deactivateDID() external {
        DIDDocument storage doc = didDocuments[msg.sender];
        require(bytes(doc.did).length > 0, "DIDRegistry: no DID for this address");
        require(doc.active, "DIDRegistry: already deactivated");
        doc.active = false;
        auditLog.logAction(msg.sender, "DID_DEACTIVATED", string(abi.encodePacked("did=", doc.did)));
        emit DIDDeactivated(msg.sender, doc.did, block.timestamp);
    }

    function getDID(address controller) external view returns (DIDDocument memory) { return didDocuments[controller]; }
    function isActiveDID(address controller) external view returns (bool) {
        DIDDocument storage doc = didDocuments[controller];
        return bytes(doc.did).length > 0 && doc.active;
    }
    function getDocument(address controller) external view returns (DIDDocument memory) { return didDocuments[controller]; }

    function _buildDID(address addr) internal pure returns (string memory) {
        return string(abi.encodePacked("did:besu:", _toHexString(addr)));
    }
    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory buffer = new bytes(42);
        buffer[0] = '0'; buffer[1] = 'x';
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(uint160(addr) >> (8 * (19 - i)));
            buffer[2 + i * 2] = _hexChar(b >> 4);
            buffer[2 + i * 2 + 1] = _hexChar(b & 0x0f);
        }
        return string(buffer);
    }
    function _hexChar(uint8 v) internal pure returns (bytes1) {
        if (v < 10) return bytes1(uint8(48 + v));
        return bytes1(uint8(87 + v));
    }
}
