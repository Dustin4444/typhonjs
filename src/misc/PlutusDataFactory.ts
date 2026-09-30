import { encode } from "@stricahq/cbors";
import type { PlutusData } from "../types";
import { hash32 } from "../utils/crypto";
import { encodePlutusData } from "../utils/encoder";

export class PlutusDataFactory {
  private plutusData: PlutusData;
  private _cbor: Uint8Array;
  private _plutusDataHash: Uint8Array;

  constructor(plutusData: PlutusData) {
    this.plutusData = plutusData;
    const encodedPlutusData = encodePlutusData(plutusData);
    this._cbor = encode(encodedPlutusData);
    this._plutusDataHash = hash32(this._cbor);
  }

  cbor(): Uint8Array {
    return this._cbor;
  }

  plutusDataHash(): Uint8Array {
    return this._plutusDataHash;
  }

  json(): PlutusData {
    return this.plutusData;
  }
}

export default PlutusDataFactory;
