import bs58 from "bs58";
import { toHex } from "../utils/bytes";

/**
 * this class does not allow generating a Byron address
 * but is provided as a helper class to work with Byron Addresses
 *  */

export class ByronAddress {
  protected addressHex;
  protected addressBytes;
  protected addressBech32;

  constructor(address: Uint8Array) {
    this.addressBech32 = bs58.encode(address);
    this.addressBytes = address;
    this.addressHex = toHex(address);
  }

  getHex(): string {
    return this.addressHex;
  }

  getBytes(): Uint8Array {
    return this.addressBytes;
  }

  // bech32 naming to make it compatible with shelley type address classes, this is bs58 encoded address
  getBech32(): string {
    return this.addressBech32;
  }
}

export default ByronAddress;
