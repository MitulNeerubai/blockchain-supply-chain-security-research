// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AuditLog {
    address public immutable rootGA;
    mapping(address => bool) public registeredContracts;
    mapping(address => string) public contractLabels;

    struct LogEntry {
        uint256 timestamp;
        address actor;
        address loggedBy;
        string  action;
        string  details;
    }

    LogEntry[] private _log;

    event ActionLogged(uint256 indexed entryId, address indexed actor, string action, uint256 timestamp);
    event ContractRegistered(address indexed contractAddr, string label);

    constructor() { rootGA = msg.sender; }

    modifier onlyRootGA() {
        require(msg.sender == rootGA, "AuditLog: caller is not rootGA");
        _;
    }

    modifier onlyRegisteredContract() {
        require(registeredContracts[msg.sender], "AuditLog: caller not a registered contract");
        _;
    }

    function registerContract(address contractAddr, string calldata label) external onlyRootGA {
        require(contractAddr != address(0), "AuditLog: zero address");
        registeredContracts[contractAddr] = true;
        contractLabels[contractAddr] = label;
        emit ContractRegistered(contractAddr, label);
    }

    function logAction(address actor, string calldata action, string calldata details)
        external onlyRegisteredContract returns (uint256 entryId)
    {
        entryId = _log.length;
        _log.push(LogEntry({ timestamp: block.timestamp, actor: actor, loggedBy: msg.sender, action: action, details: details }));
        emit ActionLogged(entryId, actor, action, block.timestamp);
    }

    function getEntry(uint256 i) external view returns (LogEntry memory) {
        require(i < _log.length, "AuditLog: index out of bounds");
        return _log[i];
    }

    function totalEntries() external view returns (uint256) { return _log.length; }

    function getEntries(uint256 from, uint256 to) external view returns (LogEntry[] memory) {
        require(to <= _log.length, "AuditLog: to out of range");
        require(from < to, "AuditLog: empty range");
        LogEntry[] memory page = new LogEntry[](to - from);
        for (uint256 i = from; i < to; i++) page[i - from] = _log[i];
        return page;
    }
}
