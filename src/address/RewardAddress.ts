import { bech32 } from "bech32";
import { HashType, NetworkId } from "../types";
import type { Credential } from "../types";
import { concatBytes, toHex } from "../utils/bytes";

export class RewardAddress {
  protected _stakeCredential: Credential;
  protected networkId: NetworkId;
  protected addressHex = "";
  protected addressBytes: Uint8Array = new Uint8Array(0);
  protected addressBech32 = "";

  constructor(networkId: NetworkId, stakeCredential: Credential) {
    this._stakeCredential = stakeCredential;
    this.networkId = networkId;
    this.computeHex();
  }

  protected computeBech32(address: Uint8Array): string {
    const data = this.networkId === NetworkId.MAINNET ? "stake" : "stake_test";
    const words = bech32.toWords(address);
    const encoded = bech32.encode(data, words, 1000);
    return encoded;
  }

  protected computeHex(): void {
    // bit 4 is set for a script stake credential
    const header =
      (this._stakeCredential.type === HashType.SCRIPT ? 0b1111_0000 : 0b1110_0000) | this.networkId;
    this.addressBytes = concatBytes(Uint8Array.of(header), this._stakeCredential.hash);
    this.addressHex = toHex(this.addressBytes);
    this.addressBech32 = this.computeBech32(this.addressBytes);
  }

  get stakeCredential() {
    return this._stakeCredential;
  }

  getHex(): string {
    return this.addressHex;
  }

  getBytes(): Uint8Array {
    return this.addressBytes;
  }

  getBech32(): string {
    return this.addressBech32;
  }

  getNetworkId(): NetworkId {
    return this.networkId;
  }
}

export default RewardAddress;
