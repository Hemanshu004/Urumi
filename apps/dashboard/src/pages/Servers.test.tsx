import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Servers from "./Servers";
import { api } from "../services/api";

vi.mock("../services/api", () => ({
  api: {
    getServers: vi.fn(),
    updateServer: vi.fn(),
    deleteServer: vi.fn(),
    addServer: vi.fn(),
  }
}));

describe("Servers Page Status Labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays correct status labels for connected, error, disabled, and unknown states", async () => {
    (api.getServers as any).mockResolvedValueOnce({
      servers: [
        {
          id: 1,
          name: "weather-mcp",
          url: "http://weather-mcp:3003/mcp",
          enabled: true,
          status: "connected",
          status_message: "OK",
          last_health_check: new Date().toISOString(),
          tools: []
        },
        {
          id: 2,
          name: "github-mcp",
          url: "http://github-mcp:3002/mcp",
          enabled: true,
          status: "error",
          status_message: "Connection timeout",
          last_health_check: new Date().toISOString(),
          tools: []
        },
        {
          id: 3,
          name: "woo-mcp",
          url: "http://woo-mcp:3001/mcp",
          enabled: false,
          status: "connected", // administratively disabled
          status_message: "Disabled by user",
          last_health_check: new Date().toISOString(),
          tools: []
        },
        {
          id: 4,
          name: "custom-mcp",
          url: "http://custom-mcp:3004/mcp",
          enabled: true,
          status: "unknown",
          status_message: "Pending first check",
          last_health_check: new Date().toISOString(),
          tools: []
        }
      ]
    });

    render(<Servers />);

    await waitFor(() => {
      // 1. 'connected' displays as 'Connected'
      const connectedBadge = screen.getByText("Connected");
      expect(connectedBadge).toBeDefined();
      expect(connectedBadge.className).toContain("badge-success");

      // 2. 'error' displays as 'Unreachable'
      const unreachableBadge = screen.getByText("Unreachable");
      expect(unreachableBadge).toBeDefined();
      expect(unreachableBadge.className).toContain("badge-error");

      // 3. Administratively disabled displays as 'Disabled'
      const disabledLabel = screen.getByText("Disabled");
      expect(disabledLabel).toBeDefined();

      // 4. Unknown state displays as 'Unknown' with badge-error (not silently healthy)
      const unknownBadge = screen.getByText("Unknown");
      expect(unknownBadge).toBeDefined();
      expect(unknownBadge.className).toContain("badge-error");
    });
  });
});
