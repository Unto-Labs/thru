// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Frame } from "./Frame";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const bar = () => container.querySelector(".tds-frame__bar");
const backButton = () => container.querySelector('button[aria-label="Back"]');

it("keeps the back button's place, with no back button, while holdBack is set", () => {
  act(() => root.render(<Frame onBack={() => {}}>page</Frame>));
  expect(backButton()).not.toBeNull();
  expect(bar()?.classList.contains("tds-frame__bar--float")).toBe(false);

  act(() => root.render(<Frame holdBack>page</Frame>));
  expect(backButton()).toBeNull();
  expect(bar()?.classList.contains("tds-frame__bar--float")).toBe(false);
  const placeholder = container.querySelector<HTMLButtonElement>(".tds-frame__back");
  expect(placeholder?.disabled).toBe(true);
  expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
  expect(placeholder?.style.visibility).toBe("hidden");

  act(() => root.render(<Frame>page</Frame>));
  expect(container.querySelector(".tds-frame__back")).toBeNull();
  expect(bar()?.classList.contains("tds-frame__bar--float")).toBe(true);
});

it("eases on when the content grew during a resize, and only then lets go of the height", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  let natural = 200;
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pinned = parseFloat(this.style.height);
    return { height: Number.isNaN(pinned) ? natural : pinned } as DOMRect;
  });
  act(() =>
    root.render(
      <Frame animateResize>
        <p>page</p>
      </Frame>,
    ),
  );
  const frame = container.querySelector<HTMLElement>(".tds-frame");
  if (!frame) throw new Error("Missing frame");
  const endOfTransition = () =>
    frame.dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "height" }));

  natural = 300;
  await act(async () => {
    container.querySelector("p")?.append("more");
  });
  expect(frame.style.height).toBe("300px");

  /* An image loads, or a panel opens: taller content with no DOM change. */
  natural = 500;
  endOfTransition();
  expect(frame.style.height).toBe("500px");

  endOfTransition();
  expect(frame.style.height).toBe("");
  rect.mockRestore();
});
