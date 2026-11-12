import { DownloadOutlined, SafetyCertificateOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Form, Input, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "../api/client";
import { auditApi } from "../api/audit";
import type { AuditFilter, AuditRecord, IntegrityCheck } from "../api/audit";

const { Title, Text } = Typography;
const resultColor: Record<string, string> = { SUCCESS: "success", ALLOWED: "success", VALID: "success", DENIED: "error", EMPTY: "warning", BROKEN: "error" };
const resultLabel: Record<string, string> = { DENIED: "Bị từ chối", EMPTY: "Ngoài phạm vi", ALLOWED: "Được phép", SUCCESS: "Thành công" };
const localInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Value({ value }: { value: unknown }) {
  return value == null ? <Text type="secondary">—</Text> : <pre className="audit-value">{JSON.stringify(value, null, 2)}</pre>;
}

function AuditLogTab() {
  const [form] = Form.useForm();
  const [filter, setFilter] = useState<AuditFilter>({});
  const facets = useQuery({ queryKey: ["audit-facets"], queryFn: auditApi.facets });
  const logs = useInfiniteQuery({
    queryKey: ["audit-logs", filter],
    queryFn: ({ pageParam }) => auditApi.logs({ ...filter, pageSize: "50", cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
  const exporter = useMutation({
    mutationFn: () => auditApi.export(filter),
    onSuccess: blob => { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "nhat-ky-kiem-toan.xlsx"; link.click(); URL.revokeObjectURL(link.href); },
  });
  const options = (values?: string[]) => values?.map(value => ({ value, label: resultLabel[value] ?? value }));
  const submit = (values: Record<string, string | undefined>) => setFilter(Object.fromEntries(Object.entries({
    ...values, from: values.from ? new Date(values.from).toISOString() : undefined, to: values.to ? new Date(values.to).toISOString() : undefined,
  }).filter(([, value]) => value)) as AuditFilter);
  const rows = logs.data?.pages.flatMap(page => page.items) ?? [];
  return <div className="tab-stack">
    <Form form={form} layout="vertical" className="audit-filters" onFinish={submit} initialValues={{ from: localInput(new Date(Date.now() - 7 * 86400000)) }}>
      <Form.Item name="from" label="Từ thời điểm"><Input type="datetime-local" /></Form.Item>
      <Form.Item name="to" label="Đến thời điểm"><Input type="datetime-local" /></Form.Item>
      <Form.Item name="actor" label="Người thực hiện"><Input placeholder="Tên hoặc mã tài khoản" allowClear /></Form.Item>
      <Form.Item name="action" label="Hành động"><Select placeholder="Tất cả hành động" allowClear showSearch options={options(facets.data?.actions)} /></Form.Item>
      <Form.Item name="entityType" label="Loại đối tượng"><Select placeholder="Tất cả đối tượng" allowClear showSearch options={options(facets.data?.entityTypes)} /></Form.Item>
      <Form.Item name="entityId" label="Mã đối tượng"><Input placeholder="Nhập mã đối tượng" allowClear /></Form.Item>
      <Form.Item name="result" label="Kết quả"><Select placeholder="Tất cả kết quả" allowClear options={options(facets.data?.results)} /></Form.Item>
      <Space><Button type="primary" htmlType="submit" icon={<SearchOutlined />}>Tra cứu</Button><Button icon={<DownloadOutlined />} loading={exporter.isPending} onClick={() => exporter.mutate()}>Xuất Excel</Button></Space>
    </Form>
    {exporter.isError && <Alert type="error" showIcon message="Không xuất được nhật ký" description={errorMessage(exporter.error)} />}
    {logs.isError ? <Alert type="error" showIcon message="Không tải được nhật ký" description={errorMessage(logs.error)} /> : <>
      <Alert type="info" showIcon message="Giá trị lương được che (***) với quản trị hệ thống." />
      <section className="table-panel" role="region" tabIndex={0} aria-label="Bảng nhật ký kiểm toán, cuộn ngang để xem đầy đủ">
      <Table<AuditRecord> rowKey="id" size="small" loading={logs.isLoading} dataSource={rows} pagination={false} scroll={{ x: 1300 }}
        locale={{ emptyText: <Empty description="Không có bản ghi phù hợp" /> }}
        expandable={{ expandedRowRender: row => <Space align="start" wrap><div><Text type="secondary">Giá trị cũ</Text><Value value={row.oldValue} /></div><div><Text type="secondary">Giá trị mới</Text><Value value={row.newValue} /></div></Space> }}
        columns={[
          { title: "#", dataIndex: "id", width: 90 },
          { title: "Thời điểm", dataIndex: "occurredAt", width: 170, render: value => new Date(value).toLocaleString("vi-VN") },
          { title: "Người thực hiện", width: 180, render: (_, row) => row.actor ? <>{row.actor.displayName}<small className="table-subtext">{row.actor.username}</small></> : <Text type="secondary">Hệ thống</Text> },
          { title: "Hành động", dataIndex: "action", width: 160 },
          { title: "Đối tượng", width: 260, render: (_, row) => <>{row.entityType}<small className="table-subtext">{row.entityId}</small></> },
          { title: "Kết quả", dataIndex: "result", width: 130, render: value => <Tag color={resultColor[value] ?? "default"}>{resultLabel[value] ?? value}</Tag> },
          { title: "IP", dataIndex: "ipAddress", width: 130, render: value => value ?? "—" },
        ]} />
      </section>
      {logs.hasNextPage && <Button block loading={logs.isFetchingNextPage} onClick={() => void logs.fetchNextPage()}>Tải thêm</Button>}
    </>}
  </div>;
}

function IntegrityTab() {
  const client = useQueryClient();
  const checks = useQuery({ queryKey: ["audit-integrity"], queryFn: auditApi.checks });
  const run = useMutation({ mutationFn: auditApi.runCheck, onSuccess: () => void client.invalidateQueries({ queryKey: ["audit-integrity"] }) });
  const latest = checks.data?.items[0];
  return <div className="tab-stack">
    <div className="history-toolbar">
      <Button type="primary" icon={<SafetyCertificateOutlined />} loading={run.isPending} onClick={() => run.mutate()}>Kiểm tra ngay</Button></div>
    {run.isError && <Alert type="error" showIcon message="Không chạy được kiểm tra" description={errorMessage(run.error)} />}
    {latest && <Alert type={latest.status === "VALID" ? "success" : "error"} showIcon
      message={latest.status === "VALID" ? "Chuỗi nhật ký nguyên vẹn (" + latest.checkedCount + " bản ghi)" : "Phát hiện can thiệp tại bản ghi #" + latest.firstBrokenId}
      description={latest.status === "BROKEN" ? (latest.failureReason === "HASH_MISMATCH" ? "Nội dung bản ghi không khớp mã băm." : "Liên kết với bản ghi trước bị đứt (bản ghi bị xóa hoặc chèn).") + " Lập biên bản sự cố và đối chiếu bản sao lưu." : undefined} />}
    {checks.isError ? <Alert type="error" showIcon message="Không tải được lịch sử kiểm tra" description={errorMessage(checks.error)} /> :
      <section className="table-panel" role="region" tabIndex={0} aria-label="Bảng kiểm tra toàn vẹn nhật ký, có thể cuộn ngang"><Table<IntegrityCheck> rowKey="id" size="small" loading={checks.isLoading} dataSource={checks.data?.items ?? []} pagination={false} scroll={{ x: 900 }}
        locale={{ emptyText: <Empty description="Chưa có lần kiểm tra nào" /> }}
        columns={[
          { title: "Bắt đầu", dataIndex: "startedAt", width: 170, render: value => new Date(value).toLocaleString("vi-VN") },
          { title: "Cách chạy", dataIndex: "trigger", width: 140, render: (value, row) => value === "MANUAL" ? "Thủ công" + (row.triggeredBy ? " · " + row.triggeredBy : "") : "Định kỳ" },
          { title: "Kết quả", dataIndex: "status", width: 120, render: value => <Tag color={resultColor[value]}>{value === "VALID" ? "Hợp lệ" : "Bị can thiệp"}</Tag> },
          { title: "Khoảng bản ghi", width: 160, render: (_, row) => row.fromId ? "#" + row.fromId + " – #" + row.toId : "—" },
          { title: "Số bản ghi", dataIndex: "checkedCount", width: 110, align: "right" },
          { title: "Bản ghi lỗi đầu tiên", width: 200, render: (_, row) => row.firstBrokenId ? "#" + row.firstBrokenId + " (" + row.failureReason + ")" : "—" },
        ]} /></section>}
  </div>;
}

export function AuditWorkspace() {
  return <div className="content-stack">
    <div className="page-heading"><div><p className="eyebrow">QUẢN TRỊ / KIỂM TOÁN</p><Title level={1}>Nhật ký kiểm toán</Title>
    </div></div>
    <section className="panel settings-panel"><Tabs items={[{ key: "logs", label: "Tra cứu nhật ký", children: <AuditLogTab /> }, { key: "integrity", label: "Toàn vẹn chuỗi băm", children: <IntegrityTab /> }]} /></section>
  </div>;
}
