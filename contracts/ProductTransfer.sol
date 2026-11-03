// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

interface ICredentialRegistry {
    function isCredentialValid(address holder) external view returns (bool);
}

interface IDIDRegistry {
    struct DIDDocument {
        string  did;
        string  role;
        address controller;
        uint256 createdAt;
        bool    active;
    }
    function getDID(address controller) external view returns (DIDDocument memory);
}

contract ProductTransfer is ERC721 {

    enum Status { InStock, InTransit, Delivered }

    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        bool    confirmed;
    }

    struct Product {
        uint256 id;
        string  name;
        string  ipfsCID;
        address manufacturer;
        address currentHolder;
        address pendingRecipient;
        Status  status;
        uint256 createdAt;
    }

    ICredentialRegistry public immutable credRegistry;
    IDIDRegistry        public immutable didRegistry;

    uint256 private _nextId = 1;

    mapping(uint256 => Product)          public products;
    mapping(uint256 => TransferRecord[]) public transferHistory;
    mapping(address => uint256[])        private _manufacturerProducts;

    event ProductCreated(uint256 indexed id, address indexed manufacturer, string name);
    event ProductShipped(uint256 indexed id, address indexed from, address indexed to);
    event ProductReceived(uint256 indexed id, address indexed by);
    event ProductDelivered(uint256 indexed id, address indexed retailer);

    constructor(address _credRegistry, address _didRegistry)
        ERC721("Supply Chain Product", "SCP")
    {
        credRegistry = ICredentialRegistry(_credRegistry);
        didRegistry  = IDIDRegistry(_didRegistry);
    }

    modifier onlyCredentialed() {
        require(credRegistry.isCredentialValid(msg.sender), "ProductTransfer: no valid credential");
        _;
    }

    modifier onlyHolder(uint256 productId) {
        require(products[productId].currentHolder == msg.sender, "ProductTransfer: not current holder");
        _;
    }

    modifier productExists(uint256 productId) {
        require(products[productId].id != 0, "ProductTransfer: product not found");
        _;
    }

    function createProduct(string calldata name, string calldata ipfsCID)
        external onlyCredentialed returns (uint256)
    {
        IDIDRegistry.DIDDocument memory doc = didRegistry.getDID(msg.sender);
        require(doc.active, "ProductTransfer: sender DID not active");
        require(
            keccak256(bytes(doc.role)) == keccak256(bytes("Manufacturer")),
            "ProductTransfer: only Manufacturers can create products"
        );

        uint256 id = _nextId++;
        products[id] = Product({
            id:               id,
            name:             name,
            ipfsCID:          ipfsCID,
            manufacturer:     msg.sender,
            currentHolder:    msg.sender,
            pendingRecipient: address(0),
            status:           Status.InStock,
            createdAt:        block.timestamp
        });

        _manufacturerProducts[msg.sender].push(id);
        _mint(msg.sender, id);

        emit ProductCreated(id, msg.sender, name);
        return id;
    }

    function shipTo(uint256 productId, address recipient)
        external onlyCredentialed onlyHolder(productId) productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InStock, "ProductTransfer: product not in stock");
        require(recipient != address(0),    "ProductTransfer: invalid recipient");
        require(recipient != msg.sender,    "ProductTransfer: cannot ship to yourself");
        require(credRegistry.isCredentialValid(recipient), "ProductTransfer: recipient has no valid credential");

        p.status           = Status.InTransit;
        p.pendingRecipient = recipient;

        transferHistory[productId].push(TransferRecord({
            from:      msg.sender,
            to:        recipient,
            timestamp: block.timestamp,
            confirmed: false
        }));

        emit ProductShipped(productId, msg.sender, recipient);
    }

    function confirmReceipt(uint256 productId)
        external onlyCredentialed productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InTransit,     "ProductTransfer: not in transit");
        require(p.pendingRecipient == msg.sender,  "ProductTransfer: not the pending recipient");

        uint256 len = transferHistory[productId].length;
        require(len > 0, "ProductTransfer: no transfer record found");
        transferHistory[productId][len - 1].confirmed = true;

        address prevHolder = p.currentHolder;
        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);

        IDIDRegistry.DIDDocument memory doc = didRegistry.getDID(msg.sender);
        if (keccak256(bytes(doc.role)) == keccak256(bytes("Retailer"))) {
            p.status = Status.Delivered;
            emit ProductDelivered(productId, msg.sender);
        } else {
            p.status = Status.InStock;
        }

        _transfer(prevHolder, msg.sender, productId);
        emit ProductReceived(productId, msg.sender);
    }

    function getProduct(uint256 productId) external view productExists(productId) returns (Product memory) {
        return products[productId];
    }

    function getTransferHistory(uint256 productId) external view productExists(productId) returns (TransferRecord[] memory) {
        return transferHistory[productId];
    }

    function getTransferCount(uint256 productId) external view returns (uint256) {
        return transferHistory[productId].length;
    }

    function totalProducts() external view returns (uint256) {
        return _nextId - 1;
    }

    function getManufacturerProducts(address manufacturer) external view returns (uint256[] memory) {
        return _manufacturerProducts[manufacturer];
    }
}
