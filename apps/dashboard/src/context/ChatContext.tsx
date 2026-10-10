import React, { createContext, useContext, useState, useEffect } from "react";
import { AuthContext } from "../App";

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  rawContent?: string;
  timestamp: string;
  toolCalls?: any[];
  toolResults?: any[];
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
};

type ChatContextType = {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  setActiveConversationId: (id: string | null) => void;
  createConversation: () => string;
  addMessage: (conversationId: string, message: Message) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
};

export const ChatContext = createContext<ChatContextType>({
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  setActiveConversationId: () => {},
  createConversation: () => "",
  addMessage: () => {},
  renameConversation: () => {},
  deleteConversation: () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useContext(AuthContext);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setActiveConversationId(null);
      return;
    }

    const key = `urumi:conversations:${user.id || user.email}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setConversations(parsed);
          if (parsed.length > 0) {
            setActiveConversationId(parsed[0].id);
          }
        }
      } else {
        setConversations([]);
        setActiveConversationId(null);
      }
    } catch (e) {
      console.error("Failed to parse conversations from local storage", e);
      setConversations([]);
      setActiveConversationId(null);
    }
  }, [user]);

  // Persist to local storage whenever conversations change
  useEffect(() => {
    if (user) {
      const key = `urumi:conversations:${user.id || user.email}`;
      localStorage.setItem(key, JSON.stringify(conversations));
    }
  }, [conversations, user]);

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;

  const createConversation = () => {
    const newConv: Conversation = {
      id: Math.random().toString(36).substring(2, 9),
      title: "New Chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    setConversations(prev => [newConv, ...prev]);
    setActiveConversationId(newConv.id);
    return newConv.id;
  };

  const generateTitle = (text: string) => {
    let title = text.trim().split('\n')[0];
    if (title.length > 30) {
      title = title.substring(0, 30) + "...";
    }
    return title || "New Chat";
  };

  const addMessage = (conversationId: string, message: Message) => {
    setConversations(prev => {
      let convs = [...prev];
      let targetConv = convs.find(c => c.id === conversationId);
      
      if (!targetConv) {
        targetConv = {
          id: conversationId,
          title: message.role === "user" ? generateTitle(message.content) : "New Chat",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: []
        };
        convs = [targetConv, ...convs];
      }

      return convs.map(c => {
        if (c.id === conversationId) {
          const updatedMessages = [...c.messages, message];
          const isFirstUserMessage = message.role === "user" && c.messages.filter(m => m.role === "user").length === 0;
          return {
            ...c,
            title: isFirstUserMessage ? generateTitle(message.content) : (c.title === "New Chat" && message.role === "user" ? generateTitle(message.content) : c.title),
            updatedAt: new Date().toISOString(),
            messages: updatedMessages
          };
        }
        return c;
      }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    });
  };

  const renameConversation = (id: string, title: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title, updatedAt: new Date().toISOString() } : c));
  };

  const deleteConversation = (id: string) => {
    if (confirm("Are you sure you want to delete this conversation?")) {
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
    }
  };

  return (
    <ChatContext.Provider value={{
      conversations,
      activeConversationId,
      activeConversation,
      setActiveConversationId,
      createConversation,
      addMessage,
      renameConversation,
      deleteConversation
    }}>
      {children}
    </ChatContext.Provider>
  );
}
