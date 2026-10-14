"use client";

import dynamic from "next/dynamic";
import type { models as modelsType } from "powerbi-client";
import React from "react";
import ReactDOM from "react-dom";

// powerbi-client-react references `self` which doesn't exist on the server
const PowerBIEmbed = dynamic(
    () => import("powerbi-client-react").then((mod) => mod.PowerBIEmbed),
    { ssr: false }
);
import { useSession } from "next-auth/react";
import { useState, useRef, useEffect, useCallback } from "react";
import { Layout, theme, Spin } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { FloatButton } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppHeader from "@/components/AppHeader";
import AppSidebar from "@/components/AppSidebar";
import { Sriracha } from "next/font/google";

const { Content } = Layout;

export default function DashboardPage() {
    // Chat box visibility
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isChatMaximized, setIsChatMaximized] = useState(false);

    // Chat state
    const [messages, setMessages] = useState<{ role: string, content: string, images?: string[], isError?: boolean }[]>([]);
    const [input, setInput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [thinkingText, setThinkingText] = useState("...");
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);

    // Dashboard switching
    const [activeReport, setActiveReport] = useState("aqeela");
    const [siderCollapsed, setSiderCollapsed] = useState(false);

    // Image lightbox modal
    const [previewImage, setPreviewImage] = useState<string | null>(null);

    // Close lightbox on Escape key (prioritised over chat close)
    useEffect(() => {
        if (!previewImage) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopImmediatePropagation();
                setPreviewImage(null);
            }
        };
        // Use capture phase so this fires before any other Escape handlers
        document.addEventListener("keydown", handleKeyDown, true);
        return () => document.removeEventListener("keydown", handleKeyDown, true);
    }, [previewImage]);

    // Dashboard configurations
    const dashboards: Record<string, { reportId: string; title: string; background: number }> = {
        aqeela: {
            reportId: process.env.NEXT_PUBLIC_POWERBI_REPORT_ID_AQEELA!,
            title: "National Education Performance Dashboard",
            background: 0,
        },
        ariff: {
            reportId: process.env.NEXT_PUBLIC_POWERBI_REPORT_ID_ARIFF!,
            title: "Schools Performance Analytics Dashboard",
            background: 1,
        },
    };

    const currentDashboard = dashboards[activeReport];

    // Power BI report instance ref for token hot-swap
    const reportRef = useRef<any>(null);
    const prevTokenRef = useRef<string | undefined>(undefined);

    // Detect mobile screen for Power BI layout
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth <= 768);
        handleResize(); // Initial check
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Pool of rotating thinking phrases shown while waiting for the agent
    const fallbackPhrases = [
        "Working on it...",
        "Gathering information...",
        "Processing your request...",
        "Searching for answers...",
        "Putting it together...",
        "Almost there...",
        "Still working on it...",
    ];

    // Track whether fallback rotation has already been started
    const rotationStarted = useRef(false);

    // Rotate thinking phrases — wait 10s after the LLM phrase, then rotate every 10s
    useEffect(() => {
        if (!isLoading) {
            rotationStarted.current = false; // Reset for next message
            return;
        }
        if (thinkingText === "..." || rotationStarted.current) return;

        rotationStarted.current = true;

        const timeout = setTimeout(() => {
            // After 10s, show the first fallback phrase immediately
            setThinkingText(prev => {
                const available = fallbackPhrases.filter(p => p !== prev);
                return available[Math.floor(Math.random() * available.length)];
            });

            // Then rotate every 10s after that
            const interval = setInterval(() => {
                setThinkingText(prev => {
                    const available = fallbackPhrases.filter(p => p !== prev);
                    return available[Math.floor(Math.random() * available.length)];
                });
            }, 10000);

            // Store interval ID for cleanup
            timeoutCleanup.current = interval;
        }, 10000);

        const timeoutCleanup = { current: null as NodeJS.Timeout | null };

        return () => {
            clearTimeout(timeout);
            if (timeoutCleanup.current) clearInterval(timeoutCleanup.current);
        };
    }, [isLoading, thinkingText]);

    // Refs
    const messageEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const chatBoxRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Lock body scroll when chat is maximized
    useEffect(() => {
        if (isChatMaximized) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isChatMaximized]);

    // Close chat when clicking outside or pressing ESC — WITHOUT resetting the thread
    useEffect(() => {
        if (!isChatOpen) return;

        // Shared close logic — keeps messages & conversationId intact
        const closeChat = () => {
            setIsChatOpen(false);
            setTimeout(() => setIsChatMaximized(false), 300);
        };

        const handleClickOutside = (e: MouseEvent) => {
            // Don't close chat while the image lightbox is open
            const target = e.target as HTMLElement;
            if (target.closest('.image-preview-backdrop')) return;
            // Ignore clicks inside the chat box itself
            if (chatBoxRef.current && chatBoxRef.current.contains(target)) return;
            // Ignore clicks on the floating chat button (it handles its own toggle)
            if (target.closest('.ant-float-btn')) return;
            closeChat();
        };

        const handleEscKey = (e: KeyboardEvent) => {
            // If the Escape was already consumed by the lightbox, skip
            if (e.defaultPrevented) return;
            if (e.key === 'Escape') closeChat();
        };

        // mousedown so it fires before focus/other handlers
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscKey);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscKey);
        };
    }, [isChatOpen]);

    // Send message to the agent
    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const currentInput = input;
        const userMessage = { role: "user", content: currentInput };
        setMessages((prev) => [...prev, userMessage]);
        setInput("");
        setIsLoading(true);
        setThinkingText("...");

        abortControllerRef.current = new AbortController();

        // Fire off the 'think' request concurrently
        fetch("/api/chat/think", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: userMessage.content }),
            signal: abortControllerRef.current.signal,
        })
            .then(res => res.json())
            .then(data => {
                if (data.phrase) setThinkingText(data.phrase);
            })
            .catch(err => {
                if (err.name === 'AbortError') return;
                console.error("Think error:", err);
            });

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMessage.content, conversationId }),
                signal: abortControllerRef.current.signal,
            });

            const data = await response.json();

            if (data.reply) {
                if (data.conversationId) {
                    setConversationId(data.conversationId);
                }
                setIsLoading(false);
                setMessages((prev) => [...prev, { role: "assistant", content: data.reply, images: data.images || [] }]);
            } else {
                console.error("Agent returned an error:", data.error);
                setIsLoading(false);
                setMessages((prev) => [...prev, {
                    role: "assistant",
                    content: data.error || "Sorry, I encountered an error.",
                    isError: true
                }]);
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                setIsLoading(false);
                setMessages((prev) => [...prev, { role: "assistant", content: "_You stopped this response._", isError: true }]);
                setInput(currentInput);
                return;
            }
            console.error("Chat error:", error);
            setIsLoading(false);
            setMessages((prev) => [...prev, {
                role: "assistant",
                content: "Network error. Please try again.",
                isError: true
            }]);
        }
    };

    const stopResponse = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
    };

    // Clear chat
    const clearChat = () => {
        setMessages([]);
        setConversationId(null);
        setThinkingText("...");
    };

    // Toggle maximize/minimize
    const toggleMaximize = () => {
        setIsChatMaximized(prev => !prev);
    };

    const {
        token: { colorBgContainer },
    } = theme.useToken();

    // useSession — the `update` function triggers a server-side session refresh
    // which runs the JWT callback and auto-refreshes the Azure AD token if needed
    const { data: session, status, update: updateSession } = useSession();

    // Capture the Power BI report instance when it first renders
    const getEmbeddedComponent = useCallback((embeddedReport: any) => {
        reportRef.current = embeddedReport;
    }, []);

    // Refresh the session every 45 minutes so the server-side JWT callback
    // can auto-refresh the Azure AD access token before it expires (~1hr)
    useEffect(() => {
        const REFRESH_INTERVAL = 45 * 60 * 1000; // 45 minutes in ms
        const interval = setInterval(() => {
            updateSession(); // triggers JWT callback server-side
        }, REFRESH_INTERVAL);
        return () => clearInterval(interval);
    }, [updateSession]);

    // Hot-swap the access token on the live Power BI embed when it changes
    useEffect(() => {
        const newToken = session?.accessToken;
        if (!newToken) return;

        // On first render, just record the token
        if (prevTokenRef.current === undefined) {
            prevTokenRef.current = newToken;
            return;
        }

        // If the token actually changed, update the live report
        if (newToken !== prevTokenRef.current) {
            prevTokenRef.current = newToken;
            if (reportRef.current) {
                reportRef.current.setAccessToken(newToken)
                    .catch((err: any) => console.error("Failed to update Power BI token:", err));
            }
        }
    }, [session?.accessToken]);

    // Show spinner while session loads
    if (status === "loading") {
        return (
            <div
                className="d-flex justify-content-center align-items-center"
                style={{ minHeight: "100vh" }}
            >
                <Spin size="large" />
            </div>
        );
    }

    // Get the REAL user name and email from Entra ID session
    const userName = session?.user?.name || "User";
    const userEmail = session?.user?.email || "";



    return (
        <Layout style={{ height: "100vh", overflow: "hidden" }}>
            {/* Header */}
            <AppHeader
                dashboardTitle="Education Insights Portal"
                userName={userName}
                userEmail={userEmail}
            />

            <Layout>
                {/* Sidebar */}
                <AppSidebar
                    activeKey={activeReport}
                    onSelect={setActiveReport}
                    collapsed={siderCollapsed}
                    onCollapse={setSiderCollapsed}
                />

                {/* Power BI Embed Area */}
                <Content className="p-0 d-flex flex-column" style={{ overflow: 'hidden', backgroundColor: 'var(--bg-base)', position: 'relative' }}>
                    {/* Placeholder — will be replaced with <PowerBIEmbed /> later */}
                    {/* <div
                    className="powerbi-container d-flex justify-content-center align-items-center rounded"
                    style={{ backgroundColor: "#fff", border: "2px dashed #d9d9d9" }}
                >
                    <div className="text-center">
                        <BarChartOutlined style={{ fontSize: 64, color: "#bfbfbf" }} />

                        <br />

                        <Text type="secondary" style={{ fontSize: 16 }}>
                            Power BI Report will be embedded here
                        </Text>
                    </div>
                </div> */}
                    {/* Power BI Embedded Report */}
                    <div className="flex-grow-1 h-100 w-100">
                        {session?.accessToken ? (
                            <div className="h-100 w-100 bg-base">
                                <PowerBIEmbed
                                    key={activeReport}
                                    embedConfig={{
                                        type: "report",
                                        id: currentDashboard.reportId,
                                        embedUrl: `https://app.powerbi.com/reportEmbed?reportId=${currentDashboard.reportId}&groupId=${process.env.NEXT_PUBLIC_POWERBI_GROUP_ID}`,
                                        accessToken: session.accessToken,
                                        tokenType: 0,  // 0 = TokenType.Aad
                                        settings: {
                                            panes: {
                                                filters: { expanded: false, visible: false },
                                                pageNavigation: { visible: false },
                                            },
                                            background: currentDashboard.background, // per-dashboard: aqeela=0, ariff=1
                                            layoutType: isMobile ? 2 : 0, // 2 = MobilePortrait, 0 = Master
                                        },
                                    }}
                                    getEmbeddedComponent={getEmbeddedComponent}
                                    cssClassName="powerbi-container"
                                />
                            </div>
                        ) : (
                            <div
                                className="powerbi-container d-flex justify-content-center align-items-center"
                                style={{ backgroundColor: "var(--bg-base)" }}
                            >
                                <Spin size="large" />
                            </div>
                        )}
                    </div>

                    {/* Backdrop overlay when maximized */}
                    <div className={`content-dim-overlay ${isChatOpen ? 'dim-active' : ''}`} />
                    {isChatMaximized && isChatOpen && (
                        <div className="chat-backdrop" onClick={toggleMaximize} />
                    )}

                    {/* Chatbot Chatting Area - Always rendered, animated via CSS */}
                    <div>
                        <div ref={chatBoxRef} className={`position-fixed shadow rounded bottom-0 end-0 chatbot-chat-box ${isChatOpen ? 'chat-open' : 'chat-closed'} ${isChatMaximized ? 'chat-maximized' : ''}`}>                            {/* Header */}
                            <div className={`border-bottom p-2 bg-primary d-flex justify-content-between align-items-center ${isChatMaximized ? '' : 'rounded-top'}`}>
                                <span className="fw-bold text-white">Education Insights Agent</span>
                                <div className="d-flex align-items-center gap-2">
                                    {messages.length > 0 && (
                                        <button
                                            onClick={clearChat}
                                            disabled={isLoading}
                                            className="bg-transparent text-white border-0 p-0 px-1"
                                            title="Clear Chat"
                                            style={{ fontSize: '0.75rem', opacity: 0.8, cursor: 'pointer', outline: 'none' }}
                                        >
                                            <i className="bi bi-trash"></i>
                                        </button>
                                    )}
                                    {/* Desktop Maximize/Minimize Button */}
                                    <button
                                        onClick={toggleMaximize}
                                        className="btn btn-sm text-white border-0 p-0 px-1 d-none d-md-block"
                                        title={isChatMaximized ? "Minimize" : "Maximize"}
                                        style={{ fontSize: '0.75rem', opacity: 0.8 }}
                                    >
                                        <i className={`bi ${isChatMaximized ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`}></i>
                                    </button>
                                    {/* Mobile Close Button */}
                                    <button
                                        onClick={() => {
                                            setIsChatOpen(false);
                                            // Reset maximized state for next time
                                            setTimeout(() => setIsChatMaximized(false), 300);
                                        }}
                                        className="bg-transparent text-white border-0 p-0 px-1 d-md-none"
                                        title="Close"
                                        style={{ fontSize: '1rem', opacity: 0.8, cursor: 'pointer', outline: 'none' }}
                                    >
                                        <i className="bi bi-x-lg"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Messages */}
                            <div
                                className="flex-grow-1 overflow-auto p-2 scrollbar-hide"
                                ref={chatContainerRef}
                                style={{ fontSize: '0.85rem' }}
                            >
                                {messages.length === 0 && !isLoading ? (
                                    /* Welcome message - key forces re-mount after clear for animation */
                                    <div key={`welcome-${conversationId || 'new'}`} className="h-100 d-flex flex-column align-items-center justify-content-center text-center text-secondary welcome-fade-in" style={{ fontSize: '0.8rem' }}>
                                        <i className="bi bi-stars fs-1 mb-2" style={{ color: '#d1d5db' }}></i>
                                        <span>Ask me anything about your education data</span>
                                    </div>
                                ) : (
                                    /* Chat messages */
                                    <div className="d-flex flex-column gap-3">
                                        {messages.map((msg, index) =>
                                            msg.role === "assistant" ? (
                                                /* Assistant message */
                                                <div key={index} className="d-flex align-items-start gap-2 animate-fade-in-up">
                                                    <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '28px', height: '28px', backgroundColor: '#f3f4f6', fontSize: '0.7rem' }}>
                                                        <i className="bi bi-stars"></i>
                                                    </div>
                                                    <div className="chat-bubble p-2 text-dark text-break" style={{ backgroundColor: '#f3f4f6', borderRadius: '4px 14px 14px 14px', maxWidth: '85%' }}>
                                                        <ReactMarkdown
                                                            remarkPlugins={[remarkGfm]}
                                                            components={{
                                                                a: ({ node, href, ...props }) => <a
                                                                    {...props}
                                                                    href={href}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                />,
                                                                ul: ({ node, ...props }) => <ul className="ps-3 mb-1" {...props} />,
                                                                ol: ({ node, ...props }) => <ol className="ps-3 mb-1" {...props} />,
                                                                li: ({ node, ...props }) => <li className="mb-0" {...props} />
                                                            }}
                                                        >
                                                            {msg.content.replace(/【.*?】/g, '')}
                                                        </ReactMarkdown>

                                                        {msg.images && msg.images.length > 0 && (
                                                            <div className="mt-2 d-flex flex-column gap-2">
                                                                {msg.images.map((src, i) =>
                                                                    React.createElement("img", {
                                                                        key: i,
                                                                        src: src,
                                                                        alt: "Generated chart",
                                                                        style: { width: "100%", maxWidth: 600, borderRadius: 8, cursor: "pointer", display: "block" },
                                                                        onClick: () => setPreviewImage(src),
                                                                    })
                                                                )}
                                                            </div>
                                                        )}

                                                    </div>
                                                </div>
                                            ) : (
                                                /* User message */
                                                <div key={index} className="d-flex justify-content-end animate-fade-in-up">
                                                    <div className="chat-bubble p-2 text-white text-break" style={{ backgroundColor: '#3b82f6', borderRadius: '14px 14px 4px 14px', maxWidth: '85%' }}>
                                                        {msg.content}
                                                    </div>
                                                </div>
                                            )
                                        )}

                                        {/* Typing Indicator */}
                                        {isLoading && (
                                            <div className="d-flex align-items-start gap-2">
                                                <div className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: '28px', height: '28px', backgroundColor: '#f3f4f6', fontSize: '0.7rem' }}>
                                                    <i className="bi bi-stars"></i>
                                                </div>
                                                <div className="p-2 text-dark d-flex align-items-center gap-1" style={{ backgroundColor: '#f3f4f6', borderRadius: '4px 14px 14px 14px', minHeight: '36px' }}>
                                                    {thinkingText === "..." ? (
                                                        <>
                                                            <div className="typing-dot"></div>
                                                            <div className="typing-dot"></div>
                                                            <div className="typing-dot"></div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true" style={{ width: '12px', height: '12px' }}></span>
                                                            <span className="text-secondary fst-italic" style={{ fontSize: '0.8rem' }}>{thinkingText}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <div ref={messageEndRef}></div>
                            </div>

                            {/* Input */}
                            <div className="border-top p-2">
                                <div className="d-flex align-items-center">
                                    <input
                                        type="text"
                                        className="form-control border-0 shadow-none"
                                        placeholder="Type a message..."
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                                                e.preventDefault();
                                                sendMessage();
                                            }
                                        }}
                                        disabled={isLoading}
                                        style={{ fontSize: '0.85rem', outline: 'none', border: 'none', boxShadow: 'none' }}
                                    />
                                    <button
                                        className="border-0 bg-transparent text-secondary fs-5"
                                        onClick={isLoading ? stopResponse : sendMessage}
                                        disabled={!isLoading && !input.trim()}
                                        title={isLoading ? "Stop generating" : "Send message"}
                                    >
                                        {isLoading ? (
                                            <i className="bi bi-stop-circle text-danger fs-5"></i>
                                        ) : (
                                            <SendOutlined />
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Animated Float Button - single button with icon crossfade */}
                        <FloatButton
                            className="fs-6 shadow-sm transition-all"
                            type="primary"
                            style={{
                                width: 56,
                                height: 56,
                                right: 32,
                                bottom: 32,
                                backgroundColor: "var(--accent-blue)",
                            }}
                            icon={
                                <span style={{ position: 'relative', display: 'inline-flex', width: '1em', height: '1em' }}>
                                    <span className={`chat-fab-icon ${isChatOpen ? 'icon-spin-out' : 'icon-spin-in'}`} style={{ position: 'absolute', inset: 0 }}>
                                        <i className="bi bi-chat-left-text-fill"></i>
                                    </span>
                                    <span className={`chat-fab-icon ${isChatOpen ? 'icon-spin-in' : 'icon-spin-out'}`} style={{ position: 'absolute', inset: 0 }}>
                                        <i className="bi bi-x-lg"></i>
                                    </span>
                                </span>
                            }
                            onClick={() => {
                                const opening = !isChatOpen;
                                setIsChatOpen(opening);
                                // Auto-maximize on mobile devices when opening
                                if (opening && window.innerWidth <= 768) {
                                    setIsChatMaximized(true);
                                }
                            }}
                        />
                    </div>


                </Content>
            </Layout>

            {/* Image preview lightbox — rendered via portal at <body> level */}
            {previewImage && ReactDOM.createPortal(
                <div
                    className="image-preview-backdrop"
                    onClick={() => setPreviewImage(null)}
                >
                    <div className="image-preview-content" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="image-preview-close"
                            onClick={() => setPreviewImage(null)}
                            title="Close"
                        >
                            <i className="bi bi-x-lg"></i>
                        </button>
                        <img
                            src={previewImage}
                            alt="Chart Preview"
                            style={{ maxWidth: "90vw", maxHeight: "85vh", display: "block", borderRadius: 8 }}
                        />
                        <a
                            href={previewImage}
                            download="chart.png"
                            className="image-preview-download"
                        >
                            <i className="bi bi-download me-1"></i> Download
                        </a>
                    </div>
                </div>,
                document.body
            )}
        </Layout>
    );
};