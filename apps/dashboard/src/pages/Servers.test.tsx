import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
});

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

describe("Server Toggle Operations and UI State Synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully enables a disabled server and updates UI to Connected status", async () => {
    const disabledServer = {
      id: 10,
      name: "postgres-mcp",
      url: "http://postgres-mcp:3005/mcp",
      enabled: false,
      status: "disconnected",
      status_message: "Disabled by user",
      last_health_check: new Date().toISOString(),
      tools: []
    };

    const connectedServer = {
      ...disabledServer,
      enabled: true,
      status: "connected",
      status_message: "OK"
    };

    (api.getServers as any)
      .mockResolvedValueOnce({ servers: [disabledServer] })
      .mockResolvedValueOnce({ servers: [connectedServer] });
    (api.updateServer as any).mockResolvedValueOnce({ message: "Updated successfully" });

    render(<Servers />);

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeDefined();
    });

    const enableButton = screen.getByTitle("Enable");
    fireEvent.click(enableButton);

    expect(api.updateServer).toHaveBeenCalledWith(10, { enabled: true });

    await waitFor(() => {
      const connectedBadge = screen.getByText("Connected");
      expect(connectedBadge).toBeDefined();
      expect(connectedBadge.className).toContain("badge-success");
      expect(screen.queryByText("Disabled")).toBeNull();
      expect(screen.queryByText("Disconnected")).toBeNull();
    });
  });

  it("handles asynchronous health checks without incorrectly displaying Disconnected, showing transitional state and refreshing to Connected", async () => {
    const disabledServer = {
      id: 11,
      name: "analytics-mcp",
      url: "http://analytics-mcp:3006/mcp",
      enabled: false,
      status: "disconnected",
      status_message: "Disabled by user",
      last_health_check: new Date().toISOString(),
      tools: []
    };

    // First fetch after enable: backend hasn't finished connecting yet (still "disconnected")
    const pendingServer = {
      ...disabledServer,
      enabled: true,
      status: "disconnected",
      status_message: "Disabled by user"
    };

    // Next fetch (poll): backend finished health check and is now connected
    const finishedServer = {
      ...disabledServer,
      enabled: true,
      status: "connected",
      status_message: "OK"
    };

    (api.getServers as any)
      .mockResolvedValueOnce({ servers: [disabledServer] })
      .mockResolvedValueOnce({ servers: [pendingServer] })
      .mockResolvedValueOnce({ servers: [finishedServer] });
    (api.updateServer as any).mockResolvedValueOnce({ message: "Updated successfully" });

    render(<Servers />);

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeDefined();
    });

    const enableButton = screen.getByTitle("Enable");
    fireEvent.click(enableButton);

    // Immediately/during transitional state: must show Connecting... and NEVER Disconnected
    await waitFor(() => {
      const connectingBadge = screen.getByText("Connecting...");
      expect(connectingBadge).toBeDefined();
      expect(connectingBadge.className).toContain("badge-warning");
      expect(screen.queryByText("Disconnected")).toBeNull();
    });

    // When the health check poll completes, status refreshes to Connected
    await waitFor(() => {
      const connectedBadge = screen.getByText("Connected");
      expect(connectedBadge).toBeDefined();
      expect(connectedBadge.className).toContain("badge-success");
      expect(screen.queryByText("Connecting...")).toBeNull();
      expect(screen.queryByText("Disconnected")).toBeNull();
    });
  });

  it("successfully disables an enabled server and updates UI to Disabled status", async () => {
    const connectedServer = {
      id: 12,
      name: "weather-mcp",
      url: "http://weather-mcp:3003/mcp",
      enabled: true,
      status: "connected",
      status_message: "OK",
      last_health_check: new Date().toISOString(),
      tools: []
    };

    const disabledServer = {
      ...connectedServer,
      enabled: false,
      status: "disconnected",
      status_message: "Disabled by user"
    };

    (api.getServers as any)
      .mockResolvedValueOnce({ servers: [connectedServer] })
      .mockResolvedValueOnce({ servers: [disabledServer] });
    (api.updateServer as any).mockResolvedValueOnce({ message: "Updated successfully" });

    render(<Servers />);

    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeDefined();
    });

    const disableButton = screen.getByTitle("Disable");
    fireEvent.click(disableButton);

    expect(api.updateServer).toHaveBeenCalledWith(12, { enabled: false });

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeDefined();
      expect(screen.queryByText("Connected")).toBeNull();
    });
  });

  it("shows actual failure state and does not falsely display Connected when enable request fails", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    const disabledServer = {
      id: 13,
      name: "faulty-mcp",
      url: "http://faulty-mcp:3007/mcp",
      enabled: false,
      status: "disconnected",
      status_message: "Disabled by user",
      last_health_check: new Date().toISOString(),
      tools: []
    };

    (api.getServers as any)
      .mockResolvedValueOnce({ servers: [disabledServer] })
      .mockResolvedValueOnce({ servers: [disabledServer] });
    (api.updateServer as any).mockRejectedValueOnce(new Error("Failed to connect to gateway"));

    render(<Servers />);

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeDefined();
    });

    const enableButton = screen.getByTitle("Enable");
    fireEvent.click(enableButton);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Failed to connect to gateway");
      expect(screen.getByText("Disabled")).toBeDefined();
      expect(screen.queryByText("Connected")).toBeNull();
    });

    alertSpy.mockRestore();
  });

  it("updates server status directly from authoritative API response if server object is returned", async () => {
    const disabledServer = {
      id: 14,
      name: "auth-mcp",
      url: "http://auth-mcp:3008/mcp",
      enabled: false,
      status: "disconnected",
      status_message: "Disabled by user",
      last_health_check: new Date().toISOString(),
      tools: []
    };

    (api.getServers as any).mockResolvedValueOnce({ servers: [disabledServer] });
    (api.updateServer as any).mockResolvedValueOnce({
      message: "Updated successfully",
      server: {
        ...disabledServer,
        enabled: true,
        status: "connected",
        status_message: "OK"
      }
    });

    render(<Servers />);

    await waitFor(() => {
      expect(screen.getByText("Disabled")).toBeDefined();
    });

    const enableButton = screen.getByTitle("Enable");
    fireEvent.click(enableButton);

    await waitFor(() => {
      const connectedBadge = screen.getByText("Connected");
      expect(connectedBadge).toBeDefined();
      expect(connectedBadge.className).toContain("badge-success");
    });
  });
});
