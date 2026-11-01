// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ArtPoW} from "../src/ArtPoW.sol";

/// @notice Deploys ArtPoW. The deployer becomes the first administrator and the first `owner()`;
/// further administrators are added later with `proposeAdmin`, then `acceptAdmin` from their own address.
///
/// Environment:
///   COLLECTION_NAME, COLLECTION_SYMBOL, COLLECTION_DESCRIPTION   required
///   TEAM_RECIPIENT      receives the team proofs (default: none)
///   COLLECTION_IMAGE    collection logo URI (default: empty)
///   SITE_URL            website, also used for each token's external_url (default: empty)
///
/// The constructor makes `msg.sender` the first administrator: deploy with a plain `new` from the deployer wallet,
/// never through a factory or CREATE2 proxy, which would become the administrator instead.
///
/// Example (Amoy testnet, deployer key stored with `cast wallet import deployer --interactive`):
///   forge script script/Deploy.s.sol --rpc-url amoy --account deployer --broadcast --verify
contract Deploy is Script {
    function run() external returns (ArtPoW nft) {
        string memory name_ = vm.envString("COLLECTION_NAME");
        string memory symbol_ = vm.envString("COLLECTION_SYMBOL");
        string memory description = vm.envString("COLLECTION_DESCRIPTION");
        address team = vm.envOr("TEAM_RECIPIENT", address(0));
        string memory image = vm.envOr("COLLECTION_IMAGE", string(""));
        string memory site = vm.envOr("SITE_URL", string(""));

        vm.startBroadcast();
        nft = new ArtPoW(name_, symbol_, description, team);
        if (bytes(image).length > 0 || bytes(site).length > 0) nft.setCollectionInfo(image, site);
        vm.stopBroadcast();

        console.log("ArtPoW deployed at", address(nft));
        console.log("administrator and owner():", nft.owner());
        console.log("team recipient:", nft.teamRecipient());
    }
}
