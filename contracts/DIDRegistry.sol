// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Strings.sol";
import "./TrustRegistry.sol";
import "./AuditLog.sol";

/// @title DIDRegistry — on-chain identities with a unique company name
/// @notice Every participant (LocalGovt, Manufacturer, Distributor, Retailer)
///         self-registers one DID. The company name is stored on-chain and is
///         unique (case-insensitive), so no two wallets can use the same name.
contract DIDRegistry {
    TrustRegistry public immutable trustRegistry;
    AuditLog      public immutable auditLog;

    struct DIDDocument {
        string  did;
        string  role;
        string  companyName;
        address controller;
        uint256 createdAt;
        bool    active;
    }

    mapping(address => DIDDocument) private _docs;
    mapping(string  => address)     public didToAddress;
    /// keccak256(lowercase(companyName)) => owner. Names stay reserved after deactivation.
    mapping(bytes32 => address)     public nameOwner;
    address[] private _controllers;

    event DIDRegistered(address indexed controller, string did, string role, string companyName, uint256 timestamp);
    event DIDDeactivated(address indexed controller, string did, uint256 timestamp);

    constructor(address _trustRegistry, address _auditLog) {
        trustRegistry = TrustRegistry(_trustRegistry);
        auditLog      = AuditLog(_auditLog);
    }

    // ── Registration ────────────────────────────────────────────────────────
    function registerDID(string calldata role, string calldata companyName) external {
        require(bytes(_docs[msg.sender].did).length == 0, "DIDRegistry: already registered");
        require(msg.sender != trustRegistry.rootGA(), "DIDRegistry: rootGA does not register a DID");
        require(isValidRole(role), "DIDRegistry: invalid role");
        _validateName(companyName);

        bytes32 key = nameKey(companyName);
        require(nameOwner[key] == address(0), "DIDRegistry: company name already taken");

        string memory did = string.concat("did:besu:", Strings.toHexString(msg.sender));
        _docs[msg.sender] = DIDDocument({
            did: did, role: role, companyName: companyName,
            controller: msg.sender, createdAt: block.timestamp, active: true
        });
        didToAddress[did] = msg.sender;
        nameOwner[key]    = msg.sender;
        _controllers.push(msg.sender);

        auditLog.logAction(msg.sender, "DID_REGISTERED", string.concat("role=", role, " company=", companyName));
        emit DIDRegistered(msg.sender, did, role, companyName, block.timestamp);
    }

    function deactivateDID() external {
        DIDDocument storage doc = _docs[msg.sender];
        require(bytes(doc.did).length > 0, "DIDRegistry: no DID for this address");
        require(doc.active, "DIDRegistry: already deactivated");
        doc.active = false;
        auditLog.logAction(msg.sender, "DID_DEACTIVATED", string.concat("did=", doc.did));
        emit DIDDeactivated(msg.sender, doc.did, block.timestamp);
    }

    // ── Views ───────────────────────────────────────────────────────────────
    function getDID(address controller) external view returns (DIDDocument memory) { return _docs[controller]; }

    function isActiveDID(address controller) public view returns (bool) {
        DIDDocument storage doc = _docs[controller];
        return bytes(doc.did).length > 0 && doc.active;
    }

    function getRole(address controller) external view returns (string memory) { return _docs[controller].role; }
    function getCompanyName(address controller) external view returns (string memory) { return _docs[controller].companyName; }

    /// @notice True if the wallet has an active DID with exactly this role.
    function hasRole(address controller, string memory role) public view returns (bool) {
        return isActiveDID(controller) && _eq(_docs[controller].role, role);
    }

    function isNameAvailable(string calldata companyName) external view returns (bool) {
        return nameOwner[nameKey(companyName)] == address(0);
    }

    function totalDIDs() external view returns (uint256) { return _controllers.length; }
    function getControllers() external view returns (address[] memory) { return _controllers; }

    /// @notice Full directory — used by the UI to show company names everywhere.
    function getAllDIDs() external view returns (DIDDocument[] memory out) {
        out = new DIDDocument[](_controllers.length);
        for (uint256 i = 0; i < _controllers.length; i++) out[i] = _docs[_controllers[i]];
    }

    function isValidRole(string memory role) public pure returns (bool) {
        return _eq(role, "LocalGovt") || _eq(role, "Manufacturer") || _eq(role, "Distributor") || _eq(role, "Retailer");
    }

    /// @notice Case-insensitive key for a company name (ASCII A-Z folded to a-z).
    function nameKey(string memory name) public pure returns (bytes32) {
        bytes memory b = bytes(name);
        bytes memory lower = new bytes(b.length);
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            lower[i] = (c >= 0x41 && c <= 0x5A) ? bytes1(uint8(c) + 32) : c;
        }
        return keccak256(lower);
    }

    // ── Internal ────────────────────────────────────────────────────────────
    function _validateName(string calldata name) internal pure {
        bytes memory b = bytes(name);
        require(b.length >= 2 && b.length <= 64, "DIDRegistry: company name must be 2-64 characters");
        require(b[0] != 0x20 && b[b.length - 1] != 0x20, "DIDRegistry: company name has leading or trailing spaces");
    }

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
