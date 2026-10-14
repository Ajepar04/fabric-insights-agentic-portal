"use client";

import { Typography, Avatar, Dropdown } from "antd";
import {
    UserOutlined,
    LogoutOutlined,
    BarChartOutlined,
    CaretDownOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { signOut } from "next-auth/react";
import { useState } from "react";

const { Text } = Typography;

interface AppHeaderProps {
    dashboardTitle: string;
    userName: string;
    userEmail: string;
}

export default function AppHeader({
    dashboardTitle,
    userName,
    userEmail,
}: AppHeaderProps) {
    const [isHovered, setIsHovered] = useState(false);

    const profileMenuItems: MenuProps["items"] = [
        {
            key: "user-info",
            label: (
                <div className="py-1 px-2">
                    <Text strong style={{ color: "var(--bg-base)" }}>{userName}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {userEmail}
                    </Text>
                </div>
            ),
            disabled: true,
        },
        { type: "divider" },
        {
            key: "sign-out",
            icon: <LogoutOutlined />,
            label: "Sign Out",
            danger: true,
            onClick: () => signOut({ callbackUrl: "/" }),
        },
    ];

    return (
        <header
            className="d-flex justify-content-between align-items-center px-4"
            style={{
                height: "60px",
                backgroundColor: "var(--bg-base)",
                borderBottom: "1px solid var(--border-subtle)",
                flexShrink: 0,
            }}
        >
            {/* Logo & Title */}
            <div className="d-flex align-items-center gap-2">
                <BarChartOutlined style={{ fontSize: 20, color: "var(--accent-blue)" }} />
                <Text className="fw-semibold" style={{ fontSize: 16, color: "var(--text-primary)", letterSpacing: "0.2px" }}>
                    {dashboardTitle}
                </Text>
            </div>

            {/* User Menu */}
            <Dropdown menu={{ items: profileMenuItems }} placement="bottomRight" trigger={['click']}>
                <div
                    className="d-flex align-items-center gap-3 py-1 px-2 rounded transition-all"
                    style={{ 
                        cursor: "pointer", 
                        backgroundColor: isHovered ? "rgba(255,255,255,0.05)" : "transparent",
                        transition: "background-color 0.2s ease"
                    }}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    <div className="d-none d-md-flex flex-column text-end justify-content-center">
                        <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-primary)", lineHeight: 1.2 }}>
                            {userName}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.2 }}>
                            {userEmail}
                        </span>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                        <Avatar
                            icon={<UserOutlined />}
                            style={{ backgroundColor: "var(--accent-blue)", border: "none" }}
                            size={32}
                        />
                        <CaretDownOutlined style={{ fontSize: "12px", color: "var(--text-muted)" }} />
                    </div>
                </div>
            </Dropdown>
        </header>
    );
}
