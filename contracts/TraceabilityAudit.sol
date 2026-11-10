// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ProductTransfer.sol";
import "./Custody.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";

/// @title TraceabilityAudit — public, read-only chain-of-custody verification
/// @notice Two separate answers:
///         • verified        — the product reached a Retailer through MF → DT → RT and
///                             every handoff was licensed AT THE TIME it happened.
///         • currentlyValid  — all three parties' licences are still live today.
///         A licence revoked after delivery does not undo a legitimate past handoff,
///         but the public page still shows that the licence is no longer valid.
contract TraceabilityAudit {
    struct AuditResult {
        bool    verified;
        bool    currentlyValid;
        uint256 productId;
        string  productName;
        string  ipfsCID;
        address manufacturer;
        address distributor;
        address retailer;
        uint256 manufacturedAt;
        uint256 shippedToDistributor;
        uint256 shippedToRetailer;
        string  failReason;
        string  currentNote;
    }

    ProductTransfer    public immutable productTransfer;
    CredentialRegistry public immutable credRegistry;
    DIDRegistry        public immutable didRegistry;

    constructor(address _productTransfer, address _credRegistry, address _didRegistry) {
        productTransfer = ProductTransfer(_productTransfer);
        credRegistry    = CredentialRegistry(_credRegistry);
        didRegistry     = DIDRegistry(_didRegistry);
    }

    function auditProduct(uint256 productId) public view returns (AuditResult memory r) {
        r.productId = productId;

        Custody.Product memory p;
        try productTransfer.getProduct(productId) returns (Custody.Product memory _p) { p = _p; }
        catch { r.failReason = "Product not found"; return r; }

        r.productName    = p.name;
        r.ipfsCID        = p.ipfsCID;
        r.manufacturer   = p.manufacturer;
        r.manufacturedAt = p.createdAt;

        if (p.status == Custody.Status.Deleted) { r.failReason = "Product was deleted by its manufacturer"; return r; }
        if (p.status != Custody.Status.Delivered) {
            r.failReason = p.status == Custody.Status.InTransit
                ? "Incomplete chain: product is in transit and has not reached a retailer yet"
                : "Incomplete chain: product is not at a retailer (not delivered yet, or returned / recalled)";
            return r;
        }

        // Delivered ⇒ the last confirmed hop is a Ship DT → RT (any later movement changes the status).
        Custody.TransferRecord[] memory h = productTransfer.getTransferHistory(productId);
        uint256 last = type(uint256).max;
        for (uint256 i = h.length; i > 0; i--) {
            if (h[i - 1].confirmed && !h[i - 1].cancelled) { last = i - 1; break; }
        }
        if (last == type(uint256).max || h[last].kind != Custody.Kind.Ship || h[last].to != p.currentHolder) {
            r.failReason = "Incomplete chain: no confirmed shipment to the retailer"; return r;
        }
        // The Distributor received it from the Manufacturer before that.
        bool haveMf;
        uint256 mfIdx;
        for (uint256 i = last; i > 0; i--) {
            Custody.TransferRecord memory x = h[i - 1];
            if (x.kind == Custody.Kind.Ship && x.confirmed && !x.cancelled && x.from == p.manufacturer && x.to == h[last].from) {
                haveMf = true; mfIdx = i - 1; break;
            }
        }
        if (!haveMf) { r.failReason = "Incomplete chain: no confirmed shipment from the manufacturer to the distributor"; return r; }

        r.distributor          = h[last].from;
        r.retailer             = h[last].to;
        r.shippedToDistributor = h[mfIdx].timestamp;
        r.shippedToRetailer    = h[last].timestamp;

        // Roles (registered on-chain, cannot change)
        if (!_roleIs(r.manufacturer, "Manufacturer")) { r.failReason = "Manufacturer role is incorrect"; return r; }
        if (!_roleIs(r.distributor,  "Distributor"))  { r.failReason = "Distributor role is incorrect";  return r; }
        if (!_roleIs(r.retailer,     "Retailer"))     { r.failReason = "Retailer role is incorrect";     return r; }

        // Licences at the moment of each handoff
        if (!credRegistry.hadLicenceAt(r.manufacturer, r.manufacturedAt)) {
            r.failReason = "Manufacturer had no valid licence when the product was created"; return r;
        }
        if (!credRegistry.wasLicensedAt(r.manufacturer, r.distributor, r.shippedToDistributor)) {
            r.failReason = "Distributor was not licensed by the manufacturer at the time of the handoff"; return r;
        }
        if (!credRegistry.wasLicensedAt(r.distributor, r.retailer, r.shippedToRetailer)) {
            r.failReason = "Retailer was not licensed by the distributor at the time of the handoff"; return r;
        }
        r.verified = true;

        // Today's status, reported separately
        if (!credRegistry.isCredentialValid(r.manufacturer)) r.currentNote = "Manufacturer's licence is no longer valid";
        else if (!credRegistry.isLicensedBy(r.distributor, r.manufacturer)) r.currentNote = "Distributor's licence from the manufacturer is no longer valid";
        else if (!credRegistry.isLicensedBy(r.retailer, r.distributor)) r.currentNote = "Retailer's licence from the distributor is no longer valid";
        else r.currentlyValid = true;
    }

    function isVerified(uint256 productId) external view returns (bool) {
        return auditProduct(productId).verified;
    }

    function _roleIs(address a, string memory role) internal view returns (bool) {
        return keccak256(bytes(didRegistry.getRole(a))) == keccak256(bytes(role));
    }
}
