/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";

import { getRouter } from "./router";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("static frontend entrypoint", () => {
  it("keeps the new interview form interactive inside the static root", async () => {
    window.history.replaceState({}, "", "/new");

    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    render(<RouterProvider router={getRouter()} />, { container: root });

    const title = await screen.findByPlaceholderText("Design a news feed");
    fireEvent.change(title, { target: { value: "Design a feed" } });

    expect((title as HTMLInputElement).value).toBe("Design a feed");
    expect(root.querySelector("html")).toBeNull();
  });
});
