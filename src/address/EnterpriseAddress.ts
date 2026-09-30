import type { Credential, NetworkId } from "../types";
import ShelleyTypeAddress from "./ShelleyTypeAddress";

export class EnterpriseAddress extends ShelleyTypeAddress {
  constructor(networkId: NetworkId, paymentCredential: Credential) {
    super(networkId, paymentCredential);
    this.computeHex();
  }

  protected computeHex(): void {
    this.setAddress(0b0110_0000, this._paymentCredential.hash);
  }
}

export default EnterpriseAddress;
