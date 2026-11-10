// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";
import "./AuditLog.sol";

/// @title ProductTransfer — products as ERC-721 tokens moving MF → DT → RT
/// @notice Shipping is only allowed to a partner YOU licensed:
///         a Manufacturer ships to Distributors it licensed, a Distributor ships
///         to Retailers it licensed. Every handoff is two-step (ship, confirm).
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
        uint256 quantity;
        string  description;
        string  batchNumber;
    }

    CredentialRegistry public immutable credRegistry;
    DIDRegistry        public immutable didRegistry;
    AuditLog           public immutable auditLog;

    uint256 private _nextId = 1;

    mapping(uint256 => Product)          private _products;
    mapping(uint256 => TransferRecord[]) private _history;
    mapping(address => uint256[])        private _manufacturerProducts;
    mapping(address => uint256[])        private _holderProducts;    // every product the address has ever held
    mapping(address => uint256[])        private _shipmentsTo;       // every product ever shipped to the address
    mapping(address => mapping(uint256 => bool)) private _heldIndexed;
    mapping(address => mapping(uint256 => bool)) private _shipIndexed;

    event ProductCreated(uint256 indexed id, address indexed manufacturer, string name);
    event ProductShipped(uint256 indexed id, address indexed from, address indexed to);
    event ProductReceived(uint256 indexed id, address indexed by);
    event ProductDelivered(uint256 indexed id, address indexed retailer);
    event ShipmentCancelled(uint256 indexed id, address indexed by, address indexed recipient);
    event ProductCancelled(uint256 indexed id, address indexed holder);
    event ProductReclaimed(uint256 indexed id, address indexed from, address indexed to);
    event ProductForceRecalled(uint256 indexed id, address indexed by, address indexed from);

    constructor(address _credRegistry, address _didRegistry, address _auditLog)
        ERC721("Supply Chain Product", "SCP")
    {
        credRegistry = CredentialRegistry(_credRegistry);
        didRegistry  = DIDRegistry(_didRegistry);
        auditLog     = AuditLog(_auditLog);
    }

    modifier onlyCredentialed() {
        require(credRegistry.isCredentialValid(msg.sender), "ProductTransfer: no valid credential");
        _;
    }

    modifier productExists(uint256 productId) {
        require(_products[productId].id != 0, "ProductTransfer: product not found");
        _;
    }

    // ── Create ──────────────────────────────────────────────────────────────
    function createProduct(
        string calldata name, string calldata ipfsCID, uint256 quantity,
        string calldata description, string calldata batchNumber
    ) external onlyCredentialed returns (uint256 id) {
        require(didRegistry.hasRole(msg.sender, "Manufacturer"), "ProductTransfer: only Manufacturers can create products");
        require(bytes(name).length > 0, "ProductTransfer: name required");
        require(quantity > 0, "ProductTransfer: quantity must be at least 1");

        id = _nextId++;
        _products[id] = Product({
            id: id, name: name, ipfsCID: ipfsCID, manufacturer: msg.sender,
            currentHolder: msg.sender, pendingRecipient: address(0), status: Status.InStock,
            createdAt: block.timestamp, quantity: quantity, description: description, batchNumber: batchNumber
        });
        _manufacturerProducts[msg.sender].push(id);
        _indexHolder(msg.sender, id);
        _mint(msg.sender, id);

        _log("PRODUCT_CREATED", id, name);
        emit ProductCreated(id, msg.sender, name);
    }

    // ── Ship / confirm / cancel ─────────────────────────────────────────────
    function shipTo(uint256 productId, address recipient) external onlyCredentialed productExists(productId) {
        Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Status.InStock, "ProductTransfer: product not in stock");
        require(recipient != msg.sender, "ProductTransfer: cannot ship to yourself");
        require(credRegistry.licensedBy(recipient) == msg.sender, "ProductTransfer: recipient is not licensed by you");

        p.status           = Status.InTransit;
        p.pendingRecipient = recipient;
        _history[productId].push(TransferRecord(msg.sender, recipient, block.timestamp, false, false));
        if (!_shipIndexed[recipient][productId]) { _shipIndexed[recipient][productId] = true; _shipmentsTo[recipient].push(productId); }

        _log("PRODUCT_SHIPPED", productId, string.concat("to=", Strings.toHexString(recipient)));
        emit ProductShipped(productId, msg.sender, recipient);
    }

    function confirmReceipt(uint256 productId) external onlyCredentialed productExists(productId) {
        Product storage p = _products[productId];
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        require(p.pendingRecipient == msg.sender, "ProductTransfer: not the pending recipient");

        _history[productId][_history[productId].length - 1].confirmed = true;
        address prev = p.currentHolder;
        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);
        _indexHolder(msg.sender, productId);

        if (didRegistry.hasRole(msg.sender, "Retailer")) {
            p.status = Status.Delivered;
            emit ProductDelivered(productId, msg.sender);
        } else {
            p.status = Status.InStock;
        }
        _transfer(prev, msg.sender, productId);

        _log("PRODUCT_RECEIVED", productId, "");
        emit ProductReceived(productId, msg.sender);
    }

    /// @notice Sender cancels a shipment that has not been confirmed yet.
    function cancelShipment(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        address recipient = p.pendingRecipient;
        _history[productId][_history[productId].length - 1].cancelled = true;
        p.status           = Status.InStock;
        p.pendingRecipient = address(0);

        _log("SHIPMENT_CANCELLED", productId, "");
        emit ShipmentCancelled(productId, msg.sender, recipient);
    }

    // ── Recall / reclaim ────────────────────────────────────────────────────
    /// @notice Manufacturer can pull its own product back from anyone downstream.
    ///         Distributor can pull a product back from a Retailer it shipped to.
    function forceRecall(uint256 productId) external onlyCredentialed productExists(productId) {
        Product storage p = _products[productId];
        require(p.status != Status.Cancelled, "ProductTransfer: product is cancelled");
        address prevHolder = p.currentHolder;
        require(prevHolder != msg.sender || p.status == Status.InTransit, "ProductTransfer: already in your possession");

        if (didRegistry.hasRole(msg.sender, "Manufacturer")) {
            require(p.manufacturer == msg.sender, "ProductTransfer: not the manufacturer of this product");
        } else if (didRegistry.hasRole(msg.sender, "Distributor")) {
            require(didRegistry.hasRole(prevHolder, "Retailer"), "ProductTransfer: Distributors can only recall from Retailers");
            TransferRecord[] storage h = _history[productId];
            require(h.length > 0 && h[h.length - 1].from == msg.sender, "ProductTransfer: you did not ship this product to the Retailer");
        } else {
            revert("ProductTransfer: not authorized to force recall");
        }

        if (p.status == Status.InTransit) {
            _history[productId][_history[productId].length - 1].cancelled = true;
            p.pendingRecipient = address(0);
        }
        p.currentHolder = msg.sender;
        p.status        = Status.InStock;
        _indexHolder(msg.sender, productId);
        if (prevHolder != msg.sender) _transfer(prevHolder, msg.sender, productId);

        _log("PRODUCT_FORCE_RECALLED", productId, string.concat("from=", Strings.toHexString(prevHolder)));
        emit ProductForceRecalled(productId, msg.sender, prevHolder);
    }

    /// @notice Permissionless: once a holder's licence is no longer valid, anyone can
    ///         move the product back upstream (or cancel it if the Manufacturer lost its licence).
    function reclaimProduct(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        address holder = p.currentHolder;
        require(p.status != Status.Cancelled, "ProductTransfer: product already cancelled");
        require(!credRegistry.isCredentialValid(holder), "ProductTransfer: holder credential still valid");

        if (holder == p.manufacturer) {
            p.status           = Status.Cancelled;
            p.currentHolder    = address(0);
            p.pendingRecipient = address(0);
            _burn(productId);
            _log("PRODUCT_CANCELLED", productId, "");
            emit ProductCancelled(productId, holder);
            return;
        }

        TransferRecord[] storage h = _history[productId];
        address target = h[h.length - 1].confirmed ? h[h.length - 1].from : p.manufacturer;
        if (!credRegistry.isCredentialValid(target)) target = p.manufacturer;
        require(credRegistry.isCredentialValid(target), "ProductTransfer: no upstream party with a valid credential");

        p.currentHolder    = target;
        p.pendingRecipient = address(0);
        p.status           = Status.InStock;
        _indexHolder(target, productId);
        _transfer(holder, target, productId);
        _log("PRODUCT_RECLAIMED", productId, string.concat("to=", Strings.toHexString(target)));
        emit ProductReclaimed(productId, holder, target);
    }

    // ── Views ───────────────────────────────────────────────────────────────
    function getProduct(uint256 productId) external view productExists(productId) returns (Product memory) { return _products[productId]; }
    function getTransferHistory(uint256 productId) external view productExists(productId) returns (TransferRecord[] memory) { return _history[productId]; }
    function getTransferCount(uint256 productId) external view returns (uint256) { return _history[productId].length; }
    function totalProducts() external view returns (uint256) { return _nextId - 1; }
    function getManufacturerProducts(address manufacturer) external view returns (uint256[] memory) { return _manufacturerProducts[manufacturer]; }
    function getHolderProducts(address holder) external view returns (uint256[] memory) { return _holderProducts[holder]; }
    function getShipmentsTo(address recipient) external view returns (uint256[] memory) { return _shipmentsTo[recipient]; }

    function getProducts(uint256[] calldata ids) external view returns (Product[] memory out) {
        out = new Product[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = _products[ids[i]];
    }

    // ── Internal ────────────────────────────────────────────────────────────
    function _indexHolder(address who, uint256 id) internal {
        if (!_heldIndexed[who][id]) { _heldIndexed[who][id] = true; _holderProducts[who].push(id); }
    }

    function _log(string memory action, uint256 id, string memory extra) internal {
        auditLog.logAction(msg.sender, action, string.concat("productId=", Strings.toString(id), bytes(extra).length > 0 ? " " : "", extra));
    }

    /// Products move only through shipTo/confirmReceipt — block direct ERC-721 transfers.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        require(auth == address(0), "ProductTransfer: use shipTo / confirmReceipt");
        return super._update(to, tokenId, auth);
    }
}
