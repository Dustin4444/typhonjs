import { encode } from "@stricahq/cbors";
import type { CLINativeScript, NativeScript } from "../types";
import { encodeNativeScript, getNativeScriptHash } from "../utils/encoder";

export class NativeScriptFactory {
  private nativeScript: NativeScript;
  private _cbor: Uint8Array;
  private _policyId: Uint8Array;

  /**
   *
   * @param nativeScript - the native script json as per the CDDL schema, use fromCliJSON to convert from the CLI format
   */
  constructor(nativeScript: NativeScript) {
    this.nativeScript = nativeScript;
    this._cbor = encode(encodeNativeScript(nativeScript));
    this._policyId = getNativeScriptHash(nativeScript);
  }

  cbor(): Uint8Array {
    return this._cbor;
  }

  policyId(): Uint8Array {
    return this._policyId;
  }

  json(): NativeScript {
    return this.nativeScript;
  }

  static fromCliJSON(cliNativeScript: CLINativeScript): NativeScriptFactory {
    const convert = (script: CLINativeScript): NativeScript => {
      if ("type" in script) {
        switch (script.type) {
          case "sig":
            return { pubKeyHash: script.keyHash };
          case "all":
            return {
              all: script.scripts.map((s) => convert(s)),
            };
          case "any":
            return {
              any: script.scripts.map((s) => convert(s)),
            };
          case "atLeast":
            return {
              n: script.required,
              k: script.scripts.map((s) => convert(s)),
            };
          case "after":
            return { invalidBefore: script.slot };
          case "before":
            return { invalidAfter: script.slot };
          default:
            throw new Error(`Unknown script type: ${(script as { type: unknown }).type}`);
        }
      }
      throw new Error("Invalid script format");
    };

    const nativeScript = convert(cliNativeScript);
    return new NativeScriptFactory(nativeScript);
  }
}

export default NativeScriptFactory;
