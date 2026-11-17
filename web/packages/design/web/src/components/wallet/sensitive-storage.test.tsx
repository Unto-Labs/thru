import * as React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { IdentityNumberInput } from "./IdentityNumberInput/IdentityNumberInput";
import { IDENTITY_FORMATS } from "./IdentityNumberInput/identity";
import { DobInput } from "./DobInput/DobInput";
import { dobToIso, formatDob, parseDob, validateDob } from "./DobInput/dob";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("does not persist, navigate, or log sensitive values while rendering and formatting", () => {
  const write = vi.fn();
  const storage = { getItem: vi.fn(), setItem: write, removeItem: write, clear: write };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.stubGlobal("indexedDB", { open: write });
  const document = {};
  Object.defineProperty(document, "cookie", { set: write });
  vi.stubGlobal("document", document);
  vi.stubGlobal("history", { pushState: write, replaceState: write });
  const consoleSpies = Object.getOwnPropertyNames(console)
    .filter((key) => typeof Reflect.get(console, key) === "function")
    .map((key) => [key, vi.fn()] as const);
  vi.stubGlobal("console", Object.fromEntries(consoleSpies));

  renderToStaticMarkup(<IdentityNumberInput kind="ssn" value="987654321" label="SSN" onValueChange={() => {}} />);
  renderToStaticMarkup(<DobInput value="01/02/1990" label="Date of birth" onValueChange={() => {}} />);
  for (const fmt of Object.values(IDENTITY_FORMATS)) {
    fmt.normalize("987654321");
    fmt.format("987654321");
    fmt.validate("987654321");
  }
  formatDob("01/02/1990");
  parseDob("01/02/1990");
  dobToIso("01/02/1990");
  validateDob("01/02/1990", new Date(2024, 6, 4));

  expect(write).not.toHaveBeenCalled();
  expect(storage.getItem).not.toHaveBeenCalled();
  for (const [, spy] of consoleSpies) expect(spy).not.toHaveBeenCalled();
});

it("keeps persistence and logging APIs out of sensitive input source", () => {
  const forbidden = /localStorage|sessionStorage|indexedDB|document\.cookie|console\.|history\.|location\.|searchParams/;
  for (const file of ["DepositKyc.tsx", "DepositBank.tsx"]) {
    expect(readFileSync(new URL(`./WalletSheet/${file}`, import.meta.url), "utf8")).not.toMatch(forbidden);
  }
  for (const directory of ["IdentityNumberInput", "DobInput"]) {
    const url = new URL(`./${directory}/`, import.meta.url);
    const files = readdirSync(url).filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(new URL(file, url), "utf8")).not.toMatch(forbidden);
    }
  }
  expect(readFileSync(new URL("./masked-edit.ts", import.meta.url), "utf8")).not.toMatch(forbidden);
});
