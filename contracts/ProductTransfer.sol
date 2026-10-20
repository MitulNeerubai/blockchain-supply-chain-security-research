// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CredentialRegistry.sol";
import "./AuditLog.sol";

contract ProductTransfer {
    enum ProductStatus { Created, InTransit, Delivered, Revoked }

    struct Product {
        uint256       id;
        string        name;
        address       manufacturer;
        address       currentHolder;
        ProductStatus status;
        uint256       createdAt;
        bytes32       manufacturingCredId;
        bytes32       secretHash;
        address       pendingRecipient;
        bytes32       transferCredId;
    }

    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        string  action;
    }

    CredentialRegistry public immutable credentialRegistry;
    AuditLog           public immutable auditLog;

    mapping(uint256 => Product)          public products;
    mapping(uint256 => TransferRecord[]) public transferHistory;
    uint256 private _productCounter;

    event ProductCreated(uint256 indexed productId, address indexed manufacturer, string name);
    event TransferCommitted(uint256 indexed productId, address indexed from, address indexed to, bytes32 secretHash);
    event TransferClaimed(uint256 indexed productId, address indexed claimedBy);
    event TransferCancelled(uint256 indexed productId, address indexed cancelledBy);

    constructor(address _credentialRegistry, address _auditLog) {
        credentialRegistry = CredentialRegistry(_credentialRegistry);
        auditLog           = AuditLog(_auditLog);
    }

    function createProduct(string calldata name, bytes32 credentialId) external returns (uint256 productId) {
        (bool valid, string memory reason) = credentialRegistry.verifyCredential(credentialId, msg.sender, "ManufacturingLicense", 0);
        require(valid, string(abi.encodePacked("ProductTransfer: credential invalid: ", reason)));
        productId = ++_productCounter;
        products[productId] = Product({ id: productId, name: name, manufacturer: msg.sender, currentHolder: msg.sender, status: ProductStatus.Created, createdAt: block.timestamp, manufacturingCredId: credentialId, secretHash: bytes32(0), pendingRecipient: address(0), transferCredId: bytes32(0) });
        credentialRegistry.linkCredentialToProduct(credentialId, productId, msg.sender);
        auditLog.logAction(msg.sender, "PRODUCT_CREATED", string(abi.encodePacked("productId=", _uint2str(productId), " name=", name)));
        emit ProductCreated(productId, msg.sender, name);
    }

    function commitTransfer(uint256 productId, bytes32 secretHash, address recipient, bytes32 recipientCredId) external {
        Product storage p = products[productId];
        require(p.id != 0, "ProductTransfer: product does not exist");
        require(p.currentHolder == msg.sender, "ProductTransfer: caller is not current holder");
        require(p.status == ProductStatus.Created, "ProductTransfer: product not in transferable state");
        require(secretHash != bytes32(0), "ProductTransfer: secretHash cannot be zero");
        require(recipient != address(0) && recipient != msg.sender, "ProductTransfer: invalid recipient");
        p.status = ProductStatus.InTransit;
        p.secretHash = secretHash;
        p.pendingRecipient = recipient;
        p.transferCredId = recipientCredId;
        transferHistory[productId].push(TransferRecord({ from: msg.sender, to: recipient, timestamp: block.timestamp, action: "COMMITTED" }));
        auditLog.logAction(msg.sender, "TRANSFER_COMMITTED", _uint2str(productId));
        emit TransferCommitted(productId, msg.sender, recipient, secretHash);
    }

    function claimTransfer(uint256 productId, string calldata secret) external {
        Product storage p = products[productId];
        require(p.id != 0, "ProductTransfer: product does not exist");
        require(p.status == ProductStatus.InTransit, "ProductTransfer: no pending transfer");
        require(p.pendingRecipient == msg.sender, "ProductTransfer: caller is not the pending recipient");
        require(keccak256(abi.encodePacked(secret)) == p.secretHash, "ProductTransfer: secret does not match commitment (wrong secret)");
        if (p.transferCredId != bytes32(0)) {
            (bool valid, string memory reason) = credentialRegistry.verifyCredential(p.transferCredId, msg.sender, "", 0);
            require(valid, string(abi.encodePacked("ProductTransfer: recipient credential invalid: ", reason)));
        }
        address prev = p.currentHolder;
        p.currentHolder = msg.sender;
        p.status = ProductStatus.Created;
        p.secretHash = bytes32(0);
        p.pendingRecipient = address(0);
        p.transferCredId = bytes32(0);
        transferHistory[productId].push(TransferRecord({ from: prev, to: msg.sender, timestamp: block.timestamp, action: "CLAIMED" }));
        auditLog.logAction(msg.sender, "TRANSFER_CLAIMED", _uint2str(productId));
        emit TransferClaimed(productId, msg.sender);
    }

    function cancelTransfer(uint256 productId) external {
        Product storage p = products[productId];
        require(p.status == ProductStatus.InTransit, "ProductTransfer: no pending transfer");
        TransferRecord[] storage history = transferHistory[productId];
        require(history[history.length - 1].from == msg.sender, "ProductTransfer: only committer can cancel");
        p.status = ProductStatus.Created;
        p.secretHash = bytes32(0);
        p.pendingRecipient = address(0);
        p.transferCredId = bytes32(0);
        history.push(TransferRecord({ from: msg.sender, to: address(0), timestamp: block.timestamp, action: "CANCELLED" }));
        auditLog.logAction(msg.sender, "TRANSFER_CANCELLED", _uint2str(productId));
        emit TransferCancelled(productId, msg.sender);
    }

    function getProduct(uint256 productId) external view returns (Product memory) { return products[productId]; }
    function getTransferHistory(uint256 productId) external view returns (TransferRecord[] memory) { return transferHistory[productId]; }
    function totalProducts() external view returns (uint256) { return _productCounter; }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if(v==0)return "0"; uint256 t=v; uint256 l;
        while(t!=0){l++;t/=10;} bytes memory buf=new bytes(l);
        while(v!=0){buf[--l]=bytes1(uint8(48+v%10));v/=10;} return string(buf);
    }
}
