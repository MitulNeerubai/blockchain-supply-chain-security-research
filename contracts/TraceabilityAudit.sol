// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProductTransfer {
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

    function getProduct(uint256 productId) external view returns (Product memory);
    function getTransferHistory(uint256 productId) external view returns (TransferRecord[] memory);
}

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

    IProductTransfer    public immutable productTransfer;
    ICredentialRegistry public immutable credRegistry;
    IDIDRegistry        public immutable didRegistry;

    constructor(
        address _productTransfer,
        address _credRegistry,
        address _didRegistry
    ) {
        productTransfer = IProductTransfer(_productTransfer);
        credRegistry    = ICredentialRegistry(_credRegistry);
        didRegistry     = IDIDRegistry(_didRegistry);
    }

    function auditProduct(uint256 productId)
        external
        view
        returns (AuditResult memory result)
    {
        result.productId = productId;

        IProductTransfer.Product memory p;
        try productTransfer.getProduct(productId) returns (IProductTransfer.Product memory _p) {
            p = _p;
        } catch {
            result.verified   = false;
            result.failReason = "Product not found";
            return result;
        }

        result.productName    = p.name;
        result.ipfsCID        = p.ipfsCID;
        result.manufacturer   = p.manufacturer;
        result.manufacturedAt = p.createdAt;

        IProductTransfer.TransferRecord[] memory history;
        try productTransfer.getTransferHistory(productId) returns (
            IProductTransfer.TransferRecord[] memory _h
        ) {
            history = _h;
        } catch {
            result.verified   = false;
            result.failReason = "Could not load transfer history";
            return result;
        }

        // Find first two confirmed, non-cancelled transfers (skips cancelled attempts)
        IProductTransfer.TransferRecord memory mfToDt;
        IProductTransfer.TransferRecord memory dtToRt;
        uint256 confirmedCount = 0;

        for (uint256 i = 0; i < history.length; i++) {
            if (history[i].confirmed && !history[i].cancelled) {
                if (confirmedCount == 0) {
                    mfToDt = history[i];
                    confirmedCount++;
                } else if (confirmedCount == 1) {
                    dtToRt = history[i];
                    confirmedCount++;
                    break;
                }
            }
        }

        if (confirmedCount < 2) {
            result.verified   = false;
            result.failReason = "Incomplete chain: product has not reached retailer yet";
            return result;
        }

        result.distributor          = mfToDt.to;
        result.retailer             = dtToRt.to;
        result.shippedToDistributor = mfToDt.timestamp;
        result.shippedToRetailer    = dtToRt.timestamp;

        if (mfToDt.from != p.manufacturer) {
            result.verified   = false;
            result.failReason = "Chain broken: first transfer not from original manufacturer";
            return result;
        }
        if (dtToRt.from != mfToDt.to) {
            result.verified   = false;
            result.failReason = "Chain broken: DT address mismatch between transfers";
            return result;
        }

        if (!credRegistry.isCredentialValid(p.manufacturer)) {
            result.verified   = false;
            result.failReason = "Manufacturer credential is not valid";
            return result;
        }
        if (!credRegistry.isCredentialValid(result.distributor)) {
            result.verified   = false;
            result.failReason = "Distributor credential is not valid";
            return result;
        }
        if (!credRegistry.isCredentialValid(result.retailer)) {
            result.verified   = false;
            result.failReason = "Retailer credential is not valid";
            return result;
        }

        IDIDRegistry.DIDDocument memory mfDoc = didRegistry.getDID(p.manufacturer);
        IDIDRegistry.DIDDocument memory dtDoc = didRegistry.getDID(result.distributor);
        IDIDRegistry.DIDDocument memory rtDoc = didRegistry.getDID(result.retailer);

        if (!mfDoc.active || keccak256(bytes(mfDoc.role)) != keccak256(bytes("Manufacturer"))) {
            result.verified   = false;
            result.failReason = "Manufacturer DID is not active or role is incorrect";
            return result;
        }
        if (!dtDoc.active || keccak256(bytes(dtDoc.role)) != keccak256(bytes("Distributor"))) {
            result.verified   = false;
            result.failReason = "Distributor DID is not active or role is incorrect";
            return result;
        }
        if (!rtDoc.active || keccak256(bytes(rtDoc.role)) != keccak256(bytes("Retailer"))) {
            result.verified   = false;
            result.failReason = "Retailer DID is not active or role is incorrect";
            return result;
        }

        result.verified   = true;
        result.failReason = "";
        return result;
    }

    function isVerified(uint256 productId) external view returns (bool) {
        AuditResult memory r = this.auditProduct(productId);
        return r.verified;
    }
}
