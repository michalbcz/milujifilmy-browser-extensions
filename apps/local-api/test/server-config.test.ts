import { describe, expect, it } from "vitest";
import { listenHost } from "../src/server-config.js";

describe("listenHost", () => {
  it("allows the Docker service to bind its container interface", () => {
    expect(listenHost({ MILUJU_FILMY_LISTEN_HOST: "0.0.0.0" })).toBe("0.0.0.0");
  });

  it("keeps direct local starts on loopback by default", () => {
    expect(listenHost({})).toBe("127.0.0.1");
  });
});
