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

    enum Status { InStock, InTransit, Delivered, Cancelled }

    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        bool    confirmed;
        bool    cancelled;
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
    mapping(address => uint256[])        private _holderProducts;

    event ProductCreated(uint256 indexed id, address indexed manufacturer, string name);
    event ProductShipped(uint256 indexed id, address indexed from, address indexed to);
    event ProductReceived(uint256 indexed id, address indexed by);
    event ProductDelivered(uint256 indexed id, address indexed retailer);
    event ShipmentCancelled(uint256 indexed id, address indexed by, address indexed recipient);
    event ProductCancelled(uint256 indexed id, address indexed holder);
    event ProductReclaimed(uint256 indexed id, address indexed from, address indexed to);
    event ProductForceRecalled(uint256 indexed id, address indexed by, address indexed from);

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
        _holderProducts[msg.sender].push(id);
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
            confirmed: false,
            cancelled: false
        }));

        emit ProductShipped(productId, msg.sender, recipient);
    }

    function confirmReceipt(uint256 productId)
        external onlyCredentialed productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InTransit,    "ProductTransfer: not in transit");
        require(p.pendingRecipient == msg.sender, "ProductTransfer: not the pending recipient");

        uint256 len = transferHistory[productId].length;
        require(len > 0, "ProductTransfer: no transfer record found");
        transferHistory[productId][len - 1].confirmed = true;

        address prevHolder = p.currentHolder;
        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);

        _holderProducts[msg.sender].push(productId);

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

    function cancelShipment(uint256 productId)
        external onlyCredentialed onlyHolder(productId) productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        require(
            !credRegistry.isCredentialValid(p.pendingRecipient),
            "ProductTransfer: recipient still has valid credential"
        );

        address recipient = p.pendingRecipient;
        uint256 len = transferHistory[productId].length;
        require(len > 0, "ProductTransfer: no transfer record");
        transferHistory[productId][len - 1].cancelled = true;

        p.status           = Status.InStock;
        p.pendingRecipient = address(0);

        emit ShipmentCancelled(productId, msg.sender, recipient);
    }

    // ─── Force Recall ────────────────────────────────────────────────────────
    // MF: can recall their product from DT or RT at any time, no conditions.
    // DT: can recall from RT only if RT's credential is revoked AND DT was
    //     the last sender.
    // Works whether the product is InStock, InTransit, or Delivered.
    // ─────────────────────────────────────────────────────────────────────────
    function forceRecall(uint256 productId)
        external onlyCredentialed productExists(productId)
    {
        Product storage p = products[productId];
        require(p.status != Status.Cancelled, "ProductTransfer: product is cancelled");

        address prevHolder = p.currentHolder;
        require(prevHolder != msg.sender, "ProductTransfer: already in your possession");

        IDIDRegistry.DIDDocument memory callerDoc = didRegistry.getDID(msg.sender);
        bool callerIsMF = keccak256(bytes(callerDoc.role)) == keccak256(bytes("Manufacturer"));
        bool callerIsDT = keccak256(bytes(callerDoc.role)) == keccak256(bytes("Distributor"));

        require(callerIsMF || callerIsDT, "ProductTransfer: not authorized to force recall");

        if (callerIsMF) {
            // MF must be this product's manufacturer
            require(p.manufacturer == msg.sender, "ProductTransfer: not the manufacturer of this product");
            // No credential check on holder — MF has unconditional authority
        }

        if (callerIsDT) {
            // DT can only recall from RT
            IDIDRegistry.DIDDocument memory holderDoc = didRegistry.getDID(prevHolder);
            require(
                keccak256(bytes(holderDoc.role)) == keccak256(bytes("Retailer")),
                "ProductTransfer: DT can only recall from RT"
            );
            // RT's credential must be revoked
            require(
                !credRegistry.isCredentialValid(prevHolder),
                "ProductTransfer: RT credential is still valid"
            );
            // DT must have been the last sender
            uint256 histLen = transferHistory[productId].length;
            require(histLen > 0, "ProductTransfer: no transfer history");
            require(
                transferHistory[productId][histLen - 1].from == msg.sender,
                "ProductTransfer: not the last sender of this product"
            );
        }

        // If in-transit, mark the pending transfer as cancelled
        if (p.status == Status.InTransit) {
            uint256 len = transferHistory[productId].length;
            if (len > 0) transferHistory[productId][len - 1].cancelled = true;
            p.pendingRecipient = address(0);
        }

        // Transfer ownership back to caller
        p.currentHolder = msg.sender;
        p.status        = Status.InStock;
        _holderProducts[msg.sender].push(productId);
        _transfer(prevHolder, msg.sender, productId);

        emit ProductForceRecalled(productId, msg.sender, prevHolder);
    }

    // ─── Reclaim (permissionless — anyone triggers when holder cred revoked) ─
    function reclaimProduct(uint256 productId) external productExists(productId) {
        Product storage p = products[productId];
        address holder = p.currentHolder;

        require(!credRegistry.isCredentialValid(holder), "ProductTransfer: holder credential still valid");
        require(p.status != Status.Cancelled, "ProductTransfer: product already cancelled");

        IDIDRegistry.DIDDocument memory holderDoc = didRegistry.getDID(holder);

        if (keccak256(bytes(holderDoc.role)) == keccak256(bytes("Manufacturer"))) {
            p.status        = Status.Cancelled;
            p.currentHolder = address(0);
            _burn(productId);
            emit ProductCancelled(productId, holder);

        } else if (keccak256(bytes(holderDoc.role)) == keccak256(bytes("Distributor"))) {
            address mf = p.manufacturer;
            require(credRegistry.isCredentialValid(mf), "ProductTransfer: manufacturer credential also invalid");
            p.currentHolder    = mf;
            p.pendingRecipient = address(0);
            p.status           = Status.InStock;
            _transfer(holder, mf, productId);
            _holderProducts[mf].push(productId);
            emit ProductReclaimed(productId, holder, mf);

        } else if (keccak256(bytes(holderDoc.role)) == keccak256(bytes("Retailer"))) {
            TransferRecord[] storage history = transferHistory[productId];
            require(history.length > 0, "ProductTransfer: no transfer history");
            address prevSender = history[history.length - 1].from;
            require(credRegistry.isCredentialValid(prevSender), "ProductTransfer: previous sender credential also invalid");
            p.currentHolder    = prevSender;
            p.pendingRecipient = address(0);
            p.status           = Status.InStock;
            _transfer(holder, prevSender, productId);
            _holderProducts[prevSender].push(productId);
            emit ProductReclaimed(productId, holder, prevSender);

        } else {
            revert("ProductTransfer: unrecognized role for reclaim");
        }
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

    function getHolderProducts(address holder) external view returns (uint256[] memory) {
        return _holderProducts[holder];
    }
}
