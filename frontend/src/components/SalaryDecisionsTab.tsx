import { PlusOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Empty, Form, Input, Modal, Select, Space, Spin, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { ApiError, errorMessage } from "../api/client";
import { salaryDecisionApi } from "../api/salary-decisions";
import type { SalaryDecision, SalaryDecisionInput } from "../api/salary-decisions";

const { Title, Text } = Typography;
const money = (value: string) => Number(value).toLocaleString("vi-VN") + " đ";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
const yearStart = today.slice(0, 4) + "-01-01", yearEnd = today.slice(0, 4) + "-12-31";

function CreateDecision({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [form] = Form.useForm<SalaryDecisionInput & { amount: string; salaryBasis: "MONTHLY" | "HOURLY" }>();
  const [warning, setWarning] = useState<string | null>(null);
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: SalaryDecisionInput & { amount: string; salaryBasis: "MONTHLY" | "HOURLY" }) => salaryDecisionApi.create(employeeId, {
      decisionNumber: values.decisionNumber, decisionDate: values.decisionDate, effectiveFrom: values.effectiveFrom, reason: values.reason, legalBasis: values.legalBasis,
      lines: [{ amount: values.amount, salaryBasis: values.salaryBasis }], ...(values.warningAcknowledgement ? { warningAcknowledgement: values.warningAcknowledgement } : {}),
    }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["salary-decisions", employeeId] }); onClose(); },
    onError: error => { if (error instanceof ApiError && error.code === "CROSS_REGION_SALARY_DECREASE") setWarning(errorMessage(error)); },
  });
  return <Modal title="Lập quyết định thay đổi lương" open onCancel={onClose} footer={null} destroyOnHidden width={620}>
    <Form form={form} layout="vertical" initialValues={{ salaryBasis: "MONTHLY", decisionDate: today }} onFinish={values => mutation.mutate(values)}>
      <div className="form-grid">
        <Form.Item name="decisionNumber" label="Số quyết định" rules={[{ required: true, whitespace: true, message: "Nhập số quyết định." }]}><Input /></Form.Item>
        <Form.Item name="decisionDate" label="Ngày quyết định" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
        <Form.Item name="effectiveFrom" label="Ngày hiệu lực" rules={[{ required: true, message: "Chọn ngày." }]}><Input type="date" /></Form.Item>
        <Form.Item name="salaryBasis" label="Cơ sở lương"><Select options={[{ value: "MONTHLY", label: "Theo tháng" }, { value: "HOURLY", label: "Theo giờ" }]} /></Form.Item>
        <Form.Item className="form-span-2" name="amount" label="Lương thỏa thuận mới (đồng)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Nhập số tiền hợp lệ." }]}><Input inputMode="decimal" /></Form.Item>
      </div>
      <Form.Item name="legalBasis" label="Căn cứ" rules={[{ required: true, whitespace: true, message: "Nhập căn cứ." }]}><Input /></Form.Item>
      <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: "Nhập lý do." }]}><Input.TextArea rows={2} /></Form.Item>
      {warning && <><Alert type="warning" showIcon message="Cảnh báo BR-08" description={warning} /><Form.Item name="warningAcknowledgement" label="Lý do xác nhận" rules={[{ required: true, whitespace: true, message: "Nhập lý do xác nhận." }]}><Input.TextArea rows={2} /></Form.Item></>}
      {mutation.isError && !warning && <Alert type="error" showIcon message="Không lưu được quyết định" description={errorMessage(mutation.error)} />}
      <Space className="modal-actions"><Button onClick={onClose}>Hủy</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>Lưu quyết định</Button></Space>
    </Form>
  </Modal>;
}

