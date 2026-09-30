import type { Credential, NetworkId } from "../types";
import { fromHex } from "../utils/bytes";
import ShelleyTypeAddress from "./ShelleyTypeAddress";

export class PointerAddress extends ShelleyTypeAddress {
  protected _vlq;

  /**
   * @param vlq - hex of the variable-length encoded pointer (slot, tx index, cert index)
   */
  constructor(networkId: NetworkId, paymentCredential: Credential, vlq: string) {
    super(networkId, paymentCredential);
    this._vlq = vlq;
    this.computeHex();
  }

  protected computeHex(): void {
    this.setAddress(0b0100_0000, this._paymentCredential.hash, fromHex(this._vlq));
  }
}

export default PointerAddress;
