import React, { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from "lucide-react";

export function ToolRenderer({ toolCall }: { toolCall: any }) {
  const [showRaw, setShowRaw] = useState(false);

  const { tool, status, durationMs, args, result } = toolCall;
  const isSuccess = status === "success";

  const hasCustomRenderer = isSuccess && result && (
    tool === "woocommerce__list_orders" ||
    tool === "woocommerce__list_products" ||
    tool === "github__list_issues" ||
    tool === "github__search_repositories" ||
    tool === "weather__get_weather"
  );

  const parts = tool.split("__");
  const displayName = parts.length === 2 
    ? `${parts[0].charAt(0).toUpperCase() + parts[0].slice(1)} · ${parts[1]}` 
    : tool;

  return (
    <div className="tool-execution-panel" style={{ marginBottom: "1.5rem", borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--bg-panel)", overflow: "hidden" }}>
      <div style={{ padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: hasCustomRenderer || showRaw ? "1px solid var(--border)" : "none", backgroundColor: "var(--bg-elevated)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isSuccess ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--error)" />}
          <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.875rem" }}>{displayName}</span>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{durationMs}ms</div>
      </div>
      
      {hasCustomRenderer && (
        <div style={{ padding: "1rem" }}>
          <CustomRenderer tool={tool} result={result} args={args} />
        </div>
      )}

      <div style={{ padding: hasCustomRenderer ? "0 1rem 1rem 1rem" : "1rem", borderTop: hasCustomRenderer ? "none" : "none" }}>
        <button 
          onClick={() => setShowRaw(!showRaw)}
          style={{ display: "flex", alignItems: "center", gap: "0.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.75rem", cursor: "pointer", padding: 0 }}
        >
          {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          View raw response
        </button>
        
        {showRaw && (
          <div style={{ marginTop: "1rem" }}>
            <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.75rem" }}>Arguments:</div>
            <pre style={{ background: "var(--bg-elevated)", padding: "0.75rem", borderRadius: "4px", overflowX: "auto", fontSize: "0.75rem", marginBottom: "1rem" }}>
              {JSON.stringify(args, null, 2)}
            </pre>
            <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem", fontWeight: 500, fontSize: "0.75rem" }}>Raw Result:</div>
            <pre style={{ background: "var(--bg-elevated)", padding: "0.75rem", borderRadius: "4px", overflowX: "auto", maxHeight: "300px", fontSize: "0.75rem" }}>
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function extractResultData(result: any) {
  if (!result) return null;
  
  if (Array.isArray(result) && result.length > 0 && result[0].type === "text" && result[0].text) {
    try { return JSON.parse(result[0].text); } catch { return result[0].text; }
  }
  
  if (result.content && Array.isArray(result.content) && result.content.length > 0) {
     if (result.content[0].type === "text") {
       try { return JSON.parse(result.content[0].text); } catch { return result.content[0].text; }
     }
  }

  if (typeof result === "string") {
    try { return JSON.parse(result); } catch { return result; }
  }

  return result;
}

const formatDate = (dateString: string) => {
  if (!dateString) return "-";
  const date = new Date(dateString);
  return isNaN(date.getTime()) ? "-" : date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

function CustomRenderer({ tool, result, args }: { tool: string, result: any, args?: any }) {
  const data = extractResultData(result);

  if (tool === "woocommerce__list_orders") {
    const orders = Array.isArray(data) ? data : (data?.data || data?.orders || []);
    if (!orders || orders.length === 0) {
      return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>No orders found.</div>;
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>ORDER #</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>CUSTOMER</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>DATE</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>STATUS</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o: any) => {
              const customerName = (o.billing?.first_name || o.billing?.last_name) 
                ? `${o.billing.first_name || ""} ${o.billing.last_name || ""}`.trim() 
                : "Guest";
              return (
                <tr key={o.id || o.number || Math.random()} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.75rem" }}>#{o.id || o.number || "-"}</td>
                  <td style={{ padding: "0.75rem" }}>{customerName}</td>
                  <td style={{ padding: "0.75rem" }}>{formatDate(o.date_created)}</td>
                  <td style={{ padding: "0.75rem" }}>
                    <span style={{ 
                      padding: "0.25rem 0.5rem", 
                      borderRadius: "100px", 
                      fontSize: "0.75rem", 
                      fontWeight: 600,
                      backgroundColor: o.status === 'completed' ? 'rgba(34, 197, 94, 0.1)' : o.status === 'processing' ? 'rgba(245, 158, 11, 0.1)' : 'var(--bg-elevated)',
                      color: o.status === 'completed' ? '#4ade80' : o.status === 'processing' ? '#fbbf24' : 'var(--text-muted)',
                      textTransform: "uppercase"
                    }}>
                      {o.status || "unknown"}
                    </span>
                  </td>
                  <td style={{ padding: "0.75rem" }}>{o.currency || "USD"} {o.total || "0.00"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  if (tool === "woocommerce__list_products") {
    const products = Array.isArray(data) ? data : (data?.data || data?.products || []);
    if (!products || products.length === 0) {
      return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>No products found.</div>;
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>PRODUCT</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>PRICE</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>STOCK</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p: any) => (
              <tr key={p.id || Math.random()} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "0.75rem", fontWeight: 500 }}>{p.name || "-"}</td>
                <td style={{ padding: "0.75rem" }}>{p.price ? `${p.currency_symbol || "$"}${p.price}` : '-'}</td>
                <td style={{ padding: "0.75rem" }}>{p.stock_quantity ?? "Not tracked"}</td>
                <td style={{ padding: "0.75rem" }}>
                  <span style={{ 
                    padding: "0.25rem 0.5rem", 
                    borderRadius: "100px", 
                    fontSize: "0.75rem", 
                    fontWeight: 600,
                    backgroundColor: p.stock_status === 'instock' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: p.stock_status === 'instock' ? '#4ade80' : '#f87171'
                  }}>
                    {p.stock_status === 'instock' ? 'In Stock' : 'Out of Stock'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tool === "github__list_issues") {
    const issues = Array.isArray(data) ? data : (data?.data || data?.items || []);
    if (!issues || issues.length === 0) {
      return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>No issues found.</div>;
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.875rem" }}>
        {issues.map((i: any) => (
          <div key={i.number || Math.random()} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "6px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 500, color: "var(--text-main)", marginBottom: "0.25rem" }}>{i.title || "-"}</div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>#{i.number} opened by {i.user?.login || "unknown"} on {formatDate(i.created_at || i.updated_at)}</div>
            </div>
            <span style={{ 
              padding: "0.125rem 0.5rem", 
              borderRadius: "100px", 
              fontSize: "0.7rem", 
              fontWeight: 600,
              backgroundColor: i.state === 'open' ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-elevated)',
              color: i.state === 'open' ? '#4ade80' : 'var(--text-muted)',
              textTransform: "uppercase"
            }}>
              {i.state || "unknown"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (tool === "github__search_repositories") {
    const repos = data?.items || data?.data || data || [];
    const reposList = Array.isArray(repos) ? repos : [];
    if (reposList.length === 0) {
      return <div style={{ padding: "1rem", color: "var(--text-muted)", fontSize: "0.875rem" }}>No repositories found.</div>;
    }
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>REPOSITORY</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>STARS</th>
              <th style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600 }}>LANGUAGE</th>
            </tr>
          </thead>
          <tbody>
            {reposList.map((r: any) => (
              <tr key={r.id || Math.random()} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "0.75rem", fontWeight: 500 }}>
                  <a href={r.html_url || "#"} target="_blank" rel="noreferrer" style={{ color: "var(--primary)", textDecoration: "none" }}>
                    {r.full_name || r.name || "-"}
                  </a>
                </td>
                <td style={{ padding: "0.75rem" }}>⭐ {r.stargazers_count || 0}</td>
                <td style={{ padding: "0.75rem" }}>{r.language || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (tool === "weather__get_weather") {
    const w = data || {};
    
    let conditions = w.conditions || w.condition || "Conditions not available";
    if (w.weathercode !== undefined) {
      const codes: Record<number, string> = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
        95: "Thunderstorm"
      };
      conditions = codes[w.weathercode] || `Code ${w.weathercode}`;
    }
    
    const windStr = w.wind_speed || w.wind || w.windspeed !== undefined ? `${w.wind_speed || w.wind || w.windspeed} km/h` : "Not available";
    const locationStr = w.location || (args?.latitude && args?.longitude ? `Lat: ${args.latitude}, Lon: ${args.longitude}` : "Location not available");

    return (
      <div style={{ padding: "1rem", border: "1px solid var(--border)", borderRadius: "8px", background: "var(--bg-elevated)", display: "inline-block", minWidth: "250px" }}>
        <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem", fontWeight: 600 }}>{locationStr}</h3>
        <div style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginBottom: "1rem" }}>Current Weather</div>
        <div style={{ fontSize: "2.5rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.5rem", display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
          {w.temperature !== undefined || w.temp !== undefined ? `${w.temperature ?? w.temp}°C` : "N/A"}
          <span style={{ fontSize: "0.875rem", color: "var(--text-muted)", fontWeight: 400 }}>
            {w.feels_like ? `Feels like ${w.feels_like}°C` : ""}
          </span>
        </div>
        <div style={{ color: "var(--text-main)", fontWeight: 500, marginBottom: "1rem" }}>
          {conditions}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", fontSize: "0.875rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
          <div>
            <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem" }}>Humidity</div>
            <div style={{ fontWeight: 500 }}>{w.humidity !== undefined ? `${w.humidity}%` : "Not available"}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-muted)", marginBottom: "0.25rem" }}>Wind</div>
            <div style={{ fontWeight: 500 }}>{windStr}</div>
          </div>
        </div>
      </div>
    );
  }

  // Generic fallback for any tool without a specific renderer
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
    const keys = Object.keys(data[0]).slice(0, 5); // take max 5 columns
    return (
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
              {keys.map(k => (
                <th key={k} style={{ padding: "0.75rem", color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row: any, i: number) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                {keys.map(k => (
                  <td key={k} style={{ padding: "0.75rem" }}>
                    {typeof row[k] === 'object' ? JSON.stringify(row[k]).substring(0, 30) + (JSON.stringify(row[k]).length > 30 ? "..." : "") : String(row[k] || "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  } else if (data && typeof data === 'object' && !Array.isArray(data)) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "0.5rem 1rem", fontSize: "0.875rem" }}>
        {Object.entries(data).slice(0, 10).map(([k, v]) => (
          <React.Fragment key={k}>
            <div style={{ color: "var(--text-muted)", fontWeight: 500, padding: "0.25rem 0" }}>{k}</div>
            <div style={{ padding: "0.25rem 0" }}>
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          </React.Fragment>
        ))}
      </div>
    );
  }

  // Primitive text fallback
  return <div style={{ fontSize: "0.875rem", whiteSpace: "pre-wrap" }}>{String(data)}</div>;
}
