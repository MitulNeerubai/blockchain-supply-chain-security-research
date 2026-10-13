// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProductTransfer {
    enum ProductStatus { Created, InTransit, Delivered, Recalled }

    struct Product {
        string productId;
        address manufacturer;
        address currentOwner;
        ProductStatus status;
        uint256 createdAt;
    }

    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        string location;
    }

    mapping(string => Product) private products;
    mapping(string => TransferRecord[]) private transferHistory;

    event ProductCreated(string indexed productId, address indexed manufacturer);
    event ProductTransferred(string indexed productId, address indexed from, address indexed to);
    event ProductRecalled(string indexed productId);

    function createProduct(string memory productId) external {
        require(bytes(productId).length > 0, "Invalid product ID");
        require(products[productId].manufacturer == address(0), "Product exists");
        products[productId] = Product({
            productId: productId,
            manufacturer: msg.sender,
            currentOwner: msg.sender,
            status: ProductStatus.Created,
            createdAt: block.timestamp
        });
        emit ProductCreated(productId, msg.sender);
    }

    function transferProduct(string memory productId, address to, string memory location) external {
        require(products[productId].currentOwner == msg.sender, "Not owner");
        require(products[productId].status != ProductStatus.Recalled, "Product recalled");
        transferHistory[productId].push(TransferRecord({
            from: msg.sender,
            to: to,
            timestamp: block.timestamp,
            location: location
        }));
        products[productId].currentOwner = to;
        products[productId].status = ProductStatus.InTransit;
        emit ProductTransferred(productId, msg.sender, to);
    }

    function deliverProduct(string memory productId) external {
        require(products[productId].currentOwner == msg.sender, "Not owner");
        products[productId].status = ProductStatus.Delivered;
    }

    function recallProduct(string memory productId) external {
        require(products[productId].manufacturer == msg.sender, "Not manufacturer");
        products[productId].status = ProductStatus.Recalled;
        emit ProductRecalled(productId);
    }

    function getProduct(string memory productId) external view returns (address manufacturer, address currentOwner, ProductStatus status) {
        Product memory p = products[productId];
        return (p.manufacturer, p.currentOwner, p.status);
    }

    function getTransferHistory(string memory productId) external view returns (TransferRecord[] memory) {
        return transferHistory[productId];
    }
}
