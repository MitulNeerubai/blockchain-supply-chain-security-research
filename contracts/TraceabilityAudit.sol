// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ProductTransfer.sol";
import "./CredentialRegistry.sol";
import "./DIDRegistry.sol";

/// @title TraceabilityAudit — public, read-only chain-of-custody verification
contract TraceabilityAudit {
    struct AuditResult {
        bool    verified;
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

        ProductTransfer.Product memory p;
        try productTransfer.getProduct(productId) returns (ProductTransfer.Product memory _p) { p = _p; }
        catch { r.failReason = "Product not found"; return r; }

        r.productName    = p.name;
        r.ipfsCID        = p.ipfsCID;
        r.manufacturer   = p.manufacturer;
        r.manufacturedAt = p.createdAt;

        if (p.status == ProductTransfer.Status.Cancelled) { r.failReason = "Product was cancelled"; return r; }

        ProductTransfer.TransferRecord[] memory h = productTransfer.getTransferHistory(productId);

        // Walk confirmed, non-cancelled hops; the latest MF→DT followed by DT→RT is the custody chain.
        ProductTransfer.TransferRecord memory mfToDt;
        ProductTransfer.TransferRecord memory dtToRt;
        bool haveMf; bool haveRt;
        for (uint256 i = 0; i < h.length; i++) {
            if (!h[i].confirmed || h[i].cancelled) continue;
            if (h[i].from == p.manufacturer) { mfToDt = h[i]; haveMf = true; haveRt = false; }
            else if (haveMf && h[i].from == mfToDt.to) { dtToRt = h[i]; haveRt = true; }
        }
        if (!haveMf || !haveRt) { r.failReason = "Incomplete chain: product has not reached a retailer yet"; return r; }
        if (p.currentHolder != dtToRt.to || p.status != ProductTransfer.Status.Delivered) {
            r.failReason = "Product is no longer with the retailer (recalled or reclaimed)"; return r;
        }

        r.distributor          = mfToDt.to;
        r.retailer             = dtToRt.to;
        r.shippedToDistributor = mfToDt.timestamp;
        r.shippedToRetailer    = dtToRt.timestamp;

        if (!didRegistry.hasRole(r.manufacturer, "Manufacturer")) { r.failReason = "Manufacturer DID is not active or role is incorrect"; return r; }
        if (!didRegistry.hasRole(r.distributor,  "Distributor"))  { r.failReason = "Distributor DID is not active or role is incorrect";  return r; }
        if (!didRegistry.hasRole(r.retailer,     "Retailer"))     { r.failReason = "Retailer DID is not active or role is incorrect";     return r; }

        if (!credRegistry.isCredentialValid(r.manufacturer)) { r.failReason = "Manufacturer licence is not valid"; return r; }
        if (!credRegistry.isCredentialValid(r.distributor))  { r.failReason = "Distributor licence is not valid";  return r; }
        if (!credRegistry.isCredentialValid(r.retailer))     { r.failReason = "Retailer licence is not valid";     return r; }

        r.verified = true;
    }

    function isVerified(uint256 productId) external view returns (bool) {
        return auditProduct(productId).verified;
    }
}
