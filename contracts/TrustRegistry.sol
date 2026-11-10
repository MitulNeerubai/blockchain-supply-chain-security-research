// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TrustRegistry — root of trust
/// @notice The deployer becomes rootGA. Only rootGA can grant (or revoke) the
///         Local Government licence that lets an LG issue Manufacturing Licences.
///         Whether the wallet really registered as "LocalGovt" is enforced by
///         CredentialRegistry at issue time, so this contract stays dependency-free.
contract TrustRegistry {
    address public immutable rootGA;

    mapping(address => bool)   public authorizedIssuers;
    mapping(address => string) public issuerRoles;
    mapping(address => uint256) public authorizedAt;
    mapping(address => bool)   private _listed;
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
        require(issuer != rootGA, "TrustRegistry: rootGA cannot be an issuer");
        require(bytes(role).length > 0, "TrustRegistry: empty role");
        require(!authorizedIssuers[issuer], "TrustRegistry: already authorized");
        if (!_listed[issuer]) { _listed[issuer] = true; _issuerList.push(issuer); }
        authorizedIssuers[issuer] = true;
        issuerRoles[issuer] = role;
        authorizedAt[issuer] = block.timestamp;
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

    /// @notice Every address that has ever been authorized (check isAuthorizedIssuer for current state).
    function getIssuers() external view returns (address[] memory) { return _issuerList; }
    function getIssuerCount() external view returns (uint256) { return _issuerList.length; }

    function getIssuerAt(uint256 i) external view returns (address) {
        require(i < _issuerList.length, "TrustRegistry: index out of bounds");
        return _issuerList[i];
    }
}
