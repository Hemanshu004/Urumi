import { useState, useContext, useEffect, useRef } from "react";
import { api } from "../services/api";
import { Send, Bot, User } from "lucide-react";
import { ToolRenderer } from "../components/ToolRenderer";
import { ChatContext } from "../context/ChatContext";

export default function Chat() {
  const { activeConversation, activeConversationId, addMessage, createConversation } = useContext(ChatContext);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = activeConversation?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    let targetConvId = activeConversationId;
    if (!targetConvId) {
      targetConvId = createConversation();
    }

    const userMessage = { 
      id: Math.random().toString(36).substring(2, 9),
      role: "user" as const, 
      content: input,
      timestamp: new Date().toISOString()
    };
    
    addMessage(targetConvId, userMessage);
    const currentHistory = [...messages, userMessage];
    setInput("");
    setLoading(true);

    try {
      const response = await api.chat({
        message: userMessage.content,
        // Only send role and content to backend for history
        conversationHistory: currentHistory.map(m => ({ role: m.role, content: m.content }))
      });

      let cleanContent = response.message || response.content || "";
      const rawContent = cleanContent;
      const toolCalls = response.toolCalls || response.tools || [];
      
      // Cleanup raw JSON from LLM response if it directly outputs the tool result
      if (toolCalls.length > 0) {
        try {
          const parsed = JSON.parse(cleanContent.trim());
          if (typeof parsed === 'object' && parsed !== null) {
            cleanContent = "";
          }
        } catch (e) {}
        
        // Remove markdown JSON blocks if the LLM wrapped it
        cleanContent = cleanContent.replace(/```json\n[\s\S]*?\n```/g, '').trim();
        
        if ((cleanContent.startsWith('[') || cleanContent.startsWith('{')) && cleanContent.length > 15) {
          cleanContent = "";
        }

        if (!cleanContent) cleanContent = "Here is the result:";
      }

      const assistantMessage = {
        id: Math.random().toString(36).substring(2, 9),
        role: "assistant" as const,
        content: cleanContent,
        rawContent: rawContent !== cleanContent ? rawContent : undefined,
        timestamp: new Date().toISOString(),
        toolCalls: toolCalls,
        toolResults: response.toolResults || []
      };

      addMessage(targetConvId, assistantMessage);
    } catch (err: any) {
      addMessage(targetConvId, { 
        id: Math.random().toString(36).substring(2, 9),
        role: "assistant", 
        content: `Error: ${err.message}`,
        timestamp: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="agent-panel" style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
      <div className="agent-header" style={{ padding: "1rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-panel)", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 600 }}>Urumi Agent</h1>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.125rem" }}>AI-powered MCP assistant</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "var(--success)" }}></span>
          Connected
        </div>
      </div>
      
      <div className="chat-container" style={{ flex: 1, padding: 0, display: "flex", flexDirection: "column", borderRadius: 0, border: "none", overflow: "hidden", minHeight: 0 }}>
        <div className="chat-messages" style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "2rem 1.5rem", minHeight: 0 }}>
          <div style={{ maxWidth: "56rem", margin: "0 auto", display: "flex", flexDirection: "column", width: "100%" }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "4rem" }}>
                <Bot size={48} style={{ opacity: 0.5, marginBottom: "1.5rem", margin: "0 auto" }} />
                <h2 style={{ fontSize: "1.25rem", color: "var(--text-main)", marginBottom: "0.5rem", fontWeight: 600 }}>Urumi Agent</h2>
                <p style={{ marginBottom: "1.5rem" }}>Ask Urumi to interact with your connected MCP servers.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", maxWidth: "600px", margin: "0 auto" }}>
                  <button onClick={() => setInput("Show me my previous orders")} className="btn-secondary" style={{ fontSize: "0.875rem", padding: "0.5rem 1rem", borderRadius: "100px" }}>Show me my previous orders</button>
                  <button onClick={() => setInput("List my WooCommerce products")} className="btn-secondary" style={{ fontSize: "0.875rem", padding: "0.5rem 1rem", borderRadius: "100px" }}>List my WooCommerce products</button>
                  <button onClick={() => setInput("What's the weather in Ahmedabad?")} className="btn-secondary" style={{ fontSize: "0.875rem", padding: "0.5rem 1rem", borderRadius: "100px" }}>What's the weather in Ahmedabad?</button>
                  <button onClick={() => setInput("Show open GitHub issues")} className="btn-secondary" style={{ fontSize: "0.875rem", padding: "0.5rem 1rem", borderRadius: "100px" }}>Show open GitHub issues</button>
                </div>
              </div>
            )}
            
            {messages.map((m, index) => {
              const isUser = m.role === 'user';
              return (
                <div key={m.id} className="message-row" style={{ 
                  display: "flex", 
                  width: "100%", 
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  marginBottom: index === messages.length - 1 ? "0" : (isUser ? "1.5rem" : "2rem")
                }}>
                  <div className={`chat-message ${m.role}`} style={{ width: isUser ? "auto" : "100%", maxWidth: isUser ? "70%" : "85%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", fontWeight: 600, color: isUser ? "var(--primary)" : "var(--text-main)" }}>
                      {isUser ? <><User size={16}/> You</> : <><Bot size={16}/> Urumi Agent</>}
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontWeight: 400, marginLeft: "auto" }}>
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, paddingLeft: !isUser ? "1.75rem" : "0" }}>
                      {m.content}
                      {!isUser && m.rawContent && (
                        <details style={{ marginTop: "1rem" }}>
                          <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "0.875rem", userSelect: "none", display: "inline-block" }}>
                            View raw response
                          </summary>
                          <pre style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-dark)", borderRadius: "6px", fontSize: "0.75rem", overflowX: "auto", whiteSpace: "pre-wrap" }}>
                            {m.rawContent}
                          </pre>
                        </details>
                      )}
                    </div>
                    
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div style={{ marginTop: "1rem", paddingLeft: !isUser ? "1.75rem" : "0" }}>
                        {m.toolCalls.map((tc: any, j: number) => (
                          <ToolRenderer key={j} toolCall={tc} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            
            {loading && (
              <div className="message-row" style={{ display: "flex", width: "100%", justifyContent: "flex-start", marginBottom: "0", marginTop: "2rem" }}>
                <div className="chat-message assistant" style={{ width: "100%", maxWidth: "85%", opacity: 0.7 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: 600 }}>
                    <Bot size={16}/> Urumi Agent
                  </div>
                  <div style={{ paddingLeft: "1.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    Processing
                    <div style={{ display: "flex", gap: "2px" }}>
                      <span style={{ animation: "pulse 1s infinite", animationDelay: "0s" }}>.</span>
                      <span style={{ animation: "pulse 1s infinite", animationDelay: "0.2s" }}>.</span>
                      <span style={{ animation: "pulse 1s infinite", animationDelay: "0.4s" }}>.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        <div className="composer" style={{ padding: "1.5rem", background: "var(--bg-panel)", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <form onSubmit={handleSubmit} style={{ maxWidth: "56rem", margin: "0 auto" }}>
            <div className="input-wrapper" style={{ display: "flex", alignItems: "center", background: "var(--bg-dark)", border: "1px solid var(--border)", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", padding: "0.5rem 0.5rem 0.5rem 1.5rem", width: "100%" }}>
              <textarea
                placeholder="Ask Urumi Agent anything..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={loading}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as any);
                  }
                }}
                style={{ 
                  flex: 1, 
                  background: "transparent", 
                  border: "none", 
                  resize: "none", 
                  outline: "none", 
                  color: "var(--text-main)", 
                  fontSize: "1rem", 
                  minHeight: "40px",
                  maxHeight: "200px", 
                  fontFamily: "inherit",
                  padding: "0.5rem 0",
                  margin: 0
                }}
                rows={1}
              />
              <button 
                type="submit" 
                className="btn-primary" 
                disabled={loading || !input.trim()} 
                style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "0", borderRadius: "8px", height: "40px", width: "40px", flexShrink: 0, marginLeft: "0.5rem" }}
              >
                <Send size={18} />
              </button>
            </div>
          </form>
          <div style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.75rem" }}>
            Urumi Agent can make mistakes. Verify important information.
          </div>
        </div>
      </div>
    </div>
  );
}
