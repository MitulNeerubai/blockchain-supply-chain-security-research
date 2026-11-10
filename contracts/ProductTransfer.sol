// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";
import "./AuditLog.sol";
import "./Custody.sol";

/// @title ProductTransfer — products as ERC-721 tokens moving MF → DT → RT
/// @notice Licences are per relationship. A Distributor can work for several
///         Manufacturers: it may only receive/ship a product while it holds a
///         live licence from THAT product's Manufacturer. A Retailer may only
///         receive from a Distributor that licensed it.
///         Every handoff is two-step (ship, confirm). Products can also be sent
///         back upstream (return), pulled back (recall), or — when a licence has
///         lapsed — reverted / reclaimed by anyone, with the reason recorded.
///         The licence rules live in the linked `Custody` library.
contract ProductTransfer is ERC721 {
    using Custody for Custody.Product;

    CredentialRegistry public immutable credRegistry;
    DIDRegistry        public immutable didRegistry;
    AuditLog           public immutable auditLog;

    uint256 private _nextId = 1;

    mapping(uint256 => Custody.Product)          private _products;
    mapping(uint256 => Custody.TransferRecord[]) private _history;
    mapping(address => uint256[])                private _manufacturerProducts;
    mapping(address => uint256[])                private _holderProducts;  // every product the address has ever held
    mapping(address => uint256[])                private _shipmentsTo;     // every product ever shipped/returned to the address
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
        Custody.checkCreate(name, batchNumber, description, quantity);

        id = _nextId++;
        _products[id] = Custody.Product({
            id: id, name: name, ipfsCID: ipfsCID, manufacturer: msg.sender,
            currentHolder: msg.sender, pendingRecipient: address(0), status: Custody.Status.InStock,
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
        Custody.Product storage p = _products[productId];
        Custody.checkDelete(p, _history[productId], msg.sender);
        p.status        = Custody.Status.Deleted;
        p.currentHolder = address(0);
        _burn(productId);
        _log("PRODUCT_DELETED", productId, "");
        emit ProductDeleted(productId, msg.sender);
    }

    // ── Ship / return / confirm / cancel ────────────────────────────────────
    function shipTo(uint256 productId, address recipient) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        Custody.checkShip(p, _history[productId], msg.sender, recipient, credRegistry, didRegistry);

        _send(p, recipient, Custody.Kind.Ship, "");
        _log("PRODUCT_SHIPPED", productId, string.concat("to=", Strings.toHexString(recipient)));
        emit ProductShipped(productId, msg.sender, recipient);
    }

    /// @notice Distributor sends a product back to its Manufacturer, or a Retailer
    ///         back to the Distributor that shipped it. The upstream party confirms.
    ///         Works even if your own licence has lapsed — returning goods is always allowed.
    function returnToSender(uint256 productId, string calldata reason) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        address to = Custody.checkReturn(p, _history[productId], msg.sender, reason);
        _send(p, to, Custody.Kind.Return, reason);
        _log("PRODUCT_RETURNED", productId, string.concat("to=", Strings.toHexString(to)));
        emit ProductReturned(productId, msg.sender, to, reason);
    }

    function confirmReceipt(uint256 productId) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        Custody.TransferRecord[] storage h = _history[productId];
        Custody.checkConfirm(p, h, msg.sender, credRegistry, didRegistry);

        Custody.TransferRecord storage rec = h[h.length - 1];
        rec.confirmed = true;
        address prev = p.currentHolder;
        p.currentHolder    = msg.sender;
        p.pendingRecipient = address(0);
        _indexHolder(msg.sender, productId);

        if (rec.kind == Custody.Kind.Ship && didRegistry.hasRole(msg.sender, "Retailer")) {
            p.status = Custody.Status.Delivered;
            emit ProductDelivered(productId, msg.sender);
        } else {
            p.status = Custody.Status.InStock;
        }
        _transfer(prev, msg.sender, productId);

        _log("PRODUCT_RECEIVED", productId, "");
        emit ProductReceived(productId, msg.sender);
    }

    /// @notice Sender cancels a shipment (or return) that has not been confirmed yet.
    function cancelShipment(uint256 productId) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        require(p.currentHolder == msg.sender, "ProductTransfer: not current holder");
        require(p.status == Custody.Status.InTransit, "ProductTransfer: not in transit");
        address recipient = _cancelPending(p, "Cancelled by sender");

        _log("SHIPMENT_CANCELLED", productId, "");
        emit ShipmentCancelled(productId, msg.sender, recipient);
    }

    // ── Recall / reclaim ────────────────────────────────────────────────────
    /// @notice Manufacturer can pull its own product back from anyone downstream.
    ///         Distributor can pull a product back from a Retailer it shipped to.
    function forceRecall(uint256 productId) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        Custody.checkRecall(p, _history[productId], msg.sender, credRegistry, didRegistry);
        address prevHolder = p.currentHolder;

        if (p.status == Custody.Status.InTransit) _cancelPending(p, "Cancelled by recall");
        if (prevHolder != msg.sender) {
            _move(p, prevHolder, msg.sender, Custody.Kind.Recall, string.concat("Recalled by ", Custody.name(didRegistry, msg.sender)));
        }
        _log("PRODUCT_FORCE_RECALLED", productId, string.concat("from=", Strings.toHexString(prevHolder)));
        emit ProductForceRecalled(productId, msg.sender, prevHolder);
    }

    /// @notice Can `reclaimProduct` run right now, and what would it record?
    function reclaimable(uint256 productId) external view productExists(productId) returns (bool ok, string memory reason) {
        (ok, reason, ) = Custody.reclaimCheck(_products[productId], _history[productId], credRegistry, didRegistry);
    }

    /// @notice Permissionless call-back when a licence lapses (revoked / expired / suspended):
    ///         • in transit and the recipient's licence lapsed → shipment reverts to the sender
    ///         • held by someone whose licence lapsed        → product goes back upstream
    ///         A Manufacturer's own stock is frozen (not destroyed) while its licence is down.
    function reclaimProduct(uint256 productId) external productExists(productId) {
        Custody.Product storage p = _products[productId];
        (bool ok, string memory reason, address target) = Custody.reclaimCheck(p, _history[productId], credRegistry, didRegistry);
        require(ok, string.concat("ProductTransfer: ", reason));

        if (p.status == Custody.Status.InTransit) {
            address recipient = _cancelPending(p, reason);
            _log("SHIPMENT_REVERTED", productId, reason);
            emit ShipmentReverted(productId, p.currentHolder, recipient, reason);
            return;
        }
        address holder = p.currentHolder;
        _move(p, holder, target, Custody.Kind.Reclaim, reason);
        _log("PRODUCT_RECLAIMED", productId, string.concat("to=", Strings.toHexString(target)));
        emit ProductReclaimed(productId, holder, target, reason);
    }

    // ── Views ───────────────────────────────────────────────────────────────
    function getProduct(uint256 productId) external view productExists(productId) returns (Custody.Product memory) { return _products[productId]; }
    function getTransferHistory(uint256 productId) external view productExists(productId) returns (Custody.TransferRecord[] memory) { return _history[productId]; }
    function getTransferCount(uint256 productId) external view returns (uint256) { return _history[productId].length; }
    function totalProducts() external view returns (uint256) { return _nextId - 1; }
    function getManufacturerProducts(address manufacturer) external view returns (uint256[] memory) { return _manufacturerProducts[manufacturer]; }
    function getHolderProducts(address holder) external view returns (uint256[] memory) { return _holderProducts[holder]; }
    function getShipmentsTo(address recipient) external view returns (uint256[] memory) { return _shipmentsTo[recipient]; }

    function getProducts(uint256[] calldata ids) external view returns (Custody.Product[] memory out) {
        out = new Custody.Product[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = _products[ids[i]];
    }

    /// @notice Latest history record of each product (empty record if none) — for list views.
    function getLastRecords(uint256[] calldata ids) external view returns (Custody.TransferRecord[] memory out) {
        out = new Custody.TransferRecord[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            Custody.TransferRecord[] storage h = _history[ids[i]];
            if (h.length > 0) out[i] = h[h.length - 1];
        }
    }

    /// @notice The party that shipped the product to `who` most recently (0x0 if none).
    function shipperTo(uint256 productId, address who) external view returns (address) { return Custody.shipperTo(_history[productId], who); }

    // ── Internal ────────────────────────────────────────────────────────────
    function _send(Custody.Product storage p, address to, Custody.Kind kind, string memory note) internal {
        p.status           = Custody.Status.InTransit;
        p.pendingRecipient = to;
        _history[p.id].push(Custody.TransferRecord(msg.sender, to, block.timestamp, false, false, kind, note));
        if (!_shipIndexed[to][p.id]) { _shipIndexed[to][p.id] = true; _shipmentsTo[to].push(p.id); }
    }

    /// Cancels the open shipment (marks its record, keeps custody with the sender).
    function _cancelPending(Custody.Product storage p, string memory note) internal returns (address recipient) {
        Custody.TransferRecord storage rec = _history[p.id][_history[p.id].length - 1];
        rec.cancelled = true;
        rec.note      = note;
        recipient          = p.pendingRecipient;
        p.pendingRecipient = address(0);
        p.status           = Custody.Status.InStock;
    }

    /// Immediate custody change (recall / reclaim), recorded as a confirmed history entry.
    function _move(Custody.Product storage p, address from, address to, Custody.Kind kind, string memory note) internal {
        _history[p.id].push(Custody.TransferRecord(from, to, block.timestamp, true, false, kind, note));
        p.currentHolder    = to;
        p.pendingRecipient = address(0);
        p.status           = Custody.Status.InStock;
        _indexHolder(to, p.id);
        _transfer(from, to, p.id);
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
