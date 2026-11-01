import { BellOutlined } from "@ant-design/icons";
import { Badge, Button, Empty, List, Popover, Space, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { notificationsApi } from "../api/audit";
import type { AppNotification } from "../api/audit";

const { Text } = Typography;
const POLL_MS = 60_000;

/** Header inbox (FR-X.5). Opening an item only navigates; the target screen checks the viewer's current permissions. */
export function NotificationBell({ onOpen }: { onOpen: (linkKey: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: ["notifications-unread"], queryFn: notificationsApi.unreadCount, refetchInterval: POLL_MS });
  const list = useQuery({ queryKey: ["notifications"], queryFn: () => notificationsApi.list(), enabled: open });
  const read = useMutation({
    mutationFn: notificationsApi.read,
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["notifications"] }); void client.invalidateQueries({ queryKey: ["notifications-unread"] }); },
  });
  const openItem = (item: AppNotification) => {
    if (!item.readAt) read.mutate({ ids: [item.id] });
    setOpen(false);
    onOpen(item.linkKey);
  };
  const content = <div className="notification-panel">
    <Space className="notification-head"><Text strong>Thông báo</Text><Button type="link" size="small" disabled={!count.data?.unread} onClick={() => read.mutate({ all: true })}>Đánh dấu tất cả đã đọc</Button></Space>
    <List<AppNotification> loading={list.isLoading} dataSource={list.data?.items ?? []} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có thông báo" /> }}
      renderItem={item => <List.Item className={item.readAt ? "notification-item" : "notification-item unread"} onClick={() => openItem(item)}>
        <div><Text strong={!item.readAt}>{item.title}</Text><small className="table-subtext">{new Date(item.createdAt).toLocaleString("vi-VN")}</small></div>
      </List.Item>} />
  </div>;
  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottomRight" content={content}>
    <Button type="text" aria-label={"Thông báo, " + (count.data?.unread ?? 0) + " chưa đọc"} icon={<Badge count={count.data?.unread ?? 0} size="small" overflowCount={99}><BellOutlined /></Badge>} />
  </Popover>;
}
