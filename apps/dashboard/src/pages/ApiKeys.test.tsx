import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup, act } from "@testing-library/react";
import ApiKeys, { copyToClipboard } from "./ApiKeys";
import { api } from "../services/api";
import { AuthContext } from "../App";

vi.mock("../services/api", () => ({
  api: {
    getApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn()
  }
}));

const mockAuthValue = {
  user: { id: 1, email: "admin@urumi.local", role: "admin" },
  loading: false,
  login: vi.fn(),
  logout: vi.fn()
};

function renderApiKeys() {
  return render(
    <AuthContext.Provider value={mockAuthValue}>
      <ApiKeys />
    </AuthContext.Provider>
  );
}

describe("API Keys Page - Copy Button Functionality", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getApiKeys as any).mockResolvedValue({
      keys: [
        {
          id: 1,
          label: "Existing Key",
          key_prefix: "urumi_a1b2c3d4",
          user_email: "admin@urumi.local",
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null
        }
      ]
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    // Restore clipboard and execCommand
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true
    });
    document.execCommand = originalExecCommand;
  });

  it("copies the complete generated key including urumi_ prefix via navigator.clipboard", async () => {
    const fullKey = "urumi_8f14b6c3d9e2a105f78234bc65e90d123456789abcdef1234567890abcdef1234";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    // Generate a new key
    const input = screen.getByPlaceholderText(/Key Label/i);
    fireEvent.change(input, { target: { value: "Test Client Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    // Check display shows full key
    const keyDisplay = screen.getByTestId("generated-key-display");
    expect(keyDisplay.textContent).toBe(fullKey);

    // Click Copy button
    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock).toHaveBeenCalledWith(fullKey);
    expect(screen.getByText(/Copied!/i)).toBeDefined();
  });

  it("reverts Copied! status back to Copy after timeout", async () => {
    const fullKey = "urumi_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "My Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    vi.useFakeTimers();

    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(screen.getByText(/Copied!/i)).toBeDefined();

    // Fast-forward 2000ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText(/Copied!/i)).toBeNull();
    const revertedButton = screen.getByRole("button", { name: /Copy API key/i });
    expect(revertedButton.textContent).toContain("Copy");

    vi.useRealTimers();
  });

  it("falls back to document.execCommand when navigator.clipboard is undefined (HTTP origin)", async () => {
    const fullKey = "urumi_http_origin_fallback_key_1234567890abcdef1234567890abcdef12";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    // Simulate insecure context where navigator.clipboard is undefined
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true
    });

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "HTTP Insecure Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(screen.getByText(/Copied!/i)).toBeDefined();
  });

  it("falls back to document.execCommand when navigator.clipboard.writeText rejects", async () => {
    const fullKey = "urumi_rejected_promise_key_1234567890abcdef1234567890abcdef123456";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    const writeTextMock = vi.fn().mockRejectedValue(new Error("NotAllowedError: Permission denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "Rejected Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(writeTextMock).toHaveBeenCalled();
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(screen.getByText(/Copied!/i)).toBeDefined();
  });

  it("displays a clear error message when both Clipboard API and fallback fail", async () => {
    const fullKey = "urumi_both_failed_key_1234567890abcdef1234567890abcdef1234567890";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    const writeTextMock = vi.fn().mockRejectedValue(new Error("Clipboard write failed"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    const execCommandMock = vi.fn().mockReturnValue(false);
    document.execCommand = execCommandMock;

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "Fail Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    // Should NOT say Copied!
    expect(screen.queryByText(/Copied!/i)).toBeNull();

    // Should show error alert
    const errorAlert = screen.getByRole("alert");
    expect(errorAlert.textContent).toContain("Automatic copy failed. Please select and copy the key manually above.");

    // Key display remains available for manual copy
    const keyDisplay = screen.getByTestId("generated-key-display");
    expect(keyDisplay.textContent).toBe(fullKey);
  });

  it("does not accidentally copy a stale key when a second key is generated", async () => {
    const keyOne = "urumi_first_key_1111111111111111111111111111111111111111111111111111";
    const keyTwo = "urumi_second_key_2222222222222222222222222222222222222222222222222222";

    (api.createApiKey as any).mockResolvedValueOnce({ key: keyOne });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    // Generate first key
    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "Key 1" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText(keyOne)).toBeDefined();
    });

    // Generate second key
    (api.createApiKey as any).mockResolvedValueOnce({ key: keyTwo });
    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "Key 2" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText(keyTwo)).toBeDefined();
    });

    // Click copy on the current panel
    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
    });

    // Must be keyTwo, never keyOne
    expect(writeTextMock).toHaveBeenLastCalledWith(keyTwo);
    expect(writeTextMock).not.toHaveBeenCalledWith(keyOne);
  });

  it("handles repeated rapid clicks without breaking state", async () => {
    const fullKey = "urumi_rapid_clicks_key_1234567890abcdef1234567890abcdef123456789";
    (api.createApiKey as any).mockResolvedValue({ key: fullKey });

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      writable: true,
      configurable: true
    });

    renderApiKeys();
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).toBeNull();
    });

    fireEvent.change(screen.getByPlaceholderText(/Key Label/i), { target: { value: "Rapid Click Key" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate Key/i }));

    await waitFor(() => {
      expect(screen.getByText("New API Key Created!")).toBeDefined();
    });

    const copyButton = screen.getByRole("button", { name: /Copy API key/i });
    await act(async () => {
      fireEvent.click(copyButton);
      fireEvent.click(copyButton);
      fireEvent.click(copyButton);
    });

    expect(screen.getByText(/Copied!/i)).toBeDefined();
    expect(writeTextMock).toHaveBeenCalledTimes(3);
  });

  it("copyToClipboard returns false for empty input", async () => {
    const res = await copyToClipboard("");
    expect(res).toBe(false);
  });
});