export function SalaryDecisionsTab({ employeeId, canManage }: { employeeId: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState({ from: yearStart, to: yearEnd });
  const decisions = useQuery({ queryKey: ["salary-decisions", employeeId], queryFn: () => salaryDecisionApi.list(employeeId) });
  const timeline = useQuery({ queryKey: ["salary-decisions", employeeId, "timeline", range], queryFn: () => salaryDecisionApi.timeline(employeeId, range.from, range.to) });
  if (decisions.isLoading) return <div className="content-loading"><Spin /></div>;
  if (decisions.isError) return <Alert type="error" showIcon message="Không tải được quyết định lương" description={errorMessage(decisions.error)} />;
  return <div className="tab-stack">
    <div className="tab-actions"><Title level={4}>Quyết định thay đổi lương</Title>{canManage && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Lập quyết định</Button>}</div>
    <Table<SalaryDecision> size="small" rowKey="id" pagination={false} dataSource={decisions.data?.items ?? []} scroll={{ x: 720 }} locale={{ emptyText: <Empty description="Chưa có quyết định; lương lấy theo hợp đồng" /> }}
      expandable={{ expandedRowRender: row => <Descriptions size="small" column={1} bordered items={[
        { key: "basis", label: "Căn cứ", children: row.legalBasis }, { key: "reason", label: "Lý do", children: row.reason },
        ...(row.warnings.length ? [{ key: "warn", label: "Cảnh báo", children: <>{row.warnings.map(w => <Tag key={w.code} color="warning">{w.code} {w.fromRegion}→{w.toRegion}</Tag>)} {row.warningAcknowledgement}</> }] : []),
        ...(row.retroCandidates.length ? [{ key: "retro", label: "Kỳ khóa bị ảnh hưởng", children: row.retroCandidates.map(r => <Tag key={r.id} color={r.status === "PENDING" ? "orange" : "default"}>{r.payrollPeriodCode}</Tag>) }] : []),
      ]} /> }}
      columns={[
        { title: "Số QĐ", dataIndex: "decisionNumber" }, { title: "Hiệu lực", dataIndex: "effectiveFrom", width: 110 },
        { title: "Mức mới", render: (_, row) => row.lines.map(line => <div key={line.componentId ?? "agreed"}>{line.componentName}: <Text strong>{money(line.amount)}</Text></div>) },
        { title: "Hồi tố", width: 90, render: (_, row) => row.retroCandidates.length ? <Tag color="orange">{row.retroCandidates.length} kỳ</Tag> : "—" },
      ]} />
    <div className="tab-actions"><Title level={4}>Dòng thời gian lương</Title>
      <Space><Input type="date" value={range.from} onChange={event => setRange(current => ({ ...current, from: event.target.value }))} /><Input type="date" value={range.to} onChange={event => setRange(current => ({ ...current, to: event.target.value }))} /></Space></div>
    {timeline.isError ? <Alert type="error" showIcon message="Không tải được dòng thời gian" description={errorMessage(timeline.error)} /> : <>
      <Table size="small" rowKey={row => row.componentId + row.from} loading={timeline.isLoading} pagination={false} dataSource={timeline.data?.segments ?? []} scroll={{ x: 640 }} columns={[
        { title: "Khoản", dataIndex: "componentName" }, { title: "Từ", dataIndex: "from", width: 110 }, { title: "Đến", dataIndex: "to", width: 110 },
        { title: "Số tiền", dataIndex: "amount", align: "right", render: money }, { title: "Nguồn", render: (_, row) => <Tag color={row.source === "DECISION" ? "blue" : "default"}>{row.source === "DECISION" ? "Quyết định " : "Hợp đồng "}{row.reference}</Tag> },
      ]} />
      <Table size="small" rowKey={row => row.orgUnitId + row.from} loading={timeline.isLoading} pagination={false} dataSource={timeline.data?.units ?? []} scroll={{ x: 640 }} columns={[
        { title: "Đơn vị", render: (_, row) => `${row.orgUnitName} (${row.orgUnitCode})` }, { title: "Vùng", dataIndex: "wageRegionCode", width: 70 }, { title: "Cost center", dataIndex: "costCenterCode", render: value => value ?? "—" },
        { title: "Khoảng", render: (_, row) => `${row.from} → ${row.to}` }, { title: "Số ngày", dataIndex: "days", width: 80, align: "right" },
      ]} />
    </>}
    {open && <CreateDecision employeeId={employeeId} onClose={() => setOpen(false)} />}
  </div>;
}
