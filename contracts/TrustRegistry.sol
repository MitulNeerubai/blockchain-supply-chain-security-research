// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TrustRegistry {
    address public immutable rootGA;
    mapping(address => bool) public authorizedIssuers;
    mapping(address => string) public issuerRoles;
    address[] private _issuerList;

    event IssuerAuthorized(address indexed issuer, string role, uint256 timestamp);
    event IssuerRevoked(address indexed issuer, uint256 timestamp);

    constructor() { rootGA = msg.sender; }

    modifier onlyRootGA() {
        require(msg.sender == rootGA, "TrustRegistry: caller is not rootGA");
        _;
    }

    function authorizeIssuer(address issuer, string calldata role) external onlyRootGA {
        require(issuer != address(0), "TrustRegistry: zero address");
        require(bytes(role).length > 0, "TrustRegistry: empty role");
        if (!authorizedIssuers[issuer]) _issuerList.push(issuer);
        authorizedIssuers[issuer] = true;
        issuerRoles[issuer] = role;
        emit IssuerAuthorized(issuer, role, block.timestamp);
    }

    function revokeIssuer(address issuer) external onlyRootGA {
        require(authorizedIssuers[issuer], "TrustRegistry: not an authorized issuer");
        authorizedIssuers[issuer] = false;
        emit IssuerRevoked(issuer, block.timestamp);
    }

    function isAuthorizedIssuer(address issuer) external view returns (bool) {
        return authorizedIssuers[issuer];
    }

    function getIssuerRole(address issuer) external view returns (string memory) {
        return issuerRoles[issuer];
    }

    function getIssuerCount() external view returns (uint256) { return _issuerList.length; }

    function getIssuerAt(uint256 i) external view returns (address) {
        require(i < _issuerList.length, "TrustRegistry: index out of bounds");
        return _issuerList[i];
    }
}
