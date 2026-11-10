// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Strings.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";

/// @title Custody — product types + "who may hold this product" rules
/// @notice Linked library used by ProductTransfer. Split out so ProductTransfer
///         fits DIDLab Besu's 4.7M block gas limit. Public functions run via
///         DELEGATECALL on ProductTransfer's storage.
library Custody {
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

    // ── Permission checks (revert with the reason) ─────────────────────────
    /// Name, batch number and description are required; quantity 1..1e9.
    function checkCreate(string calldata name_, string calldata batch, string calldata desc, uint256 quantity) external pure {
        _requireText(name_, 80, "ProductTransfer: product name is required (max 80 characters)");
        _requireText(batch, 40, "ProductTransfer: batch number is required (max 40 characters)");
        _requireText(desc, 200, "ProductTransfer: description is required (max 200 characters)");
        require(quantity >= 1 && quantity <= 1_000_000_000, "ProductTransfer: quantity must be between 1 and 1,000,000,000");
    }

    function checkDelete(Product storage p, TransferRecord[] storage h, address sender) external view {
        require(p.manufacturer == sender, "ProductTransfer: only the manufacturer can delete");
        require(p.currentHolder == sender && p.status == Status.InStock, "ProductTransfer: product must be in your stock to delete");
        for (uint256 i = 0; i < h.length; i++) {
            require(!h[i].confirmed, "ProductTransfer: product already left your stock once; it cannot be deleted");
        }
    }

    function checkShip(Product storage p, TransferRecord[] storage h, address sender, address recipient, CredentialRegistry cred, DIDRegistry did)
        external view
    {
        require(p.currentHolder == sender, "ProductTransfer: not current holder");
        require(p.status == Status.InStock, "ProductTransfer: product not in stock");
        require(recipient != sender, "ProductTransfer: cannot ship to yourself");
        require(_isOk(cred, sender, _partyIssuer(p, h, sender, did)), sender == p.manufacturer
            ? "ProductTransfer: no valid credential"
            : "ProductTransfer: your licence from this product's Manufacturer is not active");
        require(cred.isLicensedBy(recipient, sender), "ProductTransfer: recipient is not licensed by you");
    }

    /// Returns the upstream party the product goes back to.
    function checkReturn(Product storage p, TransferRecord[] storage h, address sender, string calldata reason) external view returns (address) {
        require(p.currentHolder == sender, "ProductTransfer: not current holder");
        require(p.status == Status.InStock || p.status == Status.Delivered, "ProductTransfer: product must be in your stock to return it");
        require(sender != p.manufacturer, "ProductTransfer: the manufacturer has no one to return to");
        _requireText(reason, 200, "ProductTransfer: give a reason for the return (max 200 characters)");
        return upstreamOf(p, h, sender);
    }

    function checkConfirm(Product storage p, TransferRecord[] storage h, address sender, CredentialRegistry cred, DIDRegistry did) external view {
        require(p.status == Status.InTransit, "ProductTransfer: not in transit");
        require(p.pendingRecipient == sender, "ProductTransfer: not the pending recipient");
        require(recipientOk(p, h, cred, did), "ProductTransfer: your licence for this shipment is not active");
    }

    function checkRecall(Product storage p, TransferRecord[] storage h, address sender, CredentialRegistry cred, DIDRegistry did) external view {
        require(p.status != Status.Deleted, "ProductTransfer: product was deleted");
        address prevHolder = p.currentHolder;
        require(prevHolder != sender || p.status == Status.InTransit, "ProductTransfer: already in your possession");
        if (sender == p.manufacturer) {
            require(cred.isCredentialValid(sender), "ProductTransfer: no valid credential");
        } else if (did.hasRole(sender, "Distributor")) {
            require(did.hasRole(prevHolder, "Retailer"), "ProductTransfer: Distributors can only recall from Retailers");
            require(_shipperTo(h, prevHolder) == sender, "ProductTransfer: you did not ship this product to the Retailer");
            require(_isOk(cred, sender, p.manufacturer), "ProductTransfer: your licence from this product's Manufacturer is not active");
        } else {
            revert("ProductTransfer: not authorized to force recall");
        }
    }

    function _requireText(string calldata s, uint256 max, string memory err) private pure {
        bytes calldata b = bytes(s);
        require(b.length > 0 && b.length <= max && b[0] != 0x20 && b[b.length - 1] != 0x20, err);
    }

    // ── Public (linked) ─────────────────────────────────────────────────────
    /// The party that shipped the product to `who` most recently (0x0 if none).
    function shipperTo(TransferRecord[] storage h, address who) public view returns (address) {
        return _shipperTo(h, who);
    }

    /// Does `who` hold the licence needed for this product?
    ///   manufacturer → any live licence · Distributor → from the product's manufacturer
    ///   Retailer → from the Distributor that shipped it
    function partyOk(Product storage p, TransferRecord[] storage h, address who, CredentialRegistry cred, DIDRegistry did)
        public view returns (bool)
    {
        return _isOk(cred, who, _partyIssuer(p, h, who, did));
    }

    /// May the pending recipient accept the open shipment / return?
    function recipientOk(Product storage p, TransferRecord[] storage h, CredentialRegistry cred, DIDRegistry did)
        public view returns (bool)
    {
        TransferRecord storage rec = h[h.length - 1];
        return _isOk(cred, rec.to, _recipientIssuer(p, h, rec, did));
    }

    /// Upstream party a holder returns to (its shipper, or the manufacturer).
    function upstreamOf(Product storage p, TransferRecord[] storage h, address holder) public view returns (address) {
        address s = _shipperTo(h, holder);
        return s == address(0) ? p.manufacturer : s;
    }

    /// Can the product be called back right now? Returns the note to record and the target.
    function reclaimCheck(Product storage p, TransferRecord[] storage h, CredentialRegistry cred, DIDRegistry did)
        public view returns (bool ok, string memory reason, address target)
    {
        if (p.status == Status.Deleted) return (false, "product was deleted", address(0));

        if (p.status == Status.InTransit) {
            TransferRecord storage rec = h[h.length - 1];
            address issuer = _recipientIssuer(p, h, rec, did);
            if (_isOk(cred, rec.to, issuer)) return (false, "recipient's licence is still valid", address(0));
            return (true, string.concat("Shipment reverted to sender: ", _lapse(cred, did, rec.to, issuer)), p.currentHolder);
        }

        address holder = p.currentHolder;
        address hIssuer = _partyIssuer(p, h, holder, did);
        if (_isOk(cred, holder, hIssuer)) return (false, "holder's licence is still valid", address(0));
        if (holder == p.manufacturer) {
            return (false, "the manufacturer's licence is not valid; its stock stays frozen until the licence is restored", address(0));
        }
        target = upstreamOf(p, h, holder);
        if (target != p.manufacturer && !_isOk(cred, target, _partyIssuer(p, h, target, did))) target = p.manufacturer;
        return (true, string.concat("Called back to ", name(did, target), ": ", _lapse(cred, did, holder, hIssuer)), target);
    }

    function name(DIDRegistry did, address a) public view returns (string memory n) {
        n = did.getCompanyName(a);
        if (bytes(n).length == 0) n = Strings.toHexString(a);
    }

    // ── Internal ────────────────────────────────────────────────────────────
    function _shipperTo(TransferRecord[] storage h, address who) private view returns (address) {
        for (uint256 i = h.length; i > 0; i--) {
            TransferRecord storage r = h[i - 1];
            if (r.kind == Kind.Ship && r.confirmed && !r.cancelled && r.to == who) return r.from;
        }
        return address(0);
    }

    /// Issuer whose licence `who` needs for this product (0x0 = any licence, for the manufacturer).
    function _partyIssuer(Product storage p, TransferRecord[] storage h, address who, DIDRegistry did) private view returns (address) {
        if (who == p.manufacturer) return address(0);
        if (keccak256(bytes(did.getRole(who))) == keccak256("Distributor")) return p.manufacturer;
        return _shipperTo(h, who);
    }

    function _recipientIssuer(Product storage p, TransferRecord[] storage h, TransferRecord storage rec, DIDRegistry did)
        private view returns (address)
    {
        return rec.kind == Kind.Ship ? rec.from : _partyIssuer(p, h, rec.to, did);
    }

    function _isOk(CredentialRegistry cred, address who, address issuer) private view returns (bool) {
        return issuer == address(0) ? cred.isCredentialValid(who) : cred.isLicensedBy(who, issuer);
    }

    /// "licence of <Company> was revoked / has expired / is suspended"
    function _lapse(CredentialRegistry cred, DIDRegistry did, address who, address issuer) private view returns (string memory) {
        CredentialRegistry.State s = issuer == address(0) ? cred.holderState(who) : cred.pairState(issuer, who);
        string memory what =
            s == CredentialRegistry.State.Revoked   ? "was revoked" :
            s == CredentialRegistry.State.Expired   ? "has expired" :
            s == CredentialRegistry.State.Suspended ? "is suspended (its issuer lost its own licence)" :
            !did.isActiveDID(who)                   ? "is unusable (DID deactivated)" :
                                                      "is missing";
        return string.concat("licence of ", name(did, who), " ", what);
    }
}
