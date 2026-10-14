"use client";

import { useEffect } from "react";
import { Button, Card, Typography, Space, Spin } from "antd";
import { WindowsFilled, BarChartOutlined } from "@ant-design/icons";
import { useSession, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

const { Title, Text } = Typography;

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // If already signed in, skip login and go straight to dashboard
    if (session) {
      router.push("/dashboard");
    }
  }, [session, router]);

  if (status === "loading") {
    return (
      <div
        className="d-flex justify-content-center align-items-center"
        style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)" }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div
      className="d-flex justify-content-center align-items-center p-4"
      style={{ minHeight: "100vh", backgroundColor: "var(--bg-base)" }}
    >
      <Card
        className="text-center p-3"
        style={{
          maxWidth: 420,
          width: "100%",
          backgroundColor: "var(--bg-surface, #141C2E)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        }}
      >
        <Space orientation="vertical" size="large" className="w-100">
          {/* Logo / Title */}
          <div>
            <div
              className="text-center mb-3"
              style={{
                backgroundColor: "var(--accent-blue, #3B82F6)",
                width: 90,
                height: 90,
                borderRadius: "50%",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                margin: "0 auto",
              }}
            >
              <BarChartOutlined className="text-white" style={{ fontSize: 54 }} />
            </div>
            <Title level={3} className="mb-1" style={{ color: "#E6EAF2" }}>
              Education Insights Portal
            </Title>
            <Text style={{ color: "#93A0B5" }}>
              Sign in to view your reports
            </Text>
          </div>

          {/* Sign In Button */}
          <Button
            type="primary"
            size="large"
            icon={<WindowsFilled />}
            onClick={() =>
              signIn("microsoft-entra-id", { callbackUrl: "/dashboard" })
            }
            block
            style={{
              backgroundColor: "var(--accent-blue, #3B82F6)",
              borderColor: "var(--accent-blue, #3B82F6)",
            }}
          >
            Sign in with Microsoft Entra ID
          </Button>
        </Space>
      </Card>
    </div>
  );
}