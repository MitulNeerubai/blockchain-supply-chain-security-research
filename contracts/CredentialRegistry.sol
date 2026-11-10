// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Strings.sol";
import "./TrustRegistry.sol";
import "./DIDRegistry.sol";
import "./AuditLog.sol";

/// @title CredentialRegistry — the licence chain
/// @notice Who may licence whom is fixed by role:
///           rootGA ──(TrustRegistry)──▶ LocalGovt
///           LocalGovt    ──ManufacturingLicense──▶ Manufacturer
///           Manufacturer ──TradeLicense──────────▶ Distributor
///           Distributor  ──TradeLicense──────────▶ Retailer
///         A credential is only valid while its issuer is still trusted
///         (cascading revocation): revoking an LG suspends its Manufacturers,
///         their Distributors and their Retailers.
///         Each wallet holds at most one live credential; issuing a new one
///         supersedes (revokes) any older one.
contract CredentialRegistry {
    struct Credential {
        bytes32 id;
        address issuer;
        address holder;
        string  credType;
        uint256 issuedAt;
        uint256 expiresAt;
        bool    revoked;
    }

    string public constant MANUFACTURING_LICENSE = "ManufacturingLicense";
    string public constant TRADE_LICENSE         = "TradeLicense";

    TrustRegistry public immutable trustRegistry;
    DIDRegistry   public immutable didRegistry;
    AuditLog      public immutable auditLog;

    mapping(bytes32 => Credential) private _creds;
    mapping(address => bytes32[])  private _byIssuer;
    mapping(address => bytes32[])  private _byHolder;
    uint256 private _nonce;

    event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed holder, string credType, uint256 expiresAt);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, address indexed holder);

    constructor(address _trustRegistry, address _didRegistry, address _auditLog) {
        trustRegistry = TrustRegistry(_trustRegistry);
        didRegistry   = DIDRegistry(_didRegistry);
        auditLog      = AuditLog(_auditLog);
    }

    // ── Issue / revoke ──────────────────────────────────────────────────────
    /// @param holder     wallet to licence (its role decides the licence type)
    /// @param expiresAt  unix timestamp, must be in the future
    function issueCredential(address holder, uint256 expiresAt) external returns (bytes32 credentialId) {
        require(holder != msg.sender, "CredentialRegistry: cannot licence yourself");
        require(expiresAt > block.timestamp, "CredentialRegistry: expiry must be in the future");
        require(didRegistry.isActiveDID(msg.sender), "CredentialRegistry: issuer does not have an active DID");
        require(didRegistry.isActiveDID(holder), "CredentialRegistry: holder does not have an active DID");

        string memory credType = _licenceTypeFor(msg.sender, holder);
        require(activeCredentialOf(holder) == bytes32(0), "CredentialRegistry: holder already has an active licence. Revoke it first.");

        // Supersede any stale (suspended/expired but not revoked) credentials.
        bytes32[] storage old = _byHolder[holder];
        for (uint256 i = 0; i < old.length; i++) {
            if (!_creds[old[i]].revoked) {
                _creds[old[i]].revoked = true;
                emit CredentialRevoked(old[i], msg.sender, holder);
            }
        }

        credentialId = keccak256(abi.encodePacked(msg.sender, holder, credType, _nonce++, block.timestamp));
        _creds[credentialId] = Credential({
            id: credentialId, issuer: msg.sender, holder: holder, credType: credType,
            issuedAt: block.timestamp, expiresAt: expiresAt, revoked: false
        });
        _byIssuer[msg.sender].push(credentialId);
        _byHolder[holder].push(credentialId);

        auditLog.logAction(msg.sender, "CREDENTIAL_ISSUED",
            string.concat("credId=", Strings.toHexString(uint256(credentialId), 32), " type=", credType, " holder=", Strings.toHexString(holder)));
        emit CredentialIssued(credentialId, msg.sender, holder, credType, expiresAt);
    }

    function revokeCredential(bytes32 credentialId) external {
        Credential storage c = _creds[credentialId];
        require(c.issuer != address(0), "CredentialRegistry: credential does not exist");
        require(c.issuer == msg.sender, "CredentialRegistry: only issuer can revoke");
        require(!c.revoked, "CredentialRegistry: already revoked");
        c.revoked = true;
        auditLog.logAction(msg.sender, "CREDENTIAL_REVOKED", string.concat("credId=", Strings.toHexString(uint256(credentialId), 32)));
        emit CredentialRevoked(credentialId, msg.sender, c.holder);
    }

    // ── Validity ────────────────────────────────────────────────────────────
    /// @notice True if this credential is live: not revoked/expired, both DIDs
    ///         active, and the issuer is itself still trusted (recursively).
    function isCredentialActive(bytes32 credentialId) public view returns (bool) {
        Credential storage c = _creds[credentialId];
        if (c.issuer == address(0) || c.revoked) return false;
        if (block.timestamp > c.expiresAt) return false;
        if (!didRegistry.isActiveDID(c.holder) || !didRegistry.isActiveDID(c.issuer)) return false;
        return _issuerTrusted(c.issuer);
    }

    /// @notice Latest live credential of a holder, or 0x0.
    function activeCredentialOf(address holder) public view returns (bytes32) {
        bytes32[] storage ids = _byHolder[holder];
        for (uint256 i = ids.length; i > 0; i--) {
            if (isCredentialActive(ids[i - 1])) return ids[i - 1];
        }
        return bytes32(0);
    }

    function isCredentialValid(address holder) public view returns (bool) {
        return activeCredentialOf(holder) != bytes32(0);
    }

    /// @notice Who licensed this holder (issuer of the live credential), or 0x0.
    ///         ProductTransfer only lets you ship to wallets you licensed.
    function licensedBy(address holder) external view returns (address) {
        bytes32 id = activeCredentialOf(holder);
        return id == bytes32(0) ? address(0) : _creds[id].issuer;
    }

    /// @notice Detailed check with a human-readable failure reason.
    function verifyCredential(bytes32 credentialId, address expectedHolder, string calldata expectedType)
        external view returns (bool valid, string memory reason)
    {
        Credential storage c = _creds[credentialId];
        if (c.issuer == address(0))                       return (false, "CHECK1_FAIL: credential does not exist");
        if (c.revoked)                                    return (false, "CHECK2_FAIL: credential has been revoked");
        if (block.timestamp > c.expiresAt)                return (false, "CHECK3_FAIL: credential has expired");
        if (!didRegistry.isActiveDID(c.issuer))           return (false, "CHECK4_FAIL: issuer DID has been deactivated");
        if (!didRegistry.isActiveDID(c.holder))           return (false, "CHECK5_FAIL: holder DID has been deactivated");
        if (!_issuerTrusted(c.issuer))                    return (false, "CHECK6_FAIL: issuer is no longer trusted (cascading revocation)");
        if (bytes(expectedType).length > 0 && keccak256(bytes(c.credType)) != keccak256(bytes(expectedType)))
                                                          return (false, "CHECK7_FAIL: credential type mismatch");
        if (expectedHolder != address(0) && c.holder != expectedHolder)
                                                          return (false, "CHECK8_FAIL: credential holder mismatch");
        return (true, "");
    }

    // ── Views ───────────────────────────────────────────────────────────────
    function getCredential(bytes32 credentialId) external view returns (Credential memory) { return _creds[credentialId]; }
    function getCredentialsByHolder(address holder) external view returns (bytes32[] memory) { return _byHolder[holder]; }
    function getCredentialsByIssuer(address issuer) external view returns (bytes32[] memory) { return _byIssuer[issuer]; }

    /// @notice What licence `issuer` would give `holder`; reverts with the reason if not allowed.
    function licenceTypeFor(address issuer, address holder) external view returns (string memory) {
        return _licenceTypeFor(issuer, holder);
    }

    // ── Internal ────────────────────────────────────────────────────────────
    function _licenceTypeFor(address issuer, address holder) internal view returns (string memory) {
        if (didRegistry.hasRole(issuer, "LocalGovt")) {
            require(trustRegistry.isAuthorizedIssuer(issuer), "CredentialRegistry: Local Government is not licensed by rootGA");
            require(didRegistry.hasRole(holder, "Manufacturer"), "CredentialRegistry: Local Government can only licence Manufacturers");
            return MANUFACTURING_LICENSE;
        }
        if (didRegistry.hasRole(issuer, "Manufacturer")) {
            require(isCredentialValid(issuer), "CredentialRegistry: your Manufacturing License is not active");
            require(didRegistry.hasRole(holder, "Distributor"), "CredentialRegistry: Manufacturers can only licence Distributors");
            return TRADE_LICENSE;
        }
        if (didRegistry.hasRole(issuer, "Distributor")) {
            require(isCredentialValid(issuer), "CredentialRegistry: your Trade License is not active");
            require(didRegistry.hasRole(holder, "Retailer"), "CredentialRegistry: Distributors can only licence Retailers");
            return TRADE_LICENSE;
        }
        revert("CredentialRegistry: your role cannot issue licences");
    }

    /// LocalGovt is trusted while rootGA's licence stands; everyone else while
    /// they themselves hold a live credential. Depth is bounded by the 4 roles.
    function _issuerTrusted(address issuer) internal view returns (bool) {
        if (didRegistry.hasRole(issuer, "LocalGovt")) return trustRegistry.isAuthorizedIssuer(issuer);
        return isCredentialValid(issuer);
    }
}
