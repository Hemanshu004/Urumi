import { useState } from "react";
import { api } from "../services/api";
import { Send, Bot, User } from "lucide-react";

export default function Chat() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await api.chat({
        message: userMessage.content,
        conversationHistory: messages
      });

      const assistantMessage = {
        role: "assistant",
        content: response.message,
        toolCalls: response.toolCalls || []
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 8rem)" }}>
      <h1 className="page-title" style={{ marginBottom: "1rem" }}>Agent Chat</h1>
      
      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "2rem" }}>
              <Bot size={48} style={{ opacity: 0.5, marginBottom: "1rem" }} />
              <p>Hello! I am the Urumi Gateway Agent.</p>
              <p>Try asking me to list products or manage your store.</p>
            </div>
          )}
          
          {messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontWeight: 600 }}>
                {m.role === "user" ? <><User size={16}/> You</> : <><Bot size={16}/> Agent</>}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
              
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  {m.toolCalls.map((tc: any, j: number) => (
                    <div key={j} className="tool-call">
                      <span style={{ color: "var(--primary)" }}>{tc.tool}</span>
                      <span style={{ margin: "0 0.5rem", color: tc.status === "success" ? "var(--success)" : "var(--danger)" }}>
                        [{tc.status}]
                      </span>
                      <span style={{ color: "var(--text-muted)" }}>{tc.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="chat-message assistant" style={{ opacity: 0.7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                <Bot size={16}/> Agent
              </div>
              <div>Thinking...</div>
            </div>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="chat-input-area">
          <input
            type="text"
            className="input-field chat-input"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
          <button type="submit" className="btn-primary" disabled={loading || !input.trim()} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
