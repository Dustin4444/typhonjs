import { HashType } from "../types";
import type { Credential, NetworkId } from "../types";
import ShelleyTypeAddress from "./ShelleyTypeAddress";

export class BaseAddress extends ShelleyTypeAddress {
  stakeCredential: Credential;

  constructor(networkId: NetworkId, paymentCredential: Credential, stakeCredential: Credential) {
    super(networkId, paymentCredential);
    this.stakeCredential = stakeCredential;
    this.computeHex();
  }

  protected computeHex(): void {
    // bit 5 is set for a script stake credential
    const header = this.stakeCredential.type === HashType.SCRIPT ? 0b0010_0000 : 0b0000_0000;
    this.setAddress(header, this._paymentCredential.hash, this.stakeCredential.hash);
  }
}

export default BaseAddress;
