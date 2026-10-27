// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

/**
 * @title ProductTransfer
 * @notice Manages product creation and transfer through a supply chain.
 *         Credential verification replaces HTLC — blockchain trust IS the security.
 *         IPFS CID stored as a stub for now; populated when IPFS is integrated.
 *
 *  Status flow:
 *    InStock (0)  →  [shipTo]  →  InTransit (1)
 *    InTransit    →  [confirmReceipt by Distributor]  →  InStock  (can ship again)
 *    InTransit    →  [confirmReceipt by Retailer]     →  Delivered (2)  (end of chain)
 */
contract ProductTransfer {

    // ─── Enums ────────────────────────────────────────────────────────────────
    enum Status { InStock, InTransit, Delivered }

    // ─── Structs ──────────────────────────────────────────────────────────────
    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        bool    confirmed;
    }

    struct Product {
        uint256 id;
        string  name;
        string  ipfsCID;          // IPFS metadata CID — empty until IPFS integrated
        address manufacturer;     // original creator (MF)
        address currentHolder;
        address pendingRecipient; // set when shipped, cleared on confirm
        Status  status;
        uint256 createdAt;
    }

    // ─── State ────────────────────────────────────────────────────────────────
    ICredentialRegistry public immutable credRegistry;
    IDIDRegistry        public immutable didRegistry;

    uint256 private _nextId = 1;

    mapping(uint256 => Product)          public products;
    mapping(uint256 => TransferRecord[]) public transferHistory;

    /// @dev Tracks all product IDs created by each manufacturer address.
    mapping(address => uint256[]) private _manufacturerProducts;

    // ─── Events ───────────────────────────────────────────────────────────────
    event ProductCreated(uint256 indexed id, address indexed manufacturer, string name);
    event ProductShipped(uint256 indexed id, address indexed from, address indexed to);
    event ProductReceived(uint256 indexed id, address indexed by);
    event ProductDelivered(uint256 indexed id, address indexed retailer);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _credRegistry, address _didRegistry) {
        credRegistry = ICredentialRegistry(_credRegistry);
        didRegistry  = IDIDRegistry(_didRegistry);
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────
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

    // ─── External: Manufacturer ───────────────────────────────────────────────

    /**
     * @notice Create a new product. Caller must have a valid credential and Manufacturer DID role.
     * @param name    Human-readable product name.
     * @param ipfsCID IPFS CID for extended metadata (pass "" until IPFS is integrated).
     */
    function createProduct(string calldata name, string calldata ipfsCID)
        external
        onlyCredentialed
        returns (uint256)
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

        emit ProductCreated(id, msg.sender, name);
        return id;
    }

    // ─── External: Current holder ─────────────────────────────────────────────

    /**
     * @notice Ship a product to the next party in the chain.
     *         Both sender and recipient must have valid credentials.
     * @param productId  ID of the product to ship.
     * @param recipient  Address of the receiving party (DT or RT).
     */
    function shipTo(uint256 productId, address recipient)
        external
        onlyCredentialed
        onlyHolder(productId)
        productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InStock, "ProductTransfer: product not in stock");
        require(recipient != address(0),    "ProductTransfer: invalid recipient");
        require(recipient != msg.sender,    "ProductTransfer: cannot ship to yourself");
        require(
            credRegistry.isCredentialValid(recipient),
            "ProductTransfer: recipient has no valid credential"
        );

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

    // ─── External: Recipient ──────────────────────────────────────────────────

    /**
     * @notice Confirm receipt of a product that was shipped to you.
     *         - If the caller is a Retailer → status becomes Delivered (end of chain).
     *         - Otherwise (Distributor) → status returns to InStock so they can ship further.
     * @param productId  ID of the product to confirm.
     */
    function confirmReceipt(uint256 productId)
        external
        onlyCredentialed
        productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InTransit,    "ProductTransfer: not in transit");
        require(p.pendingRecipient == msg.sender, "ProductTransfer: not the pending recipient");

        // Mark the last transfer record as confirmed
        uint256 len = transferHistory[productId].length;
        require(len > 0, "ProductTransfer: no transfer record found");
        transferHistory[productId][len - 1].confirmed = true;

        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);

        // Retailer = end of chain → Delivered; Distributor can forward → InStock
        IDIDRegistry.DIDDocument memory doc = didRegistry.getDID(msg.sender);
        if (keccak256(bytes(doc.role)) == keccak256(bytes("Retailer"))) {
            p.status = Status.Delivered;
            emit ProductDelivered(productId, msg.sender);
        } else {
            p.status = Status.InStock;
        }

        emit ProductReceived(productId, msg.sender);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getProduct(uint256 productId)
        external
        view
        productExists(productId)
        returns (Product memory)
    {
        return products[productId];
    }

    function getTransferHistory(uint256 productId)
        external
        view
        productExists(productId)
        returns (TransferRecord[] memory)
    {
        return transferHistory[productId];
    }

    function getTransferCount(uint256 productId)
        external
        view
        returns (uint256)
    {
        return transferHistory[productId].length;
    }

    function totalProducts() external view returns (uint256) {
        return _nextId - 1;
    }

    /**
     * @notice Returns all product IDs ever created by a given manufacturer.
     *         Use this in the MF dashboard to list products and their live status.
     */
    function getManufacturerProducts(address manufacturer)
        external
        view
        returns (uint256[] memory)
    {
        return _manufacturerProducts[manufacturer];
    }
}
