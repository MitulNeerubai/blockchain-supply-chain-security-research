// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CredentialRegistry {
    enum CredentialStatus { Active, Revoked, Expired }

    struct Credential {
        address issuer;
        address subject;
        bytes32 credentialHash;
        uint256 issuedAt;
        uint256 expiresAt;
        CredentialStatus status;
    }

    mapping(bytes32 => Credential) private credentials;
    mapping(address => bytes32[]) private subjectCredentials;

    event CredentialIssued(bytes32 indexed credentialId, address indexed issuer, address indexed subject);
    event CredentialRevoked(bytes32 indexed credentialId);

    function issueCredential(
        address subject,
        bytes32 credentialHash,
        uint256 expiresAt
    ) external returns (bytes32) {
        bytes32 credentialId = keccak256(abi.encodePacked(msg.sender, subject, credentialHash, block.timestamp));
        credentials[credentialId] = Credential({
            issuer: msg.sender,
            subject: subject,
            credentialHash: credentialHash,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            status: CredentialStatus.Active
        });
        subjectCredentials[subject].push(credentialId);
        emit CredentialIssued(credentialId, msg.sender, subject);
        return credentialId;
    }

    function verifyCredential(bytes32 credentialId) external view returns (bool) {
        Credential memory cred = credentials[credentialId];
        if (cred.issuer == address(0)) return false;
        if (cred.status != CredentialStatus.Active) return false;
        if (cred.expiresAt != 0 && block.timestamp > cred.expiresAt) return false;
        return true;
    }

    function revokeCredential(bytes32 credentialId) external {
        require(credentials[credentialId].issuer == msg.sender, "Not issuer");
        credentials[credentialId].status = CredentialStatus.Revoked;
        emit CredentialRevoked(credentialId);
    }

    function getCredential(bytes32 credentialId) external view returns (address issuer, address subject, CredentialStatus status) {
        Credential memory cred = credentials[credentialId];
        return (cred.issuer, cred.subject, cred.status);
    }
}
