// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";
import "./AuditLog.sol";

/// @title ProductTransfer — products as ERC-721 tokens moving MF → DT → RT
/// @notice Licences are per relationship. A Distributor can work for several
///         Manufacturers: it may only receive/ship a product while it holds a
///         live licence from THAT product's Manufacturer. A Retailer may only
///         receive from a Distributor that licensed it.
///         Every handoff is two-step (ship, confirm). Products can also be sent
///         back upstream (return), pulled back (recall), or — when a licence has
///         lapsed — reverted / reclaimed by anyone, with the reason recorded.
contract ProductTransfer is ERC721 {
    enum Status { InStock, InTransit, Delivered, Deleted }
    enum Kind   { Ship, Return, Recall, Reclaim }

    struct TransferRecord {
        address from;
        address to;
        uint256 timestamp;
        bool    confirmed;
        bool    cancelled;
        Kind    kind;
        string  note;
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
    mapping(address => uint256[])        private _shipmentsTo;       // every product ever shipped/returned to the address
    mapping(address => mapping(uint256 => bool)) private _heldIndexed;
    mapping(address => mapping(uint256 => bool)) private _shipIndexed;

    event ProductCreated(uint256 indexed id, address indexed manufacturer, string name);
    event ProductDeleted(uint256 indexed id, address indexed manufacturer);
    event ProductShipped(uint256 indexed id, address indexed from, address indexed to);
    event ProductReturned(uint256 indexed id, address indexed from, address indexed to, string reason);
    event ProductReceived(uint256 indexed id, address indexed by);
    event ProductDelivered(uint256 indexed id, address indexed retailer);
    event ShipmentCancelled(uint256 indexed id, address indexed by, address indexed recipient);
    event ShipmentReverted(uint256 indexed id, address indexed sender, address indexed recipient, string reason);
    event ProductForceRecalled(uint256 indexed id, address indexed by, address indexed from);
    event ProductReclaimed(uint256 indexed id, address indexed from, address indexed to, string reason);

    constructor(address _credRegistry, address _didRegistry, address _auditLog)
        ERC721("Supply Chain Product", "SCP")
    {
        credRegistry = CredentialRegistry(_credRegistry);
        didRegistry  = DIDRegistry(_didRegistry);
        auditLog     = AuditLog(_auditLog);
    }

    modifier productExists(uint256 productId) {
        require(_products[productId].id != 0, "ProductTransfer: product not found");
        _;
    }

    // ── Create / delete ─────────────────────────────────────────────────────
    /// @notice Name, quantity, batch number and description are all required.
    function createProduct(
        string calldata name, string calldata ipfsCID, uint256 quantity,
        string calldata description, string calldata batchNumber
    ) external returns (uint256 id) {
        require(didRegistry.hasRole(msg.sender, "Manufacturer"), "ProductTransfer: only Manufacturers can create products");
        require(credRegistry.isCredentialValid(msg.sender), "ProductTransfer: no valid credential");
        _requireText(name, 80, "ProductTransfer: product name is required (max 80 characters)");
        _requireText(batchNumber, 40, "ProductTransfer: batch number is required (max 40 characters)");
        _requireText(description, 200, "ProductTransfer: description is required (max 200 characters)");
        require(quantity >= 1 && quantity <= 1_000_000_000, "ProductTransfer: quantity must be between 1 and 1,000,000,000");

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

    /// @notice Manufacturer deletes a product created by mistake. Only allowed
    ///         while it is in the manufacturer's own stock and has never been
    ///         received by anyone downstream.
    function deleteProduct(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.manufacturer == msg.sender, "ProductTransfer: only the manufacturer can delete");
        require(p.currentHolder == msg.sender && p.status == Status.InStock, "ProductTransfer: product must be in your stock to delete");
        TransferRecord[] storage h = _history[productId];
        for (uint256 i = 0; i < h.length; i++) {
            require(!h[i].confirmed, "ProductTransfer: product already left your stock once; it cannot be deleted");
        }
        p.status        = Status.Deleted;
        p.currentHolder = address(0);
        _burn(productId);
        _log("PRODUCT_DELETED", productId, "");
        emit ProductDeleted(productId, msg.sender);
    }

    // ── Ship / return / confirm / cancel ────────────────────────────────────
    function shipTo(uint256 productId, address recipient) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Status.InStock, "ProductTransfer: product not in stock");
        require(recipient != msg.sender, "ProductTransfer: cannot ship to yourself");
        require(_partyOk(p, msg.sender), msg.sender == p.manufacturer
            ? "ProductTransfer: no valid credential"
            : "ProductTransfer: your licence from this product's Manufacturer is not active");
        require(credRegistry.isLicensedBy(recipient, msg.sender), "ProductTransfer: recipient is not licensed by you");

        _send(p, recipient, Kind.Ship, "");
        _log("PRODUCT_SHIPPED", productId, string.concat("to=", Strings.toHexString(recipient)));
        emit ProductShipped(productId, msg.sender, recipient);
    }

    /// @notice Distributor sends a product back to its Manufacturer, or a Retailer
    ///         back to the Distributor that shipped it. The upstream party confirms.
    ///         Works even if your own licence has lapsed — returning goods is always allowed.
    function returnToSender(uint256 productId, string calldata reason) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Status.InStock || p.status == Status.Delivered, "ProductTransfer: product must be in your stock to return it");
        require(msg.sender != p.manufacturer, "ProductTransfer: the manufacturer has no one to return to");
        _requireText(reason, 200, "ProductTransfer: give a reason for the return (max 200 characters)");

        address to = _upstreamOf(productId, msg.sender, p.manufacturer);
        _send(p, to, Kind.Return, reason);
        _log("PRODUCT_RETURNED", productId, string.concat("to=", Strings.toHexString(to)));
        emit ProductReturned(productId, msg.sender, to, reason);
    }

    function confirmReceipt(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        require(p.pendingRecipient == msg.sender, "ProductTransfer: not the pending recipient");
        TransferRecord storage rec = _history[productId][_history[productId].length - 1];
        require(_isOk(msg.sender, _recipientIssuer(p, rec)), "ProductTransfer: your licence for this shipment is not active");

        rec.confirmed = true;
        address prev = p.currentHolder;
        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);
        _indexHolder(msg.sender, productId);

        if (rec.kind == Kind.Ship && didRegistry.hasRole(msg.sender, "Retailer")) {
            p.status = Status.Delivered;
            emit ProductDelivered(productId, msg.sender);
        } else {
            p.status = Status.InStock;
        }
        _transfer(prev, msg.sender, productId);

        _log("PRODUCT_RECEIVED", productId, "");
        emit ProductReceived(productId, msg.sender);
    }

    /// @notice Sender cancels a shipment (or return) that has not been confirmed yet.
    function cancelShipment(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        address recipient = _cancelPending(p, "Cancelled by sender");

        _log("SHIPMENT_CANCELLED", productId, "");
        emit ShipmentCancelled(productId, msg.sender, recipient);
    }

    // ── Recall / reclaim ────────────────────────────────────────────────────
    /// @notice Manufacturer can pull its own product back from anyone downstream.
    ///         Distributor can pull a product back from a Retailer it shipped to.
    function forceRecall(uint256 productId) external productExists(productId) {
        Product storage p = _products[productId];
        require(p.status != Status.Deleted, "ProductTransfer: product was deleted");
        address prevHolder = p.currentHolder;
        require(prevHolder != msg.sender || p.status == Status.InTransit, "ProductTransfer: already in your possession");

        if (msg.sender == p.manufacturer) {
            require(credRegistry.isCredentialValid(msg.sender), "ProductTransfer: no valid credential");
        } else if (didRegistry.hasRole(msg.sender, "Distributor")) {
            require(didRegistry.hasRole(prevHolder, "Retailer"), "ProductTransfer: Distributors can only recall from Retailers");
            require(_shipperTo(productId, prevHolder) == msg.sender, "ProductTransfer: you did not ship this product to the Retailer");
            require(_partyOk(p, msg.sender), "ProductTransfer: your licence from this product's Manufacturer is not active");
        } else {
            revert("ProductTransfer: not authorized to force recall");
        }

        if (p.status == Status.InTransit) _cancelPending(p, "Cancelled by recall");
        if (prevHolder != msg.sender) {
            _move(p, prevHolder, msg.sender, Kind.Recall, string.concat("Recalled by ", _name(msg.sender)));
        }
        _log("PRODUCT_FORCE_RECALLED", productId, string.concat("from=", Strings.toHexString(prevHolder)));
        emit ProductForceRecalled(productId, msg.sender, prevHolder);
    }

    /// @notice Can `reclaimProduct` run right now, and what would it record?
    function reclaimable(uint256 productId) public view productExists(productId) returns (bool ok, string memory reason) {
        (ok, reason, ) = _reclaimCheck(productId);
    }

    /// @notice Permissionless call-back when a licence lapses (revoked / expired / suspended):
    ///         • in transit and the recipient's licence lapsed → shipment reverts to the sender
    ///         • held by someone whose licence lapsed        → product goes back upstream
    ///         A Manufacturer's own stock is frozen (not destroyed) while its licence is down.
    function reclaimProduct(uint256 productId) external productExists(productId) {
        (bool ok, string memory reason, address target) = _reclaimCheck(productId);
        require(ok, string.concat("ProductTransfer: ", reason));
        Product storage p = _products[productId];

        if (p.status == Status.InTransit) {
            address recipient = _cancelPending(p, reason);
            _log("SHIPMENT_REVERTED", productId, reason);
            emit ShipmentReverted(productId, p.currentHolder, recipient, reason);
            return;
        }
        address holder = p.currentHolder;
        _move(p, holder, target, Kind.Reclaim, reason);
        _log("PRODUCT_RECLAIMED", productId, string.concat("to=", Strings.toHexString(target)));
        emit ProductReclaimed(productId, holder, target, reason);
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

    /// @notice Latest history record of each product (empty record if none) — for list views.
    function getLastRecords(uint256[] calldata ids) external view returns (TransferRecord[] memory out) {
        out = new TransferRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            TransferRecord[] storage h = _history[ids[i]];
            if (h.length > 0) out[i] = h[h.length - 1];
        }
    }

    /// @notice The party that shipped the product to `who` most recently (0x0 if none).
    function shipperTo(uint256 productId, address who) external view returns (address) { return _shipperTo(productId, who); }

    // ── Internal: movement ──────────────────────────────────────────────────
    function _send(Product storage p, address to, Kind kind, string memory note) internal {
        p.status           = Status.InTransit;
        p.pendingRecipient = to;
        _history[p.id].push(TransferRecord(msg.sender, to, block.timestamp, false, false, kind, note));
        if (!_shipIndexed[to][p.id]) { _shipIndexed[to][p.id] = true; _shipmentsTo[to].push(p.id); }
    }

    /// Cancels the open shipment (marks its record, keeps custody with the sender).
    function _cancelPending(Product storage p, string memory note) internal returns (address recipient) {
        TransferRecord storage rec = _history[p.id][_history[p.id].length - 1];
        rec.cancelled = true;
        rec.note      = note;
        recipient          = p.pendingRecipient;
        p.pendingRecipient = address(0);
        p.status           = Status.InStock;
    }

    /// Immediate custody change (recall / reclaim), recorded as a confirmed history entry.
    function _move(Product storage p, address from, address to, Kind kind, string memory note) internal {
        _history[p.id].push(TransferRecord(from, to, block.timestamp, true, false, kind, note));
        p.currentHolder    = to;
        p.pendingRecipient = address(0);
        p.status           = Status.InStock;
        _indexHolder(to, p.id);
        _transfer(from, to, p.id);
    }

    // ── Internal: who may hold this product ─────────────────────────────────
    /// The issuer whose licence `who` needs for this product (0x0 = any licence, for the manufacturer).
    function _partyIssuer(Product storage p, address who) internal view returns (address) {
        if (who == p.manufacturer) return address(0);
        if (_roleIs(who, "Distributor")) return p.manufacturer;
        return _shipperTo(p.id, who);               // Retailer: the Distributor that shipped it
    }

    function _recipientIssuer(Product storage p, TransferRecord storage rec) internal view returns (address) {
        return rec.kind == Kind.Ship ? rec.from : _partyIssuer(p, rec.to);
    }

    function _isOk(address who, address issuer) internal view returns (bool) {
        return issuer == address(0) ? credRegistry.isCredentialValid(who) : credRegistry.isLicensedBy(who, issuer);
    }

    function _partyOk(Product storage p, address who) internal view returns (bool) {
        return _isOk(who, _partyIssuer(p, who));
    }

    function _shipperTo(uint256 id, address who) internal view returns (address) {
        TransferRecord[] storage h = _history[id];
        for (uint256 i = h.length; i > 0; i--) {
            TransferRecord storage r = h[i - 1];
            if (r.kind == Kind.Ship && r.confirmed && !r.cancelled && r.to == who) return r.from;
        }
        return address(0);
    }

    function _upstreamOf(uint256 id, address holder, address manufacturer) internal view returns (address) {
        address s = _shipperTo(id, holder);
        return s == address(0) ? manufacturer : s;
    }

    function _reclaimCheck(uint256 id) internal view returns (bool ok, string memory reason, address target) {
        Product storage p = _products[id];
        if (p.status == Status.Deleted) return (false, "product was deleted", address(0));

        if (p.status == Status.InTransit) {
            TransferRecord storage rec = _history[id][_history[id].length - 1];
            address issuer = _recipientIssuer(p, rec);
            if (_isOk(rec.to, issuer)) return (false, "recipient's licence is still valid", address(0));
            return (true, string.concat("Shipment reverted to sender: ", _lapse(rec.to, issuer)), p.currentHolder);
        }

        address holder = p.currentHolder;
        address hIssuer = _partyIssuer(p, holder);
        if (_isOk(holder, hIssuer)) return (false, "holder's licence is still valid", address(0));
        if (holder == p.manufacturer) {
            return (false, "the manufacturer's licence is not valid; its stock stays frozen until the licence is restored", address(0));
        }
        target = _upstreamOf(id, holder, p.manufacturer);
        if (target != p.manufacturer && !_partyOk(p, target)) target = p.manufacturer;
        return (true, string.concat("Called back to ", _name(target), ": ", _lapse(holder, hIssuer)), target);
    }

    /// "licence of <Company> was revoked / has expired / is suspended"
    function _lapse(address who, address issuer) internal view returns (string memory) {
        CredentialRegistry.State s = issuer == address(0)
            ? credRegistry.holderState(who)
            : credRegistry.pairState(issuer, who);
        string memory what =
            s == CredentialRegistry.State.Revoked   ? "was revoked" :
            s == CredentialRegistry.State.Expired   ? "has expired" :
            s == CredentialRegistry.State.Suspended ? "is suspended (its issuer lost its own licence)" :
            !didRegistry.isActiveDID(who)           ? "is unusable (DID deactivated)" :
                                                      "is missing";
        return string.concat("licence of ", _name(who), " ", what);
    }

    // ── Internal: misc ──────────────────────────────────────────────────────
    function _name(address a) internal view returns (string memory n) {
        n = didRegistry.getCompanyName(a);
        if (bytes(n).length == 0) n = Strings.toHexString(a);
    }

    function _roleIs(address a, string memory role) internal view returns (bool) {
        return keccak256(bytes(didRegistry.getRole(a))) == keccak256(bytes(role));
    }

    function _requireText(string calldata s, uint256 max, string memory err) internal pure {
        bytes calldata b = bytes(s);
        require(b.length > 0 && b.length <= max && b[0] != 0x20 && b[b.length - 1] != 0x20, err);
    }

    function _indexHolder(address who, uint256 id) internal {
        if (!_heldIndexed[who][id]) { _heldIndexed[who][id] = true; _holderProducts[who].push(id); }
    }

    function _log(string memory action, uint256 id, string memory extra) internal {
        auditLog.logAction(msg.sender, action, string.concat("productId=", Strings.toString(id), bytes(extra).length > 0 ? " " : "", extra));
    }

    /// Products move only through this contract's functions — block direct ERC-721 transfers.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        require(auth == address(0), "ProductTransfer: use shipTo / confirmReceipt");
        return super._update(to, tokenId, auth);
    }
}
