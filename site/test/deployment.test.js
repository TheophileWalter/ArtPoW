import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { DEFAULTS, bytecode, constructorArgs, deployData, encodedConstructorArgs, validateDeployment, verifyCommand } from "../src/lib/deployment.js";

const values = { ...DEFAULTS, team: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" };

test("defaults are valid", () => {
  assert.deepEqual(validateDeployment(DEFAULTS), []);
  assert.equal(constructorArgs(DEFAULTS)[3], "0x0000000000000000000000000000000000000000");
});

test("validation catches what would revert or be wrong forever", () => {
  const check = (over) => validateDeployment({ ...values, ...over }).join(" ");
  assert.match(check({ name: "" }), /name is required/);
  assert.match(check({ symbol: "" }), /symbol is required/);
  assert.match(check({ name: 'Art"PoW' }), /Name: double quotes/);
  assert.match(check({ description: "line\nbreak" }), /Description: double quotes/);
  assert.match(check({ name: "ArtPoW " }), /trailing spaces/);
  assert.match(check({ team: "0x12" }), /team address/);
});

test("constructor arguments match Solidity's abi.encode", () => {
  const cast = execFileSync(`${homedir()}/.foundry/bin/cast`, [
    "abi-encode", "constructor(string,string,string,address)", values.name, values.symbol, values.description, values.team,
  ]).toString().trim();
  assert.equal(encodedConstructorArgs(values), cast);
  assert.equal(deployData(values), bytecode + cast.slice(2));
  assert.match(verifyCommand("0xabc", values, 137), /^forge verify-contract 0xabc src\/ArtPoW.sol:ArtPoW --chain 137 --constructor-args 0x[0-9a-f]+ --watch$/);
});
