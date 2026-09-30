import { bech32 } from "bech32";
import { HashType, NetworkId } from "../types";
import type { Credential } from "../types";
import { concatBytes, toHex } from "../utils/bytes";

export abstract class ShelleyTypeAddress {
  protected _paymentCredential: Credential;
  protected networkId: NetworkId;
  protected addressHex = "";
  protected addressBytes: Uint8Array = new Uint8Array(0);
  protected addressBech32 = "";

  constructor(networkId: NetworkId, paymentCredential: Credential) {
    this.networkId = networkId;
    this._paymentCredential = paymentCredential;
  }

  protected abstract computeHex(): void;

  /**
   * Sets the address from its header byte and payload: the header's type nibble,
   * with bit 4 set for a script payment credential, and the network id.
   */
  protected setAddress(header: number, ...payload: Array<Uint8Array>): void {
    let byte = header | this.networkId;
    if (this._paymentCredential.type === HashType.SCRIPT) {
      byte |= 1 << 4;
    }
    this.addressBytes = concatBytes(Uint8Array.of(byte), ...payload);
    this.addressHex = toHex(this.addressBytes);
    this.addressBech32 = this.computeBech32(this.addressBytes);
  }

  protected computeBech32(address: Uint8Array): string {
    const data = this.networkId === NetworkId.MAINNET ? "addr" : "addr_test";
    const words = bech32.toWords(address);
    const encoded = bech32.encode(data, words, 1000);
    return encoded;
  }

  get paymentCredential() {
    return this._paymentCredential;
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

export default ShelleyTypeAddress;
