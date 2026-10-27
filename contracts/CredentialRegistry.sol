// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TrustRegistry.sol";
import "./DIDRegistry.sol";
import "./AuditLog.sol";

contract CredentialRegistry {
    struct Credential {
        bytes32  id;
        address  issuer;
        address  holder;
        string   credType;
        uint256  issuedAt;
        uint256  expiresAt;
        bool     revoked;
        uint256  linkedProductId;
        bool     productLinked;
    }

    TrustRegistry public immutable trustRegistry;
    DIDRegistry   public immutable didRegistry;
    AuditLog      public immutable auditLog;

    mapping(bytes32 => Credential) public credentials;
    mapping(address => bytes32[]) public credentialsByIssuer;
    mapping(address => bytes32[]) public credentialsByHolder;
    uint256 private _nonce;

    event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed holder, string credType, uint256 expiresAt);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy);
    event CredentialLinkedToProduct(bytes32 indexed credentialId, uint256 indexed productId);

    constructor(address _trustRegistry, address _didRegistry, address _auditLog) {
        trustRegistry = TrustRegistry(_trustRegistry);
        didRegistry   = DIDRegistry(_didRegistry);
        auditLog      = AuditLog(_auditLog);
    }

    function issueCredential(address holder, string calldata credType, uint256 expiresAt)
        external returns (bytes32 credentialId)
    {
        require(trustRegistry.isAuthorizedIssuer(msg.sender), "CredentialRegistry: issuer not authorized in TrustRegistry");
        require(didRegistry.isActiveDID(msg.sender), "CredentialRegistry: issuer does not have an active DID");
        require(didRegistry.isActiveDID(holder), "CredentialRegistry: holder does not have an active DID");

        // ONE CREDENTIAL PER WALLET — holder must not already have an active credential
        require(!isCredentialValid(holder), "CredentialRegistry: holder already has an active credential. Revoke it first.");

        credentialId = keccak256(abi.encodePacked(msg.sender, holder, credType, _nonce++, block.timestamp));
        credentials[credentialId] = Credential({
            id: credentialId,
            issuer: msg.sender,
            holder: holder,
            credType: credType,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false,
            linkedProductId: 0,
            productLinked: false
        });
        credentialsByIssuer[msg.sender].push(credentialId);
        credentialsByHolder[holder].push(credentialId);
        auditLog.logAction(msg.sender, "CREDENTIAL_ISSUED", string(abi.encodePacked("credId=", _bytes32ToHex(credentialId), " type=", credType)));
        emit CredentialIssued(credentialId, msg.sender, holder, credType, expiresAt);
    }

    function revokeCredential(bytes32 credentialId) external {
        Credential storage cred = credentials[credentialId];
        require(cred.issuer != address(0), "CredentialRegistry: credential does not exist");
        require(cred.issuer == msg.sender, "CredentialRegistry: only issuer can revoke");
        require(!cred.revoked, "CredentialRegistry: already revoked");
        cred.revoked = true;
        auditLog.logAction(msg.sender, "CREDENTIAL_REVOKED", string(abi.encodePacked("credId=", _bytes32ToHex(credentialId))));
        emit CredentialRevoked(credentialId, msg.sender);
    }

    function linkCredentialToProduct(bytes32 credentialId, uint256 productId, address holder) external {
        Credential storage cred = credentials[credentialId];
        require(cred.holder == holder, "CredentialRegistry: only holder can link");
        require(!cred.productLinked, "CredentialRegistry: already linked to a product");
        require(productId != 0, "CredentialRegistry: invalid product ID");
        cred.linkedProductId = productId;
        cred.productLinked = true;
        auditLog.logAction(msg.sender, "CREDENTIAL_LINKED", string(abi.encodePacked("credId=", _bytes32ToHex(credentialId), " productId=", _uint2str(productId))));
        emit CredentialLinkedToProduct(credentialId, productId);
    }

    function verifyCredential(bytes32 credentialId, address expectedHolder, string calldata expectedType, uint256 expectedProduct)
        external view returns (bool valid, string memory reason)
    {
        Credential storage cred = credentials[credentialId];
        if (cred.issuer == address(0)) return (false, "CHECK1_FAIL: credential does not exist");
        if (cred.revoked) return (false, "CHECK2_FAIL: credential has been revoked");
        if (cred.expiresAt != 0 && block.timestamp > cred.expiresAt) return (false, "CHECK3_FAIL: credential has expired");
        if (!trustRegistry.isAuthorizedIssuer(cred.issuer)) return (false, "CHECK4_FAIL: issuer no longer authorized (cascading revocation)");
        if (!didRegistry.isActiveDID(cred.issuer)) return (false, "CHECK5_FAIL: issuer DID has been deactivated");
        if (!didRegistry.isActiveDID(cred.holder)) return (false, "CHECK6_FAIL: holder DID has been deactivated");
        if (bytes(expectedType).length > 0 && keccak256(bytes(cred.credType)) != keccak256(bytes(expectedType))) return (false, "CHECK7_FAIL: credential type mismatch");
        if (expectedProduct != 0 && (!cred.productLinked || cred.linkedProductId != expectedProduct)) return (false, "CHECK8_FAIL: credential not linked to expected product");
        if (cred.holder != expectedHolder) return (false, "CHECK_HOLDER_FAIL: credential holder mismatch");
        return (true, "");
    }

    function getCredential(bytes32 credentialId) external view returns (Credential memory) { return credentials[credentialId]; }
    function getCredentialsByHolder(address holder) external view returns (bytes32[] memory) { return credentialsByHolder[holder]; }

    // Returns true if holder has at least one non-revoked, non-expired credential
    // Changed to PUBLIC so issueCredential can call it internally
    function isCredentialValid(address holder) public view returns (bool) {
        bytes32[] storage ids = credentialsByHolder[holder];
        for (uint256 i = 0; i < ids.length; i++) {
            Credential storage cred = credentials[ids[i]];
            if (!cred.revoked && (cred.expiresAt == 0 || block.timestamp <= cred.expiresAt)) {
                return true;
            }
        }
        return false;
    }

    function _bytes32ToHex(bytes32 b) internal pure returns (string memory) {
        bytes memory h = new bytes(66); h[0]='0'; h[1]='x';
        for (uint256 i=0;i<32;i++){uint8 byt=uint8(b[i]);h[2+i*2]=_hexChar(byt>>4);h[3+i*2]=_hexChar(byt&0x0f);}
        return string(h);
    }
    function _toHexString(address addr) internal pure returns (string memory) {
        bytes memory buf=new bytes(42); buf[0]='0'; buf[1]='x';
        for(uint256 i=0;i<20;i++){uint8 b=uint8(uint160(addr)>>(8*(19-i)));buf[2+i*2]=_hexChar(b>>4);buf[3+i*2]=_hexChar(b&0x0f);}
        return string(buf);
    }
    function _hexChar(uint8 v) internal pure returns (bytes1) { return v<10?bytes1(uint8(48+v)):bytes1(uint8(87+v)); }
    function _uint2str(uint256 v) internal pure returns (string memory) {
        if(v==0)return "0"; uint256 t=v; uint256 l;
        while(t!=0){l++;t/=10;} bytes memory buf=new bytes(l);
        while(v!=0){buf[--l]=bytes1(uint8(48+v%10));v/=10;} return string(buf);
    }
}
