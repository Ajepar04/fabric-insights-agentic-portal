"use client";

import { Layout, Tooltip } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useState } from "react";

const { Sider } = Layout;

interface AppSidebarProps {
    activeKey: string;
    onSelect: (key: string) => void;
    collapsed: boolean;
    onCollapse: (collapsed: boolean) => void;
}

const navItems = [
    {
        key: "aqeela",
        icon: "bi bi-journal-bookmark",
        label: "National Education",
    },
    {
        key: "ariff",
        icon: "bi bi-bar-chart-line",
        label: "School Analytics",
    },
];

export default function AppSidebar({
    activeKey,
    onSelect,
    collapsed,
    onCollapse,
}: AppSidebarProps) {
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);

    return (
        <Sider
            trigger={null} // Remove default AntD trigger
            collapsible
            collapsed={collapsed}
            width={240}
            collapsedWidth={72}
            style={{
                background: "var(--bg-base)",
                borderRight: "1px solid var(--border-subtle)",
                minHeight: "calc(100vh - 60px)",
            }}
        >
            <div className="d-flex flex-column h-100">
                {/* Nav Items Area */}
                <div className="flex-grow-1 p-3">
                    {!collapsed && (
                        <div
                            style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                color: "var(--text-muted)",
                                letterSpacing: "1px",
                                padding: "0 12px",
                                marginBottom: "12px",
                                marginTop: "8px"
                            }}
                        >
                            VIEWS
                        </div>
                    )}

                    <div className="d-flex flex-column gap-2 mt-2">
                        {navItems.map((item) => {
                            const isActive = activeKey === item.key;
                            const isHovered = hoveredKey === item.key;

                            const navContent = (
                                <div
                                    key={item.key}
                                    onClick={() => onSelect(item.key)}
                                    onMouseEnter={() => setHoveredKey(item.key)}
                                    onMouseLeave={() => setHoveredKey(null)}
                                    className="d-flex align-items-center transition-all"
                                    style={{
                                        cursor: "pointer",
                                        padding: collapsed ? "12px 0" : "10px 16px",
                                        justifyContent: collapsed ? "center" : "flex-start",
                                        borderRadius: "8px",
                                        backgroundColor: isActive
                                            ? "var(--accent-blue)"
                                            : isHovered
                                                ? "rgba(255,255,255,0.06)"
                                                : "transparent",
                                        color: isActive || isHovered ? "#fff" : "var(--text-muted)",
                                    }}
                                >
                                    <i className={`${item.icon}`} style={{ fontSize: "18px", color: "inherit" }} />
                                    {!collapsed && (
                                        <span style={{ marginLeft: "14px", fontSize: "14px", fontWeight: isActive ? 500 : 400 }}>
                                            {item.label}
                                        </span>
                                    )}
                                </div>
                            );

                            return collapsed ? (
                                <Tooltip key={item.key} title={item.label} placement="right">
                                    {navContent}
                                </Tooltip>
                            ) : navContent;
                        })}
                    </div>
                </div>

                {/* Footer Area */}
                {/* <div 
                    className="p-3 d-flex flex-column"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                >
                    <div 
                        className={`d-flex align-items-center ${collapsed ? "justify-content-center" : "justify-content-between"}`}
                    >
                        {!collapsed && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                Insights Portal v1.0
                            </div>
                        )}
                        <div 
                            onClick={() => onCollapse(!collapsed)}
                            className="d-flex align-items-center justify-content-center transition-all"
                            style={{ 
                                width: "32px", 
                                height: "32px", 
                                borderRadius: "8px",
                                cursor: "pointer",
                                color: "var(--text-muted)",
                                backgroundColor: "transparent"
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)";
                                e.currentTarget.style.color = "#fff";
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                                e.currentTarget.style.color = "var(--text-muted)";
                            }}
                        >
                            {collapsed ? <RightOutlined style={{ fontSize: "12px" }} /> : <LeftOutlined style={{ fontSize: "12px" }} />}
                        </div>
                    </div>
                </div> */}
            </div>
        </Sider>
    );
}
